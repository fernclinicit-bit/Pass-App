import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

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

test("password requests are accepted from LINE only", async (context) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      LINE_CHANNEL_SECRET: "test-line-secret",
      LINE_CHANNEL_ACCESS_TOKEN: "",
      LARK_WEBHOOK_URL: "",
    },
    stdio: "ignore",
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
  });

  const healthResponse = await waitForServer(`${baseUrl}/api/health`, child);
  const health = await healthResponse.json();
  assert.equal(health.requestChannel, "LINE");
  assert.equal(health.larkInboundEnabled, false);

  const larkInbound = await fetch(`${baseUrl}/api/lark/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "test" }),
  });
  assert.equal(larkInbound.status, 404);

  const unsignedLine = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(unsignedLine.status, 401);

  const larkOutbound = await fetch(`${baseUrl}/api/lark`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "delivery test" }),
  });
  assert.equal(larkOutbound.status, 400);
});
