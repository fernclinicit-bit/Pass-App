import {
  VAULT_STORAGE_KEY,
  encryptVault,
  unlockVaultEnvelope,
} from "./vault-crypto.js";

export const VAULT_BACKUP_STORAGE_KEY = "passly-encrypted-vault-backup-v1";

export function isVaultEnvelope(value) {
  return Boolean(
    value
    && typeof value === "object"
    && typeof value.salt === "string"
    && typeof value.iv === "string"
    && typeof value.data === "string"
    && (value.iterations === undefined
      || Number.isFinite(Number(value.iterations))),
  );
}

export function readVaultEnvelope(storage, key = VAULT_STORAGE_KEY) {
  try {
    const envelope = JSON.parse(storage.getItem(key) || "null");
    return isVaultEnvelope(envelope) ? envelope : null;
  } catch {
    return null;
  }
}

export function commitVaultEnvelope(
  storage,
  envelope,
  { preserveCurrentAsBackup = true, clearBackup = false } = {},
) {
  if (!isVaultEnvelope(envelope)) throw new Error("รูปแบบ Vault ไม่ถูกต้อง");

  const current = readVaultEnvelope(storage);
  if (clearBackup) {
    storage.removeItem(VAULT_BACKUP_STORAGE_KEY);
  } else if (preserveCurrentAsBackup && current) {
    storage.setItem(VAULT_BACKUP_STORAGE_KEY, JSON.stringify(current));
  }

  storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(envelope));
}

export function removeStoredVault(storage) {
  storage.removeItem(VAULT_STORAGE_KEY);
  storage.removeItem(VAULT_BACKUP_STORAGE_KEY);
}

export function queueVaultSave(
  previousSave,
  { storage, vault, key, envelope, onPreviousError = console.error },
) {
  const snapshot = structuredClone(vault);
  const keyForSave = key;
  const envelopeForSave = structuredClone(envelope);

  return Promise.resolve(previousSave)
    .catch((error) => {
      onPreviousError(error);
    })
    .then(async () => {
      const next = await encryptVault(snapshot, keyForSave, envelopeForSave);
      commitVaultEnvelope(storage, next);
    });
}

function legacyPasswordCandidates(password) {
  const candidates = [
    password,
    password.normalize("NFC"),
    password.normalize("NFD"),
    password.normalize("NFKC"),
    password.normalize("NFKD"),
  ];
  const trimmed = password.trim();
  if (trimmed !== password) {
    candidates.push(
      trimmed,
      trimmed.normalize("NFC"),
      trimmed.normalize("NFD"),
      trimmed.normalize("NFKC"),
      trimmed.normalize("NFKD"),
    );
  }
  return [...new Set(candidates)];
}

async function unlockCompatibleEnvelope(envelope, password) {
  if (envelope.passwordNormalization) {
    return unlockVaultEnvelope(envelope, password);
  }

  let lastError;
  for (const candidate of legacyPasswordCandidates(password)) {
    try {
      return await unlockVaultEnvelope(envelope, candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function unlockStoredVault(storage, password) {
  const current = readVaultEnvelope(storage);
  const backup = readVaultEnvelope(storage, VAULT_BACKUP_STORAGE_KEY);
  let currentError;

  if (current) {
    try {
      const result = await unlockCompatibleEnvelope(current, password);
      if (!backup) {
        storage.setItem(VAULT_BACKUP_STORAGE_KEY, JSON.stringify(current));
      }
      return { ...result, envelope: current, recovered: false };
    } catch (error) {
      currentError = error;
    }
  }

  if (backup) {
    try {
      const result = await unlockCompatibleEnvelope(backup, password);
      commitVaultEnvelope(storage, backup, {
        preserveCurrentAsBackup: false,
      });
      return { ...result, envelope: backup, recovered: true };
    } catch (error) {
      currentError ||= error;
    }
  }

  if (!current && !backup) throw new Error("ไม่พบ Vault ที่บันทึกไว้");
  throw currentError || new Error("ไม่สามารถถอดรหัส Vault ได้");
}
