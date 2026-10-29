import test from 'node:test';
import assert from 'node:assert/strict';
import healthContract from '../health-contract.cjs';

test('uses the shared health fields and redacts sensitive check fields', () => {
  const report = healthContract.createHealthReport({ service: 'pass-app', version: '1.0.0', checks: { database: { status: 'ok', password: 'hidden' } } });
  assert.deepEqual(Object.keys(report), ['status', 'service', 'version', 'timestamp', 'checks']);
  assert.equal(report.status, 'ok');
  assert.doesNotMatch(JSON.stringify(report), /hidden/);
});
