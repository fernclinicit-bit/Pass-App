import assert from "node:assert/strict";
import test from "node:test";

const {
  createPortableShareUrl,
  readSharePayload,
} = await import("../share-link.js");

test("portable share URL keeps encrypted data in a LINE-safe query parameter", () => {
  const url = createPortableShareUrl("https://passly.example/app", "encrypted_payload-123");
  assert.equal(url.href, "https://passly.example/share.html?p=encrypted_payload-123");
  assert.equal(url.hash, "");
});

test("share page accepts new query links and legacy fragment links", () => {
  assert.equal(
    readSharePayload("https://passly.example/share.html?p=new-payload"),
    "new-payload",
  );
  assert.equal(
    readSharePayload("https://passly.example/share.html#legacy-payload"),
    "legacy-payload",
  );
});

test("share unlock keeps a stable form reference across asynchronous decryption", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(
    new URL("../share.js", import.meta.url),
    "utf8",
  ));
  assert.match(source, /const form = event\.currentTarget/);
  assert.match(source, /form\.elements\.pin\.value/);
  assert.match(source, /form\.reset\(\)/);
  assert.doesNotMatch(source, /await[\s\S]*event\.currentTarget\.reset\(\)/);
});
