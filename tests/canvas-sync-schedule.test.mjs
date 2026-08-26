import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCanvasSyncDispatchDue,
  isCanvasSyncDue,
  normalizeCanvasSyncInterval,
} from '../lib/integrations/canvas-sync-schedule.ts';

test('allows enough cron jitter for a five-minute sync to run on the next boundary', () => {
  assert.equal(
    isCanvasSyncDue('2026-08-26T03:30:00.100Z', 5, new Date('2026-08-26T03:35:00.000Z')),
    true
  );
});

test('does not run materially earlier than the selected interval', () => {
  assert.equal(
    isCanvasSyncDue('2026-08-26T03:30:30.000Z', 5, new Date('2026-08-26T03:34:00.000Z')),
    false
  );
});

test('respects longer intervals while allowing the same boundary jitter', () => {
  const lastSyncAt = '2026-08-26T03:30:00.100Z';
  assert.equal(isCanvasSyncDue(lastSyncAt, 15, new Date('2026-08-26T03:40:00.000Z')), false);
  assert.equal(isCanvasSyncDue(lastSyncAt, 15, new Date('2026-08-26T03:45:00.000Z')), true);
});

test('missing or invalid timestamps are due, and invalid intervals fall back to 15', () => {
  assert.equal(isCanvasSyncDue(null, 5, new Date()), true);
  assert.equal(isCanvasSyncDue('not-a-date', 5, new Date()), true);
  assert.equal(normalizeCanvasSyncInterval(7), 15);
});

test('dispatch gating prevents duplicate requests inside one cron boundary', () => {
  const now = new Date('2026-08-26T03:35:00.000Z');
  assert.equal(
    isCanvasSyncDispatchDue(
      '2026-08-26T03:30:00.100Z',
      5,
      '2026-08-26T03:34:30.000Z',
      now
    ),
    false
  );
});

test('a failed sync is retryable at the next five-minute boundary', () => {
  const now = new Date('2026-08-26T03:35:00.000Z');
  assert.equal(
    isCanvasSyncDispatchDue(
      '2026-08-26T03:00:00.000Z',
      30,
      '2026-08-26T03:30:00.100Z',
      now
    ),
    true
  );
});
