const crypto = require('crypto');

const PIN_HASH_VERSION = 'scrypt-v1';
const PIN_HASH_LENGTH = 64;
const SCRYPT_PARAMS = Object.freeze({
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
});
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function normalizePin(value) {
  const normalized = String(value ?? '').normalize('NFKC').trim();
  if (/^[0-9๐-๙\s-]+$/u.test(normalized)) {
    return normalized
      .replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
      .replace(/[\s-]/g, '');
  }
  return normalized;
}

function scrypt(pin, salt, length, options) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pin, salt, length, options, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
}

function parsePinHash(encoded) {
  const [version, nValue, rValue, pValue, saltValue, digestValue, ...extra] =
    String(encoded || '').split('$');
  const N = Number(nValue);
  const r = Number(rValue);
  const p = Number(pValue);
  if (
    version !== PIN_HASH_VERSION
    || extra.length
    || !Number.isInteger(N)
    || !Number.isInteger(r)
    || !Number.isInteger(p)
    || N < 16_384
    || N > 131_072
    || (N & (N - 1)) !== 0
    || r < 1
    || r > 32
    || p < 1
    || p > 4
  ) return null;

  try {
    const salt = Buffer.from(saltValue, 'base64url');
    const digest = Buffer.from(digestValue, 'base64url');
    if (salt.length < 16 || digest.length !== PIN_HASH_LENGTH) return null;
    return { N, r, p, salt, digest };
  } catch {
    return null;
  }
}

async function createPinHash(pin, options = {}) {
  const normalized = normalizePin(pin);
  if (normalized.length < 4 || normalized.length > 128) {
    throw new Error('PIN must contain between 4 and 128 characters');
  }
  const salt = options.salt || crypto.randomBytes(16);
  const N = options.N || SCRYPT_PARAMS.N;
  const r = options.r || SCRYPT_PARAMS.r;
  const p = options.p || SCRYPT_PARAMS.p;
  const digest = await scrypt(normalized, salt, PIN_HASH_LENGTH, {
    N,
    r,
    p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return [
    PIN_HASH_VERSION,
    N,
    r,
    p,
    Buffer.from(salt).toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

async function verifyPinHash(pin, encoded) {
  const parsed = parsePinHash(encoded);
  if (!parsed) return false;
  const normalized = normalizePin(pin);
  if (normalized.length < 4 || normalized.length > 128) return false;
  const candidate = await scrypt(normalized, parsed.salt, parsed.digest.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return candidate.length === parsed.digest.length
    && crypto.timingSafeEqual(candidate, parsed.digest);
}

function sessionSigningKey(pinHash) {
  return crypto
    .createHash('sha256')
    .update('passly-admin-session-v1\0')
    .update(String(pinHash || ''))
    .digest();
}

function createSessionToken(pinHash, options = {}) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    exp: now + ttlMs,
    nonce: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSigningKey(pinHash))
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifySessionToken(token, pinHash, now = Date.now()) {
  const [payload, signature, ...extra] = String(token || '').split('.');
  if (!payload || !signature || extra.length) return false;
  const expected = crypto
    .createHmac('sha256', sessionSigningKey(pinHash))
    .update(payload)
    .digest();
  let actual;
  try {
    actual = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.v === 1
      && Number.isFinite(parsed.exp)
      && parsed.exp > now
      && parsed.exp <= now + SESSION_TTL_MS;
  } catch {
    return false;
  }
}

module.exports = {
  PIN_HASH_VERSION,
  SESSION_TTL_MS,
  createPinHash,
  createSessionToken,
  normalizePin,
  parsePinHash,
  verifyPinHash,
  verifySessionToken,
};
