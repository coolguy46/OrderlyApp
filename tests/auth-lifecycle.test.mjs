import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OperationTimeoutError,
  authCallbackUrl,
  profileFromAuthUser,
  sanitizeAuthRedirectPath,
  setupCompletionKey,
  withTimeout,
} from '../lib/auth/lifecycle.ts';

test('Google sign-in prefers the canonical configured origin', () => {
  assert.equal(
    authCallbackUrl('https://www.myorderlyapp.com/', 'https://preview.vercel.app'),
    'https://www.myorderlyapp.com/auth/callback',
  );
  assert.equal(
    authCallbackUrl('', 'http://localhost:3000'),
    'http://localhost:3000/auth/callback',
  );
});

test('OAuth callback redirects stay on the current deployment', () => {
  assert.equal(sanitizeAuthRedirectPath('/setup?from=google#profile'), '/setup?from=google#profile');
  assert.equal(sanitizeAuthRedirectPath('https://attacker.example'), '/');
  assert.equal(sanitizeAuthRedirectPath('//attacker.example'), '/');
  assert.equal(sanitizeAuthRedirectPath('/\\attacker.example'), '/');
  assert.equal(sanitizeAuthRedirectPath(null), '/');
});

test('an auth user supplies a responsive profile shell before the profile query finishes', () => {
  const profile = profileFromAuthUser({
    id: 'user-1',
    email: 'student@example.com',
    created_at: '2026-08-27T10:00:00.000Z',
    updated_at: '2026-08-27T10:01:00.000Z',
    user_metadata: {
      full_name: '  Student Name  ',
      picture: 'https://example.com/avatar.png',
    },
  });

  assert.equal(profile.id, 'user-1');
  assert.equal(profile.full_name, 'Student Name');
  assert.equal(profile.avatar_url, 'https://example.com/avatar.png');
  assert.equal(profile.tasks_completed, 0);
});

test('setup completion is scoped to the authenticated account', () => {
  assert.equal(setupCompletionKey('user-a'), 'orderly-setup-complete:user-a');
  assert.notEqual(setupCompletionKey('user-a'), setupCompletionKey('user-b'));
});

test('bounded operations fail explicitly instead of leaving the UI pending forever', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5, 'Test operation'),
    (error) => error instanceof OperationTimeoutError && /Test operation/.test(error.message),
  );
});
