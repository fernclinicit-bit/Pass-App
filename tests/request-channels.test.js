import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createPinHash } = require("../pin-auth.cjs");

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

function collectPostbackActions(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (value.action?.type === "postback") result.push(value.action);
  for (const child of Object.values(value)) collectPostbackActions(child, result);
  return result;
}

test("delivery menu offers LINE by default without Lark", async () => {
  const html = await fs.readFile(path.join(projectRoot, "index.html"), "utf8");
  const app = await fs.readFile(path.join(projectRoot, "app.js"), "utf8");

  assert.match(html, /name="channel" id="deliveryChannel"/);
  assert.match(html, /option value="line" selected>ส่งเข้า LINE/);
  assert.match(html, /option value="copy">คัดลอกข้อความ/);
  assert.doesNotMatch(html, /ส่งลิงก์เข้า Lark/);
  assert.match(app, /channel === "line"/);
  assert.match(app, /sendLineDelivery/);
  assert.match(html, /id="lineReconnectBtn"/);
  assert.match(app, /เซสชัน Server หมดอายุ · กดเชื่อมต่อใหม่/);
  assert.match(app, /authenticateServerPin\(pin\)/);
  assert.match(await fs.readFile(path.join(projectRoot, "server.cjs"), "utf8"), /type: 'flex'/);
  assert.match(html, /id="deliveryExpiry"/);
  assert.match(html, /option value="custom">กำหนดวันและเวลาเอง/);
  assert.match(html, /name="customExpiryAt"/);
  assert.match(app, /resolveShareExpiry/);
});

test("LINE password requests and secure delivery work end to end", async (context) => {
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "passly-line-test-"));
  const adminPin = "request-test-pin";
  const adminPinHash = await createPinHash(adminPin);
  const lineCalls = [];
  const lineApi = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    lineCalls.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.method === "GET" ? JSON.stringify({ displayName: "LINE Test User" }) : "{}");
  });
  lineApi.listen(0, "127.0.0.1");
  await once(lineApi, "listening");
  const lineApiUrl = `http://127.0.0.1:${lineApi.address().port}`;
  const child = spawn(process.execPath, ["server.cjs"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      LINE_CHANNEL_SECRET: "test-line-secret",
      LINE_CHANNEL_ACCESS_TOKEN: "test-line-token",
      LINE_API_BASE_URL: lineApiUrl,
      DATA_DIR: dataDir,
      PASSLY_ADMIN_PIN_HASH: adminPinHash,
    },
    stdio: "ignore",
  });

  context.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    lineApi.close();
    await once(lineApi, "close");
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const healthResponse = await waitForServer(`${baseUrl}/api/health`, child);
  const health = await healthResponse.json();
  assert.equal(health.requestChannel, "LINE");
  assert.equal(health.deliveryChannel, "LINE");
  assert.equal(health.larkInboundEnabled, true);
  assert.equal(health.adminPinConfigured, true);

  const authResponse = await fetch(`${baseUrl}/api/auth/pin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: adminPin }),
  });
  assert.equal(authResponse.status, 200);
  const adminCookie = authResponse.headers.get("set-cookie").split(";")[0];

  const larkInbound = await fetch(`${baseUrl}/api/lark/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "test" }),
  });
  assert.equal(larkInbound.status, 200);
  assert.deepEqual(await larkInbound.json(), { challenge: "test" });

  const unsignedLine = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ events: [] }),
  });
  assert.equal(unsignedLine.status, 401);

  const menuPayload = JSON.stringify({
    events: [{
      type: "message",
      webhookEventId: "WEBHOOK-MENU-1",
      timestamp: Date.now(),
      replyToken: "test-menu-reply-token",
      source: { type: "group", groupId: "C-test-group", userId: "U-test-user" },
      message: { type: "text", id: "menu-message-1", text: "เมนู" },
    }],
  });
  const menuSignature = crypto.createHmac("sha256", "test-line-secret").update(menuPayload).digest("base64");
  const menuResponse = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": menuSignature },
    body: menuPayload,
  });
  assert.equal(menuResponse.status, 200);
  const menuReply = lineCalls.find((call) => call.body?.replyToken === "test-menu-reply-token");
  assert.equal(menuReply.body.messages[0].type, "flex");
  assert.equal(menuReply.body.messages[0].contents.type, "carousel");
  assert.equal(menuReply.body.messages[0].contents.contents.length, 2);
  assert.equal(menuReply.body.messages[0].contents.contents[0].body.contents.length, 6);
  assert.ok(
    menuReply.body.messages[0].contents.contents
      .flatMap((bubble) => bubble.body.contents)
      .every((row) => row.type === "box" && row.layout === "vertical"),
    "every main-menu choice should occupy one full-width row",
  );
  assert.equal(menuReply.body.messages[0].quickReply, undefined);

  const submenuPayload = JSON.stringify({
    events: [{
      type: "postback",
      webhookEventId: "WEBHOOK-SUBMENU-1",
      timestamp: Date.now(),
      replyToken: "test-submenu-reply-token",
      source: { type: "group", groupId: "C-test-group", userId: "U-test-user" },
      postback: { data: new URLSearchParams({ action: "submenu", system: "Microsoft" }).toString() },
    }],
  });
  const submenuSignature = crypto.createHmac("sha256", "test-line-secret").update(submenuPayload).digest("base64");
  const submenuResponse = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": submenuSignature },
    body: submenuPayload,
  });
  assert.equal(submenuResponse.status, 200);
  assert.equal((await submenuResponse.json()).received, 0);
  const submenuReply = lineCalls.find((call) => call.body?.replyToken === "test-submenu-reply-token");
  assert.equal(submenuReply.body.messages[0].type, "flex");
  assert.equal(submenuReply.body.messages[0].contents.body.contents.length, 4);
  assert.match(submenuReply.body.messages[0].contents.body.contents[0].action.data, /action=request/);

  const longSystemName = "ระบบจัดการบัญชีโฆษณาสำหรับคลินิก";
  const catalogItems = [
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `login-main-${index + 1}`,
      system: "ระบบหลัก",
      account: `บัญชี ${index + 1}`,
      password: `must-not-be-stored-${index + 1}`,
    })),
    ...Array.from({ length: 12 }, (_, index) => ({
      id: `login-system-${index + 1}`,
      system: index === 11 ? longSystemName : `ระบบ ${index + 1}`,
      account: "บัญชีหลัก",
      password: `must-not-be-stored-system-${index + 1}`,
    })),
  ];
  const catalogResponse = await fetch(`${baseUrl}/api/line/catalog`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: adminCookie },
    body: JSON.stringify({ items: catalogItems }),
  });
  assert.equal(catalogResponse.status, 200);
  assert.equal((await catalogResponse.json()).count, 24);
  const storedLineConfig = await fs.readFile(path.join(dataDir, "config.json"), "utf8");
  assert.doesNotMatch(storedLineConfig, /must-not-be-stored/);

  const completeMenuPayload = JSON.stringify({
    events: [{
      type: "message",
      webhookEventId: "WEBHOOK-COMPLETE-MENU-1",
      timestamp: Date.now(),
      replyToken: "test-complete-menu-reply-token",
      source: { type: "group", groupId: "C-test-group", userId: "U-test-user" },
      message: { type: "text", id: "complete-menu-message-1", text: "เมนู" },
    }],
  });
  const completeMenuSignature = crypto.createHmac("sha256", "test-line-secret").update(completeMenuPayload).digest("base64");
  await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": completeMenuSignature },
    body: completeMenuPayload,
  });
  const completeMenuReply = lineCalls.find((call) => call.body?.replyToken === "test-complete-menu-reply-token");
  assert.equal(completeMenuReply.body.messages[0].contents.type, "carousel");
  assert.equal(completeMenuReply.body.messages[0].contents.contents.length, 3);
  assert.match(JSON.stringify(completeMenuReply.body.messages[0]), new RegExp(longSystemName));
  assert.ok(
    completeMenuReply.body.messages[0].contents.contents
      .flatMap((bubble) => bubble.body.contents)
      .some((button) => button.contents?.[0]?.text === longSystemName
        && button.contents[0].size === "xs"
        && button.contents[0].wrap === true),
    "long menu labels should be shown in full with small wrapping text",
  );
  const completeMenuActions = collectPostbackActions(completeMenuReply.body.messages[0]);
  assert.equal(completeMenuActions.length, 13);
  const dynamicSubmenuAction = completeMenuActions.find((action) => action.data.includes("action=submenu"));
  assert.ok(dynamicSubmenuAction);

  const completeSubmenuPayload = JSON.stringify({
    events: [{
      type: "postback",
      webhookEventId: "WEBHOOK-COMPLETE-SUBMENU-1",
      timestamp: Date.now(),
      replyToken: "test-complete-submenu-reply-token",
      source: { type: "group", groupId: "C-test-group", userId: "U-test-user" },
      postback: { data: dynamicSubmenuAction.data },
    }],
  });
  const completeSubmenuSignature = crypto.createHmac("sha256", "test-line-secret").update(completeSubmenuPayload).digest("base64");
  await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": completeSubmenuSignature },
    body: completeSubmenuPayload,
  });
  const completeSubmenuReply = lineCalls.find((call) => call.body?.replyToken === "test-complete-submenu-reply-token");
  assert.equal(completeSubmenuReply.body.messages[0].contents.type, "carousel");
  assert.equal(completeSubmenuReply.body.messages[0].contents.contents.length, 3);
  assert.equal(
    collectPostbackActions(completeSubmenuReply.body.messages[0]).filter((action) => action.data.includes("action=request")).length,
    12,
  );

  const accountPayload = JSON.stringify({
    events: [{
      type: "postback",
      webhookEventId: "WEBHOOK-ACCOUNT-1",
      timestamp: Date.now(),
      replyToken: "test-account-reply-token",
      source: { type: "group", groupId: "C-test-group", userId: "U-test-user" },
      postback: { data: new URLSearchParams({ action: "request", system: "Microsoft", account: "ทีม Data 152603" }).toString() },
    }],
  });
  const accountSignature = crypto.createHmac("sha256", "test-line-secret").update(accountPayload).digest("base64");
  const accountResponse = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-line-signature": accountSignature },
    body: accountPayload,
  });
  assert.equal(accountResponse.status, 200);
  assert.equal((await accountResponse.json()).received, 1);

  const larkOutbound = await fetch(`${baseUrl}/api/lark`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "delivery test" }),
  });
  assert.equal(larkOutbound.status, 400);

  const webhookPayload = JSON.stringify({
    events: [{
      type: "postback",
      webhookEventId: "WEBHOOK-DELIVERY-1",
      timestamp: Date.now(),
      replyToken: "test-reply-token",
      source: {
        type: "group",
        groupId: "C-test-group",
        userId: "U-test-user",
      },
      postback: {
        data: new URLSearchParams({ action: "request", system: "Google Workspace" }).toString(),
      },
    }],
  });
  const signature = crypto.createHmac("sha256", "test-line-secret").update(webhookPayload).digest("base64");
  const webhookResponse = await fetch(`${baseUrl}/api/line/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
    body: webhookPayload,
  });
  assert.equal(webhookResponse.status, 200);
  assert.equal((await webhookResponse.json()).received, 1);

  const requestList = await fetch(`${baseUrl}/api/requests`, {
    headers: { cookie: adminCookie },
  }).then((response) => response.json());
  const lineRequest = requestList.requests[0];
  assert.equal(lineRequest.lineGroupId, "C-test-group");
  assert.equal(lineRequest.name, "LINE Test User");

  const shareUrl = `${baseUrl}/share.html?p=encrypted-payload`;
  const tooLongDelivery = await fetch(`${baseUrl}/api/line/deliver`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminCookie,
    },
    body: JSON.stringify({
      requestId: lineRequest.id,
      itemName: "Google Workspace",
      expiresAt: new Date(Date.now() + 31 * 24 * 3_600_000).toISOString(),
      shareUrl,
      pin: "Abc12345",
    }),
  });
  assert.equal(tooLongDelivery.status, 400);

  const deliveryResponse = await fetch(`${baseUrl}/api/line/deliver`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: adminCookie,
    },
    body: JSON.stringify({
      requestId: lineRequest.id,
      itemName: "Google Workspace",
      expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000).toISOString(),
      shareUrl,
      pin: "Abc12345",
    }),
  });
  const deliveryResult = await deliveryResponse.json();
  assert.equal(deliveryResponse.status, 200, JSON.stringify(deliveryResult));
  assert.equal(deliveryResult.deliveredTo, "LINE");

  const pushCall = lineCalls.find((call) => call.url === "/v2/bot/message/push");
  assert.ok(pushCall, "LINE Push API should be called");
  assert.equal(pushCall.body.to, "C-test-group");
  assert.equal(pushCall.body.messages.length, 2);
  assert.match(pushCall.body.messages[0].text, /share\.html\?p=encrypted-payload/);
  assert.match(pushCall.body.messages[1].text, /Abc12345/);

  const deliveredList = await fetch(`${baseUrl}/api/requests`, {
    headers: { cookie: adminCookie },
  }).then((response) => response.json());
  assert.equal(deliveredList.requests[0].status, "delivered");
  assert.equal(deliveredList.requests[0].deliveryMethod, "line-secure-share");
});
