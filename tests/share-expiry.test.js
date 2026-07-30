import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_SHARE_EXPIRY_MS,
  resolveShareExpiry,
  toLocalDatetimeValue,
} = await import("../vault-crypto.js");

test("share expiry supports presets and a custom local date-time", () => {
  const now = new Date("2026-07-30T08:00:00.000Z").getTime();
  assert.equal(
    resolveShareExpiry("8", "", now),
    new Date(now + 8 * 3_600_000).toISOString(),
  );

  const customValue = "2026-08-02T15:30";
  assert.equal(
    resolveShareExpiry("custom", customValue, now),
    new Date(customValue).toISOString(),
  );
  assert.match(toLocalDatetimeValue(new Date(now)), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
});

test("custom share expiry rejects missing, past, and over-30-day values", () => {
  const now = Date.now();
  assert.throws(
    () => resolveShareExpiry("custom", "", now),
    /กำหนดวันและเวลา/,
  );
  assert.throws(
    () => resolveShareExpiry("custom", toLocalDatetimeValue(new Date(now - 60_000)), now),
    /อยู่ในอนาคต/,
  );
  assert.throws(
    () => resolveShareExpiry(
      "custom",
      toLocalDatetimeValue(new Date(now + MAX_SHARE_EXPIRY_MS + 3_600_000)),
      now,
    ),
    /สูงสุด 30 วัน/,
  );
});
