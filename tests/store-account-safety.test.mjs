import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  isCurrentAccountRequest,
  isRepeatingTaskSeries,
  prependUniqueRecordById,
  provisionalProfileFromAuthUser,
  registrationOutcomeFromSignUp,
  runBestEffortAccountCleanup,
  transitionAccountSessionFence,
} from '../lib/store-account-safety.ts';

test('registration only authenticates a real matching session', () => {
  const user = { id: 'account-a' };
  assert.equal(registrationOutcomeFromSignUp(user, null), 'confirmation-required');
  assert.equal(
    registrationOutcomeFromSignUp(user, { user: { id: 'account-a' } }),
    'authenticated',
  );
  assert.equal(
    registrationOutcomeFromSignUp(user, { user: { id: 'account-b' } }),
    'failed',
  );
  assert.equal(registrationOutcomeFromSignUp(null, null), 'failed');
});

test('account request fencing rejects switches and same-account re-entry', () => {
  assert.equal(isCurrentAccountRequest('account-a', 1, 'account-a', 1), true);
  assert.equal(isCurrentAccountRequest('account-b', 2, 'account-a', 1), false);
  assert.equal(isCurrentAccountRequest('account-a', 3, 'account-a', 1), false);
});

test('account-session generations distinguish an A to B to A re-entry', () => {
  let session = { userId: null, generation: 0 };
  session = transitionAccountSessionFence(session, 'account-a');
  const firstAccountARequest = { ...session };
  session = transitionAccountSessionFence(session, 'account-b');
  session = transitionAccountSessionFence(session, 'account-a');

  assert.equal(session.userId, 'account-a');
  assert.equal(
    isCurrentAccountRequest(
      session.userId,
      session.generation,
      firstAccountARequest.userId,
      firstAccountARequest.generation,
    ),
    false,
  );
});

test('account cleanup continues after browser storage throws', () => {
  const completed = [];
  const failures = [];

  runBestEffortAccountCleanup([
    () => completed.push('planner'),
    () => { throw new Error('storage disabled'); },
    () => completed.push('snapshot-reset'),
  ], (_error, index) => failures.push(index));

  assert.deepEqual(completed, ['planner', 'snapshot-reset']);
  assert.deepEqual(failures, [1]);
});

test('an idempotent study-session retry replaces rather than duplicates memory state', () => {
  const existing = [
    { id: 'session-1', duration_minutes: 24 },
    { id: 'session-2', duration_minutes: 10 },
  ];
  const retried = { id: 'session-1', duration_minutes: 25 };

  assert.deepEqual(prependUniqueRecordById(existing, retried), [
    retried,
    existing[1],
  ]);
});

test('a valid auth identity remains usable while its profile read is unavailable', () => {
  const profile = provisionalProfileFromAuthUser({
    id: 'account-a',
    email: 'student@example.com',
    created_at: '2026-08-01T00:00:00.000Z',
    user_metadata: {
      full_name: 'Student A',
      avatar_url: 'https://example.com/avatar.png',
    },
  });

  assert.equal(profile.id, 'account-a');
  assert.equal(profile.email, 'student@example.com');
  assert.equal(profile.full_name, 'Student A');
  assert.equal(profile.avatar_url, 'https://example.com/avatar.png');
  assert.equal(profile.tasks_completed, 0);
});

test('schedule-only recurrence is treated as a repeating task series', () => {
  assert.equal(isRepeatingTaskSeries({ recurrence: 'none' }, 'weekly'), true);
  assert.equal(isRepeatingTaskSeries({ recurrence: 'daily' }, 'none'), true);
  assert.equal(isRepeatingTaskSeries({ recurrence: 'none' }, 'none'), false);
});

test('task completion migration locks, completes, and inserts the successor in one function', async () => {
  const sql = await readFile(
    new URL('../lib/supabase/task-completion-atomic-migration.sql', import.meta.url),
    'utf8',
  );

  assert.match(sql, /FOR UPDATE;/);
  assert.match(sql, /UPDATE public\.tasks[\s\S]+INSERT INTO public\.tasks/);
  assert.match(sql, /BEGIN;[\s\S]+COMMIT;/);
  assert.match(sql, /user_id = auth\.uid\(\)/);
});
