import test from 'node:test';
import assert from 'node:assert/strict';
import securityConfig from '../security-config.cjs';

const { loadAdminPinHash } = securityConfig;

test('requires PASSLY_ADMIN_PIN_HASH without a legacy fallback', () => {
  assert.throws(() => loadAdminPinHash({}), /PASSLY_ADMIN_PIN_HASH/);
});

test('accepts an explicit scrypt hash', () => {
  const value = 'scrypt-v1$16384$8$1$abcdefghijklmnop$' + 'a'.repeat(86);
  assert.equal(loadAdminPinHash({ PASSLY_ADMIN_PIN_HASH: value }), value);
});
