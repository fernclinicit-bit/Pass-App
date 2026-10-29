function loadAdminPinHash(env = process.env) {
  const value = String(env.PASSLY_ADMIN_PIN_HASH || '').trim();
  if (!value) throw new Error('PASSLY_ADMIN_PIN_HASH must be configured');
  if (!value.startsWith('scrypt-v1$')) throw new Error('PASSLY_ADMIN_PIN_HASH must be a valid scrypt-v1 hash');
  return value;
}

module.exports = { loadAdminPinHash };
