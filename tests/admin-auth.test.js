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
const {
  createPinHash,
  createSessionToken,
  normalizePin,
  verifyPinHash,
  verifySessionToken,
} = require("../pin-auth.cjs");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Passly server exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error("Passly server did not start in time");
}

test("PIN normalization matches the browser vault format", () => {
  assert.equal(normalizePin(" ๑๒๓-๔๕๖ "), "123456");
  assert.equal(normalizePin("123 456"), "123456");
});

test("Scrypt verifier and signed session never contain the original PIN", async () => {
  const pin = "987654";
  const hash = await createPinHash(pin, { salt: Buffer.alloc(16, 7) });
  assert.doesNotMatch(hash, new RegExp(pin));
  assert.equal(await verifyPinHash(pin, hash), true);
  assert.equal(await verifyPinHash("987653", hash), false);

  const token = createSessionToken(hash, { now: 1_000, ttlMs: 10_000 });
  assert.doesNotMatch(token, new RegExp(pin));
  assert.equal(verifySessionToken(token, hash, 2_000), true);
  assert.equal(verifySessionToken(token, hash, 12_000), false);
});

test("admin API requires the configured PIN and issues an HttpOnly session", async (context) => {
  const pin = "987654";
  const pinHash = await createPinHash(pin);
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "passly-auth-test-"));
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      DATA_DIR: dataDir,
      PASSLY_ADMIN_PIN_HASH: pinHash,
    },
    stdio: "ignore",
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const health = await (await waitForServer(`${baseUrl}/api/health`, child)).json();
  assert.equal(health.adminPinConfigured, true);

  const unauthorized = await fetch(`${baseUrl}/api/requests`);
  assert.equal(unauthorized.status, 401);

  const syncStatus = await (await fetch(`${baseUrl}/api/vault/status`)).json();
  assert.deepEqual(syncStatus, { ok: true, available: true, exists: false });

  const unauthorizedVault = await fetch(`${baseUrl}/api/vault`);
  assert.equal(unauthorizedVault.status, 401);

  const wrong = await fetch(`${baseUrl}/api/auth/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: "987653" }),
  });
  assert.equal(wrong.status, 401);

  const authenticated = await fetch(`${baseUrl}/api/auth/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const authBody = await authenticated.text();
  const setCookie = authenticated.headers.get("set-cookie");
  assert.equal(authenticated.status, 200);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Secure/i);
  assert.doesNotMatch(`${authBody}${setCookie}`, new RegExp(pin));

  const cookie = setCookie.split(";")[0];
  const authorized = await fetch(`${baseUrl}/api/requests`, {
    headers: { cookie },
  });
  assert.equal(authorized.status, 200);

  const unavailableVault = await fetch(`${baseUrl}/api/vault`, {
    headers: { cookie },
  });
  assert.equal(unavailableVault.status, 404);

  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
});
