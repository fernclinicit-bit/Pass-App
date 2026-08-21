import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { LocalRequestStore } = require('../request-store.cjs');

test('local request store persists LINE requests across store instances', async (context) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'passly-request-store-'));
  const filePath = path.join(dataDir, 'requests.json');
  context.after(() => fs.rm(dataDir, { recursive: true, force: true }));

  const requests = [{
    id: 'line-persistent-1',
    source: 'LINE',
    system: 'Microsoft',
    status: 'pending',
  }];
  await new LocalRequestStore(filePath).put(requests);
  const restored = await new LocalRequestStore(filePath).get();

  assert.deepEqual(restored, requests);
});
