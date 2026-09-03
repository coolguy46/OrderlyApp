import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRecentSignIn } from '../lib/auth/recent-auth.ts';

const now = Date.parse('2026-08-26T20:00:00.000Z');

test('accepts a sign-in inside the sensitive-action window', () => {
  assert.equal(hasRecentSignIn('2026-08-26T19:50:00.000Z', now), true);
});

test('rejects stale, missing, invalid, and future sign-in timestamps', () => {
  assert.equal(hasRecentSignIn('2026-08-26T19:40:00.000Z', now), false);
  assert.equal(hasRecentSignIn(null, now), false);
  assert.equal(hasRecentSignIn('invalid', now), false);
  assert.equal(hasRecentSignIn('2026-08-26T20:02:00.000Z', now), false);
});
