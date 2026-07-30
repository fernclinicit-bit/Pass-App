import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
if (!globalThis.btoa) {
  globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}
if (!globalThis.atob) {
  globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}

const {
  KDF_ITERATIONS,
  MASTER_PASSWORD_NORMALIZATION,
  VAULT_SECRET_CANONICALIZATION,
  VAULT_SECRET_ENCODING,
  bytesToBase64,
  createVaultEnvelope,
  deriveVaultKey,
  encryptVault,
  randomBytes,
} = await import("../vault-crypto.js");
const {
  VAULT_ARCHIVE_STORAGE_KEY,
  VAULT_BACKUP_STORAGE_KEY,
  archiveAndResetStoredVault,
  commitVaultEnvelope,
  isVaultArchive,
  queueVaultSave,
  readVaultEnvelope,
  restoreVaultArchive,
  unlockStoredVault,
} = await import("../vault-storage.js");

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }
}

test("new vaults unlock with canonically equivalent Unicode master passwords", async () => {
  const vault = { items: [{ name: "LINE Account 1" }] };
  const created = await createVaultEnvelope(vault, "Cafe\u0301-รหัสผ่าน-ปลอดภัย");
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });

  const unlocked = await unlockStoredVault(storage, "Café-รหัสผ่าน-ปลอดภัย");

  assert.deepEqual(unlocked.vault, vault);
  assert.equal(unlocked.recovered, false);
  assert.equal(created.envelope.passwordNormalization, "NFKC");
  assert.equal(created.envelope.secretCanonicalization, VAULT_SECRET_CANONICALIZATION);
  assert.equal(created.envelope.secretEncoding, VAULT_SECRET_ENCODING);
});

test("new 64-byte login encoding treats formatted Thai and ASCII PINs consistently", async () => {
  const vault = { items: [{ name: "PIN protected" }] };
  const created = await createVaultEnvelope(vault, " ๑๒๓-๔๕๖ ");
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });

  const unlocked = await unlockStoredVault(storage, "123 456");

  assert.deepEqual(unlocked.vault, vault);
  assert.equal(unlocked.envelope.secretEncoding, "SHA-512-64-BYTE");
});

test("existing normalized vaults retry trimmed and Thai-digit PIN forms", async () => {
  const vault = { items: [{ name: "Existing PIN vault" }] };
  const salt = randomBytes(16);
  const key = await deriveVaultKey("123456", salt, KDF_ITERATIONS);
  const envelope = await encryptVault(vault, key, {
    salt: bytesToBase64(salt),
    iterations: KDF_ITERATIONS,
    passwordNormalization: MASTER_PASSWORD_NORMALIZATION,
  });
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, envelope, {
    preserveCurrentAsBackup: false,
  });

  const unlocked = await unlockStoredVault(storage, " ๑๒๓-๔๕๖ ");

  assert.deepEqual(unlocked.vault, vault);
  assert.equal(unlocked.recovered, false);
});

test("legacy vaults try compatible Unicode forms without changing their encryption", async () => {
  const vault = { items: [{ name: "Legacy" }] };
  const legacyPassword = "Cafe\u0301-legacy-master";
  const salt = randomBytes(16);
  const key = await deriveVaultKey(legacyPassword, salt, KDF_ITERATIONS);
  const envelope = await encryptVault(vault, key, {
    salt: bytesToBase64(salt),
    iterations: KDF_ITERATIONS,
  });
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, envelope, {
    preserveCurrentAsBackup: false,
  });

  const unlocked = await unlockStoredVault(storage, "Café-legacy-master");

  assert.deepEqual(unlocked.vault, vault);
  assert.equal(unlocked.recovered, false);
});

test("a damaged current snapshot is restored from the encrypted backup", async () => {
  const password = "backup-recovery-master-123";
  const vault = { items: [{ name: "Important credential" }] };
  const created = await createVaultEnvelope(vault, password);
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });
  storage.setItem(VAULT_BACKUP_STORAGE_KEY, JSON.stringify(created.envelope));

  const damaged = {
    ...created.envelope,
    data: `${created.envelope.data[0] === "A" ? "B" : "A"}${created.envelope.data.slice(1)}`,
  };
  storage.setItem("passly-encrypted-vault-v1", JSON.stringify(damaged));

  const unlocked = await unlockStoredVault(storage, password);

  assert.deepEqual(unlocked.vault, vault);
  assert.equal(unlocked.recovered, true);
  assert.deepEqual(readVaultEnvelope(storage), created.envelope);
});

test("queued saves retain their encryption key when the session locks", async () => {
  const password = "sleep-safe-master-password";
  const created = await createVaultEnvelope({ revision: 1 }, password);
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });

  let releasePreviousSave;
  const previousSave = new Promise((resolve) => {
    releasePreviousSave = resolve;
  });
  let sessionKey = created.key;
  const pendingSave = queueVaultSave(previousSave, {
    storage,
    vault: { revision: 2 },
    key: sessionKey,
    envelope: created.envelope,
  });

  sessionKey = null;
  releasePreviousSave();
  await pendingSave;

  const unlocked = await unlockStoredVault(storage, password);
  assert.equal(unlocked.vault.revision, 2);
});

test("reset archives both encrypted snapshots and restores them without decrypting", async () => {
  const password = "archived-vault-master";
  const created = await createVaultEnvelope({ items: [{ name: "Preserved" }] }, password);
  const storage = new MemoryStorage();
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });
  storage.setItem(VAULT_BACKUP_STORAGE_KEY, JSON.stringify(created.envelope));

  const archive = archiveAndResetStoredVault(storage);

  assert.equal(readVaultEnvelope(storage), null);
  assert.equal(readVaultEnvelope(storage, VAULT_BACKUP_STORAGE_KEY), null);
  assert.equal(isVaultArchive(JSON.parse(storage.getItem(VAULT_ARCHIVE_STORAGE_KEY))), true);

  restoreVaultArchive(storage, archive);
  const unlocked = await unlockStoredVault(storage, password);
  assert.equal(unlocked.vault.items[0].name, "Preserved");
});
