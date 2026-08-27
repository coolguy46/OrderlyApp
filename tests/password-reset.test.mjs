import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  isPasswordRecoveryExchange,
  PASSWORD_RECOVERY_API_PATH,
  PASSWORD_RECOVERY_MAX_AGE_SECONDS,
  RESET_PASSWORD_MIN_LENGTH,
  validateResetPassword,
} from '../lib/auth/password-reset.ts';
import {
  createPasswordRecoverySessionToken,
  readPasswordRecoverySessionToken,
} from '../lib/auth/password-recovery-token.ts';

const signingSecret = 'test-only-password-recovery-secret-that-is-long-enough';
const identity = {
  userId: 'user-123',
  accessToken: 'recovery-session-access-token',
  refreshToken: 'recovery-session-refresh-token',
  userVersion: '2026-08-26T10:00:00.000Z',
};

test('the recovery session is isolated to the API that consumes it', async () => {
  assert.equal(PASSWORD_RECOVERY_API_PATH, '/api/auth/password-recovery');
  const [callbackSource, recoveryApiSource] = await Promise.all([
    readFile(new URL('../app/auth/callback/route.ts', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/auth/password-recovery/route.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(callbackSource, /path:\s*PASSWORD_RECOVERY_API_PATH/);
  assert.match(callbackSource, /clearSupabaseSessionCookies/);
  assert.match(callbackSource, /redirectType === 'recovery'/);
  assert.match(callbackSource, /PASSWORD_RECOVERY_PATH/);
  assert.match(recoveryApiSource, /path:\s*PASSWORD_RECOVERY_API_PATH/);
  assert.match(recoveryApiSource, /persistSession:\s*false/);
  assert.match(recoveryApiSource, /error:\s*signOutError/);
  assert.match(recoveryApiSource, /passwordUpdated:\s*true/);
});

test('only a verified recovery-code exchange unlocks the reset destination', () => {
  assert.equal(isPasswordRecoveryExchange('/auth/reset-password', 'recovery'), true);
  assert.equal(isPasswordRecoveryExchange('/auth/reset-password', null), false);
  assert.equal(isPasswordRecoveryExchange('/auth/reset-password', 'signup'), false);
  assert.equal(isPasswordRecoveryExchange('/settings', 'recovery'), false);
});

test('a recovery session is encrypted, authenticated, and rejects tampering', () => {
  const now = Date.parse('2026-08-26T10:00:00.000Z');
  const marker = createPasswordRecoverySessionToken(identity, signingSecret, now);
  assert.deepEqual(readPasswordRecoverySessionToken(marker, signingSecret, now), identity);
  assert.equal(readPasswordRecoverySessionToken(`${marker}x`, signingSecret, now), null);
  assert.equal(readPasswordRecoverySessionToken(marker, `${signingSecret}-wrong`, now), null);
  assert.doesNotMatch(marker, /recovery-session-access-token/);
});

test('a recovery session expires', () => {
  const now = Date.parse('2026-08-26T10:00:00.000Z');
  const marker = createPasswordRecoverySessionToken(identity, signingSecret, now);
  assert.equal(readPasswordRecoverySessionToken(
    marker,
    signingSecret,
    now + (PASSWORD_RECOVERY_MAX_AGE_SECONDS + 1) * 1_000,
  ), null);
});

test('rejects passwords shorter than the reset policy', () => {
  const password = 'x'.repeat(RESET_PASSWORD_MIN_LENGTH - 1);
  assert.equal(
    validateResetPassword(password, password),
    `Password must be at least ${RESET_PASSWORD_MIN_LENGTH} characters.`,
  );
});

test('rejects a confirmation that does not match', () => {
  assert.equal(
    validateResetPassword('password-one', 'password-two'),
    'Passwords do not match.',
  );
});

test('accepts a matching password that satisfies the policy', () => {
  assert.equal(validateResetPassword('new-password', 'new-password'), null);
});
