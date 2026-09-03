import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  mergeScheduleHydration,
  persistedTaskScheduleUpdate,
  scheduleEntriesFromTasks,
  scheduleEntryFromTask,
} from '../lib/schedule/persistence.ts';
import {
  localDateFromIso,
  localDateTimeToIso,
  nextLocalRecurrenceDate,
} from '../lib/schedule/selectors.ts';
import { resolveTaskCompletionTimeZone } from '../lib/task-completion-time-zone.ts';

const task = {
  id: 'task-a',
  user_id: 'user-a',
  subject_id: null,
  title: 'Read chapter',
  description: null,
  priority: 'medium',
  status: 'pending',
  due_date: '2026-08-27',
  due_time: '11:59 PM',
  recurrence: 'weekly',
  recurrence_days: [5, 1, 5, 9],
  completed_at: null,
  created_at: '2026-08-20T12:00:00.000Z',
  updated_at: '2026-08-26T12:00:00.000Z',
  scheduled_date: '2026-08-26',
  scheduled_start_at: '2026-08-27T02:00:00.000Z',
  duration_seconds: 3600,
  schedule_recurrence_end_date: '2026-12-01',
  schedule_occurrence_overrides: {
    '2026-09-02': {
      scheduledDate: '2026-09-01',
      startAt: '2026-09-02T03:00:00.000Z',
      durationSeconds: 2700,
      skipped: false,
    },
    invalid: { durationSeconds: 99 },
  },
};

test('task scheduling columns hydrate losslessly into the account-scoped schedule model', () => {
  const entry = scheduleEntryFromTask(task);

  assert.ok(entry);
  assert.equal(entry.userId, 'user-a');
  assert.equal(entry.taskId, 'task-a');
  assert.equal(entry.scheduledDate, '2026-08-26');
  assert.equal(entry.startAt, '2026-08-27T02:00:00.000Z');
  assert.equal(entry.durationSeconds, 3600);
  assert.equal(entry.recurrence, 'weekly');
  assert.deepEqual(entry.recurrenceDays, [1, 5]);
  assert.deepEqual(entry.occurrenceOverrides['2026-09-02'], {
    scheduledDate: '2026-09-01',
    startAt: '2026-09-02T03:00:00.000Z',
    durationSeconds: 2700,
    skipped: false,
  });
  assert.equal(entry.occurrenceOverrides.invalid, undefined);
  assert.deepEqual(scheduleEntriesFromTasks([task, { ...task, id: 'foreign', user_id: 'user-b' }], 'user-a'), [entry]);
});

test('schedule persistence updates canonical task columns and untiming preserves task recurrence', () => {
  const entry = scheduleEntryFromTask(task);
  assert.ok(entry);

  assert.deepEqual(persistedTaskScheduleUpdate(entry), {
    scheduled_date: '2026-08-26',
    scheduled_start_at: '2026-08-27T02:00:00.000Z',
    duration_seconds: 3600,
    schedule_recurrence_end_date: '2026-12-01',
    schedule_occurrence_overrides: {
      '2026-09-02': {
        scheduledDate: '2026-09-01',
        startAt: '2026-09-02T03:00:00.000Z',
        durationSeconds: 2700,
        skipped: false,
      },
    },
    recurrence: 'weekly',
    recurrence_days: [1, 5],
  });

  const untimed = persistedTaskScheduleUpdate(null);
  assert.deepEqual(untimed, {
    scheduled_date: null,
    scheduled_start_at: null,
    duration_seconds: null,
    schedule_recurrence_end_date: null,
    schedule_occurrence_overrides: {},
  });
  assert.equal('recurrence' in untimed, false);
  assert.equal('recurrence_days' in untimed, false);
});

test('server hydration wins when clean while pending offline edits and deletes survive', () => {
  const server = scheduleEntryFromTask(task);
  assert.ok(server);
  const localPending = {
    ...server,
    taskId: 'task-local',
    id: 'task-local',
    scheduledDate: '2026-08-29',
  };
  const staleLocal = { ...server, scheduledDate: '2026-08-30' };

  const merged = mergeScheduleHydration(
    'user-a',
    [server, { ...server, taskId: 'delete-me', id: 'delete-me' }],
    { 'task-a': staleLocal, 'task-local': localPending },
    {
      'task-local': { revision: 4, entry: localPending },
      'delete-me': { revision: 5, entry: null },
      foreign: { revision: 6, entry: { ...localPending, taskId: 'foreign', userId: 'user-b' } },
    },
  );

  assert.equal(merged['task-a'].scheduledDate, server.scheduledDate);
  assert.equal(merged['task-local'].scheduledDate, '2026-08-29');
  assert.equal(merged['delete-me'], undefined);
  assert.equal(merged.foreign, undefined);
});

test('recurrence completion uses the saved account timezone instead of the browser timezone', () => {
  const timeZone = resolveTaskCompletionTimeZone(
    'America/Los_Angeles',
    'Asia/Tokyo',
  );
  assert.equal(timeZone, 'America/Los_Angeles');

  // This instant is already August 27 in Tokyo, but is still August 26 for the
  // account. The successor must therefore be August 27 in Los Angeles, not
  // August 28 based on the browser's current location.
  const currentDate = localDateFromIso('2026-08-27T01:30:00.000Z', timeZone);
  assert.equal(currentDate, '2026-08-26');
  const successorDate = nextLocalRecurrenceDate(currentDate, 'daily');
  assert.equal(successorDate, '2026-08-27');
  assert.equal(
    localDateTimeToIso(successorDate, '18:30:00', timeZone),
    '2026-08-28T01:30:00.000Z',
  );

  assert.equal(resolveTaskCompletionTimeZone('Not/AZone', 'Asia/Tokyo'), 'Asia/Tokyo');
  assert.equal(resolveTaskCompletionTimeZone(null, 'Not/AZone'), 'UTC');
});

test('schedule store source retains a persisted outbox, generation fence, and legacy migration', async () => {
  const [store, client, rootStore, migration] = await Promise.all([
    readFile(new URL('../lib/schedule/store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/schedule/persistence-client.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/supabase/task-scheduling-migration.sql', import.meta.url), 'utf8'),
  ]);

  assert.match(store, /pendingByUser/);
  assert.match(store, /sessionGeneration !== expectedGeneration/);
  assert.match(store, /persistedVersion < SCHEDULE_STORE_VERSION/);
  assert.match(client, /\.select\('id'\)/);
  assert.match(client, /data\?\.id !== taskId/);
  assert.match(rootStore, /scheduleEntriesFromTasks\(tasks\.value, requestedUserId\)/);
  assert.match(rootStore, /if \(tasks\.status === 'fulfilled'\)/);
  assert.match(rootStore, /hydrateUserSchedules/);
  assert.match(rootStore, /scheduleRevisionAtStart/);
  assert.match(rootStore, /nextRevisionByUser\[requestedUserId\]/);
  assert.match(rootStore, /users\[accountId\]\?\.settings\.timeZone/);
  assert.match(rootStore, /resolveTaskCompletionTimeZone/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS scheduled_date DATE/);
  assert.match(migration, /schedule_occurrence_overrides JSONB/);
});
