import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasMissingTaskOnDate,
  isTaskMissing,
  taskDueAt,
  taskMissingDate,
} from '../lib/task-status.ts';

const timeZone = 'America/Los_Angeles';

function task(overrides = {}) {
  return {
    id: 'task-1',
    user_id: 'user-1',
    subject_id: null,
    title: 'Assignment',
    description: null,
    priority: 'medium',
    status: 'pending',
    due_date: null,
    due_time: null,
    recurrence: 'none',
    recurrence_days: null,
    completed_at: null,
    created_at: '2026-08-25T00:00:00.000Z',
    updated_at: '2026-08-25T00:00:00.000Z',
    source: 'manual',
    ...overrides,
  };
}

test('Canvas deadlines preserve the exact ISO instant on the same day', () => {
  const canvasTask = task({
    source: 'canvas',
    due_date: '2026-08-26T22:00:00.000Z', // 3:00 PM PDT
    due_time: '15:00',
  });

  assert.equal(taskDueAt(canvasTask, timeZone)?.toISOString(), '2026-08-26T22:00:00.000Z');
  assert.equal(isTaskMissing(canvasTask, new Date('2026-08-26T21:59:59.000Z'), timeZone), false);
  assert.equal(isTaskMissing(canvasTask, new Date('2026-08-26T22:00:01.000Z'), timeZone), true);
});

test('manual due_time is combined with the manual local due date', () => {
  const manualTask = task({
    // Legacy/manual rows store a date carrier at local midnight.
    due_date: '2026-08-26T07:00:00.000Z',
    due_time: '15:00',
  });

  assert.equal(taskDueAt(manualTask, timeZone)?.toISOString(), '2026-08-26T22:00:00.000Z');
  assert.equal(isTaskMissing(manualTask, new Date('2026-08-26T21:59:59.000Z'), timeZone), false);
  assert.equal(isTaskMissing(manualTask, new Date('2026-08-26T22:00:01.000Z'), timeZone), true);
});

test('manual date-only tasks remain active through the end of the local day', () => {
  const dateOnlyTask = task({ due_date: '2026-08-26T07:00:00.000Z' });

  assert.equal(taskDueAt(dateOnlyTask, timeZone)?.toISOString(), '2026-08-27T06:59:59.000Z');
  assert.equal(isTaskMissing(dateOnlyTask, new Date('2026-08-27T06:59:58.000Z'), timeZone), false);
  assert.equal(isTaskMissing(dateOnlyTask, new Date('2026-08-27T07:00:00.000Z'), timeZone), true);
});

test('completed tasks are never missing even after their deadline', () => {
  const completedTask = task({
    status: 'completed',
    due_date: '2026-08-26T07:00:00.000Z',
    due_time: '15:00',
  });

  assert.equal(isTaskMissing(completedTask, new Date('2026-08-27T12:00:00.000Z'), timeZone), false);
  assert.equal(taskMissingDate(completedTask, new Date('2026-08-27T12:00:00.000Z'), timeZone), null);
  assert.equal(
    hasMissingTaskOnDate([completedTask], '2026-08-26', new Date('2026-08-27T12:00:00.000Z'), timeZone),
    false,
  );
});

test('missing calendar state belongs to the actual local deadline date', () => {
  const missingTask = task({
    source: 'canvas',
    due_date: '2026-08-27T15:00:00.000Z', // Aug 27 at 8 AM PDT
  });
  const completedTask = task({
    id: 'completed-task',
    status: 'completed',
    due_date: '2026-08-26T07:00:00.000Z',
  });
  const now = new Date('2026-08-28T18:00:00.000Z');

  assert.equal(taskMissingDate(missingTask, now, timeZone), '2026-08-27');
  assert.equal(hasMissingTaskOnDate([completedTask, missingTask], '2026-08-26', now, timeZone), false);
  assert.equal(hasMissingTaskOnDate([completedTask, missingTask], '2026-08-27', now, timeZone), true);
  assert.equal(hasMissingTaskOnDate([completedTask, missingTask], '2026-08-28', now, timeZone), false);
});

test('missing calendar date honors the user timezone across a UTC date boundary', () => {
  const lateTask = task({
    source: 'canvas',
    due_date: '2026-08-28T06:00:00.000Z', // Aug 27 at 11 PM PDT
  });
  const now = new Date('2026-08-28T06:01:00.000Z');

  assert.equal(taskMissingDate(lateTask, now, timeZone), '2026-08-27');
  assert.equal(hasMissingTaskOnDate([lateTask], '2026-08-27', now, timeZone), true);
  assert.equal(hasMissingTaskOnDate([lateTask], '2026-08-28', now, timeZone), false);
});
