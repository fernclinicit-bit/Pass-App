import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { LocalConfigStore, PostgresConfigStore, createConfigStore } = require("../config-store.cjs");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const larkMenu = [
  { id: "vault-facebook-doctor", system: "Facebook", account: "doctor@example.com" },
  { id: "vault-wifi", system: "Wi-Fi ชั้น 4", account: "Floor4-MKT" },
];

// Stands in for a pg Pool backed by one PostgreSQL database that outlives server restarts.
class FakeConfigPool {
  row = null;
  writes = 0;

  async query(sql, values) {
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("SELECT config FROM passly_server_config")) {
      return { rows: this.row ? [{ config: structuredClone(this.row) }] : [] };
    }
    if (sql.includes("INSERT INTO passly_server_config")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      this.row = JSON.parse(values[0]);
      this.writes += 1;
      return { rows: [] };
    }
    throw new Error(`Unexpected pool query: ${sql}`);
  }
}

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "passly-config-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("settings stay in config.json when DATABASE_URL is absent", async (t) => {
  const file = path.join(await tempDir(t), "data", "config.json");
  const store = createConfigStore("", file);
  assert.ok(store instanceof LocalConfigStore);
  assert.equal(store.persistent, false);

  await store.update((config) => { config.LARK_MENU_CATALOG = larkMenu; });
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).LARK_MENU_CATALOG, larkMenu);
  assert.deepEqual(store.getSync().LARK_MENU_CATALOG, larkMenu);

  await assert.rejects(store.update((config) => {
    config.LARK_MENU_CATALOG = [];
    throw new Error("invalid webhook");
  }), /invalid webhook/);
  assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")).LARK_MENU_CATALOG, larkMenu);
});

test("Lark menu saved to PostgreSQL survives a restart with an empty disk", async (t) => {
  const missingFile = path.join(await tempDir(t), "config.json");
  const pool = new FakeConfigPool();

  const beforeRestart = new PostgresConfigStore(pool, { seedFile: missingFile });
  assert.deepEqual(await beforeRestart.load(), {});
  await beforeRestart.update((config) => {
    config.LARK_MENU_CATALOG = larkMenu;
    config.LARK_MENU_CATALOG_SYNCED_AT = "2026-11-18T09:00:00.000Z";
  });

  const afterRestart = new PostgresConfigStore(pool, { seedFile: missingFile });
  assert.equal(afterRestart.loaded, false);
  await afterRestart.load();
  assert.equal(afterRestart.loaded, true);
  assert.deepEqual(afterRestart.getSync().LARK_MENU_CATALOG, larkMenu);
  assert.equal(afterRestart.getSync().LARK_MENU_CATALOG_SYNCED_AT, "2026-11-18T09:00:00.000Z");
});

test("the first database start carries over settings already in config.json", async (t) => {
  const file = path.join(await tempDir(t), "config.json");
  await fs.writeFile(file, JSON.stringify({ LARK_MENU_CATALOG: larkMenu, LARK_ALLOWED_CHAT_ID: "oc_chat" }));
  const pool = new FakeConfigPool();

  await new PostgresConfigStore(pool, { seedFile: file }).load();
  assert.deepEqual(pool.row, { LARK_MENU_CATALOG: larkMenu, LARK_ALLOWED_CHAT_ID: "oc_chat" });

  await fs.rm(file);
  const later = new PostgresConfigStore(pool, { seedFile: file });
  await later.load();
  assert.equal(later.getSync().LARK_ALLOWED_CHAT_ID, "oc_chat");
  assert.equal(pool.writes, 1, "an existing database row must not be re-seeded from disk");
});

test("concurrent saves keep both changes", async () => {
  const pool = new FakeConfigPool();
  const store = new PostgresConfigStore(pool);
  await store.load();

  await Promise.all([
    store.update((config) => { config.LARK_MENU_CATALOG = larkMenu; }),
    store.update((config) => { config.TELEGRAM_ALLOWED_CHAT_ID = "-100123"; }),
  ]);
  assert.deepEqual(pool.row.LARK_MENU_CATALOG, larkMenu);
  assert.equal(pool.row.TELEGRAM_ALLOWED_CHAT_ID, "-100123");
});

test("a rejected save leaves the stored settings unchanged and later saves still work", async () => {
  const pool = new FakeConfigPool();
  const store = new PostgresConfigStore(pool);
  await store.load();
  await store.update((config) => { config.LARK_WEBHOOK_URL = "https://open.larksuite.com/hook/ok"; });

  await assert.rejects(store.update((config) => {
    config.LARK_WEBHOOK_URL = "https://evil.example/hook";
    throw new Error("Lark Incoming Webhook ไม่ถูกต้อง");
  }));
  assert.equal(pool.row.LARK_WEBHOOK_URL, "https://open.larksuite.com/hook/ok");
  assert.equal(store.getSync().LARK_WEBHOOK_URL, "https://open.larksuite.com/hook/ok");

  await store.update((config) => { config.LARK_MENU_CATALOG = larkMenu; });
  assert.deepEqual(pool.row.LARK_MENU_CATALOG, larkMenu);
});

test("callers get a copy, so editing it cannot change saved settings", async () => {
  const store = new PostgresConfigStore(new FakeConfigPool());
  await store.load();
  await store.update((config) => { config.LARK_MENU_CATALOG = larkMenu; });

  const copy = store.getSync();
  copy.LARK_MENU_CATALOG.push({ id: "injected", system: "x", account: "y" });
  assert.deepEqual(store.getSync().LARK_MENU_CATALOG, larkMenu);
});

test("a save before the first load still loads existing settings first", async () => {
  const pool = new FakeConfigPool();
  pool.row = { LARK_ALLOWED_CHAT_ID: "oc_chat" };
  const store = new PostgresConfigStore(pool);

  await store.update((config) => { config.LARK_MENU_CATALOG = larkMenu; });
  assert.equal(pool.row.LARK_ALLOWED_CHAT_ID, "oc_chat");
  assert.deepEqual(pool.row.LARK_MENU_CATALOG, larkMenu);
});

function getClosedPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

test("the server still starts and answers health checks when the database is unreachable", async (t) => {
  const port = await getClosedPort();
  const deadDatabasePort = await getClosedPort();
  const dataDir = await tempDir(t);
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      DATABASE_URL: `postgres://passly:unused@127.0.0.1:${deadDatabasePort}/passly`,
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });

  const deadline = Date.now() + 15_000;
  let health = null;
  while (Date.now() < deadline && !health) {
    if (child.exitCode !== null) throw new Error(`Passly server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) health = await response.json();
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(health, "server should answer /api/health even without a database");
  assert.equal(health.ok, true);
  assert.equal(health.serverConfigPersistent, false);
  assert.equal(health.larkMenuCatalogCount, 0);
});
