import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  PostgresVaultStore,
  VaultConflictError,
  createVaultStore,
  isEncryptedVaultEnvelope,
} = require("../vault-sync-store.cjs");

const validEnvelope = {
  version: 2,
  algorithm: "AES-GCM-256",
  kdf: "PBKDF2-SHA256",
  iterations: 600000,
  salt: "c2FsdC1mb3ItdGVzdA==",
  iv: "aXYtZm9yLXRlc3Q=",
  data: "ZW5jcnlwdGVkLWNpcGhlcnRleHQ=",
  updatedAt: "2026-08-07T10:00:00.000Z",
};

test("vault sync accepts only an encrypted envelope", () => {
  assert.equal(isEncryptedVaultEnvelope(validEnvelope), true);
  assert.equal(isEncryptedVaultEnvelope({ ...validEnvelope, password: "must-not-reach-server" }), false);
  assert.equal(isEncryptedVaultEnvelope({ ...validEnvelope, algorithm: "plaintext" }), false);
  assert.equal(isEncryptedVaultEnvelope({ ...validEnvelope, data: "short" }), false);
});

test("vault sync falls back to local encrypted storage when DATABASE_URL is absent", () => {
  assert.equal(createVaultStore("").constructor.name, "LocalVaultStore");
});

test("vault conflicts expose only the current revision", () => {
  const error = new VaultConflictError(7);
  assert.equal(error.code, "vault_conflict");
  assert.equal(error.currentRevision, 7);
  assert.doesNotMatch(error.message, /password|pin/i);
});

class FakePool {
  row = null;

  async query(sql) {
    if (sql.includes("CREATE TABLE")) return { rows: [] };
    if (sql.startsWith("SELECT envelope")) return { rows: this.row ? [this.row] : [] };
    throw new Error(`Unexpected pool query: ${sql}`);
  }

  async connect() {
    return {
      query: async (sql, values) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
        if (sql.startsWith("SELECT revision")) {
          return { rows: this.row ? [{ revision: this.row.revision }] : [] };
        }
        if (sql.includes("INSERT INTO")) {
          this.row = {
            envelope: JSON.parse(values[0]),
            revision: values[1],
            updated_at: new Date("2026-08-07T10:00:00.000Z"),
          };
          return { rows: [this.row] };
        }
        if (sql.includes("UPDATE passly_encrypted_vault")) {
          this.row = {
            envelope: JSON.parse(values[0]),
            revision: values[1],
            updated_at: new Date("2026-08-07T10:05:00.000Z"),
          };
          return { rows: [this.row] };
        }
        throw new Error(`Unexpected client query: ${sql}`);
      },
      release() {},
    };
  }
}

test("postgres store creates, reads, updates, and rejects stale revisions", async () => {
  const store = new PostgresVaultStore(new FakePool());
  const created = await store.put(validEnvelope, 0);
  assert.equal(created.revision, 1);
  assert.deepEqual((await store.get()).envelope, validEnvelope);

  await assert.rejects(() => store.put(validEnvelope, 0), (error) => {
    assert.equal(error.code, "vault_conflict");
    assert.equal(error.currentRevision, 1);
    return true;
  });

  const updated = await store.put({ ...validEnvelope, data: `${validEnvelope.data}AA` }, 1);
  assert.equal(updated.revision, 2);
});
