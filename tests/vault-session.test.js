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
  readVaultArchive,
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

test("a PIN captured before async verification survives form-value changes and logout save", async () => {
  const formState = { password: "246810" };
  const capturedPin = formState.password;
  await Promise.resolve().then(() => {
    formState.password = "";
  });

  const storage = new MemoryStorage();
  const created = await createVaultEnvelope({ revision: 1 }, capturedPin);
  commitVaultEnvelope(storage, created.envelope, {
    preserveCurrentAsBackup: false,
  });
  await queueVaultSave(Promise.resolve(), {
    storage,
    vault: { revision: 2 },
    key: created.key,
    envelope: created.envelope,
  });

  const unlocked = await unlockStoredVault(storage, "246810");
  assert.equal(unlocked.vault.revision, 2);
  assert.equal(formState.password, "");
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

test("a stale tab cannot combine its old key with a replacement vault envelope", async () => {
  const storage = new MemoryStorage();
  const stale = await createVaultEnvelope({ revision: "stale" }, "stale-session-pin");
  const replacement = await createVaultEnvelope({ revision: "replacement" }, "current-server-pin");
  commitVaultEnvelope(storage, replacement.envelope, {
    preserveCurrentAsBackup: false,
    clearBackup: true,
  });

  await assert.rejects(
    queueVaultSave(Promise.resolve(), {
      storage,
      vault: { revision: "stale-overwrite" },
      key: stale.key,
      envelope: stale.envelope,
    }),
    /Vault ถูกเปลี่ยน/,
  );

  const unlocked = await unlockStoredVault(storage, "current-server-pin");
  assert.equal(unlocked.vault.revision, "replacement");
});

test("unlock automatically promotes a compatible browser archive without losing the failed vault", async () => {
  const storage = new MemoryStorage();
  const compatible = await createVaultEnvelope(
    { items: [{ name: "Recoverable archive" }] },
    "current-server-pin",
  );
  commitVaultEnvelope(storage, compatible.envelope, {
    preserveCurrentAsBackup: false,
  });
  archiveAndResetStoredVault(storage);

  const incompatible = await createVaultEnvelope(
    { items: [{ name: "Vault encrypted with an old PIN" }] },
    "old-pin",
  );
  commitVaultEnvelope(storage, incompatible.envelope, {
    preserveCurrentAsBackup: false,
  });

  const unlocked = await unlockStoredVault(storage, "current-server-pin");

  assert.equal(unlocked.recoverySource, "archive");
  assert.equal(unlocked.vault.items[0].name, "Recoverable archive");
  assert.deepEqual(readVaultEnvelope(storage), compatible.envelope);
  assert.deepEqual(readVaultArchive(storage).current, incompatible.envelope);
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

test("a second reset preserves the older browser archive while returning a new download", async () => {
  const storage = new MemoryStorage();
  const older = await createVaultEnvelope({ items: [{ name: "Older important vault" }] }, "older-pin");
  commitVaultEnvelope(storage, older.envelope, {
    preserveCurrentAsBackup: false,
  });
  const olderArchive = archiveAndResetStoredVault(storage);

  const newer = await createVaultEnvelope({ items: [] }, "newer-pin");
  commitVaultEnvelope(storage, newer.envelope, {
    preserveCurrentAsBackup: false,
  });
  const newerDownload = archiveAndResetStoredVault(storage);

  assert.deepEqual(readVaultArchive(storage), olderArchive);
  assert.deepEqual(newerDownload.current, newer.envelope);

  restoreVaultArchive(storage, readVaultArchive(storage));
  const unlocked = await unlockStoredVault(storage, "older-pin");
  assert.equal(unlocked.vault.items[0].name, "Older important vault");
});
