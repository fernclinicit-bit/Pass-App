const SENSITIVE_KEY = /password|secret|token|pin|api.?key/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, sanitize(item)]));
}

function createHealthReport({ service, version, checks, now = new Date() }) {
  const safeChecks = sanitize(checks || {});
  const status = Object.values(safeChecks).every((check) => check && check.status === 'ok') ? 'ok' : 'error';
  return { status, service, version, timestamp: now.toISOString(), checks: safeChecks };
}

module.exports = { createHealthReport };
