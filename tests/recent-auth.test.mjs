import assert from 'node:assert/strict';
import test from 'node:test';
import { hasRecentSignIn, hasRecentSessionAuthentication } from '../lib/auth/recent-auth.ts';

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

test('sensitive actions require recent authentication on this verified session', () => {
  for (const method of ['password', 'oauth', 'totp']) {
    assert.equal(hasRecentSessionAuthentication({ sub: 'user-a', amr: [{ method, timestamp: now / 1000 - 30 }] }, 'user-a', now), true);
  }
  const staleSession = { sub: 'user-a', iat: now / 1000, amr: [
    { method: 'password', timestamp: now / 1000 - 3600 },
    { method: 'token_refresh', timestamp: now / 1000 },
  ], last_sign_in_at: new Date(now).toISOString() };
  assert.equal(hasRecentSessionAuthentication(staleSession, 'user-a', now), false);
  assert.equal(hasRecentSessionAuthentication({ sub: 'user-b', amr: [{ method: 'password', timestamp: now / 1000 }] }, 'user-a', now), false);
  for (const amr of [null, [], [{ method: 'recovery', timestamp: now / 1000 }], [{ method: 'password', timestamp: '123' }], [{ method: 'password', timestamp: now / 1000 + 120 }]]) {
    assert.equal(hasRecentSessionAuthentication({ sub: 'user-a', amr }, 'user-a', now), false);
  }
});
