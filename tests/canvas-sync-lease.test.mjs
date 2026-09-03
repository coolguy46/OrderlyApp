import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCanvasSyncLeaseMigrationError,
  parseCanvasSyncLease,
} from '../lib/integrations/canvas-sync-lease.ts';

test('parses singular and table-valued lease responses', () => {
  const row = { lease_token: 'opaque-token', sync_revision: 4 };
  assert.deepEqual(parseCanvasSyncLease(row), { token: 'opaque-token', revision: 4 });
  assert.deepEqual(parseCanvasSyncLease([row]), { token: 'opaque-token', revision: 4 });
  assert.equal(parseCanvasSyncLease([]), null);
  assert.equal(parseCanvasSyncLease(null), null);
});

test('rejects malformed lease responses instead of running without fencing', () => {
  assert.throws(
    () => parseCanvasSyncLease({ lease_token: '', sync_revision: 1 }),
    /lease response was invalid/
  );
  assert.throws(
    () => parseCanvasSyncLease({ lease_token: 'token', sync_revision: 0 }),
    /lease response was invalid/
  );
});

test('recognizes a missing concurrency migration without exposing raw details', () => {
  assert.equal(isCanvasSyncLeaseMigrationError({ code: 'PGRST202' }), true);
  assert.equal(isCanvasSyncLeaseMigrationError({ code: '42883' }), true);
  assert.equal(
    isCanvasSyncLeaseMigrationError({ message: 'Could not find public.claim_canvas_sync' }),
    true
  );
  assert.equal(isCanvasSyncLeaseMigrationError({ code: '42501' }), false);
});
