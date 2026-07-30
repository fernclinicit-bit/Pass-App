import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appSource = fs.readFileSync(path.join(projectRoot, "app.js"), "utf8");
const pageSource = fs.readFileSync(path.join(projectRoot, "index.html"), "utf8");

test("login stays active without an inactivity or sleep auto-lock timer", () => {
  assert.doesNotMatch(
    appSource,
    /\b(lockTimeout|lockDeadline|lockTimer|countdownTimer|resetLockTimer|armLockTimer|resumeVaultSession)\b/,
  );
  assert.doesNotMatch(pageSource, /id="lockTimeout"/);
  assert.match(pageSource, /ระบบจะไม่ล็อกอัตโนมัติ/);
  assert.match(pageSource, /ออกจากระบบ/);
});

test("manual logout remains available", () => {
  assert.match(pageSource, /id="lockVaultBtn"/);
  assert.match(
    appSource,
    /\$\("#lockVaultBtn"\)\.addEventListener\("click", \(\) => lockVault\("ผู้ดูแลกดออกจากระบบ"\)\)/,
  );
});
