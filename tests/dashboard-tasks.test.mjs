import assert from 'node:assert/strict';
import test from 'node:test';

import { selectDashboardTasksForDate } from '../lib/dashboard-tasks.ts';
import { isTaskMissingFromPriorDay } from '../lib/task-status.ts';

const options = {
  timeZone: 'America/Los_Angeles',
  schoolDays: [1, 2, 3, 4, 5],
  schoolStartTime: '07:00',
  schoolHomeTime: '15:30',
};

function task(id, dueDate, overrides = {}) {
  return {
    id,
    user_id: 'user-1',
    subject_id: null,
    title: id,
    description: null,
    priority: 'medium',
    status: 'pending',
    due_date: dueDate,
    due_time: null,
    recurrence: 'none',
    recurrence_days: null,
    completed_at: null,
    created_at: '2026-08-20T19:00:00.000Z',
    updated_at: '2026-08-20T19:00:00.000Z',
    source: 'canvas',
    ...overrides,
  };
}

test('today excludes older overdue tasks but keeps same-day overdue work', () => {
  const now = new Date('2026-08-27T19:00:00.000Z');
  const result = selectDashboardTasksForDate([
    task('old-overdue', '2026-08-25T22:00:00.000Z'),
    task('today-overdue', '2026-08-27T18:00:00.000Z'),
    task('today-evening', '2026-08-28T06:59:00.000Z'),
    task('future-evening', '2026-08-29T06:00:00.000Z'),
  ], '2026-08-27', now, options);

  assert.deepEqual(result.map(item => item.id), ['today-overdue', 'today-evening']);
});

test('Missing begins at the next local calendar day', () => {
  const dueToday = task('due-today', '2026-08-27T18:00:00.000Z');

  assert.equal(
    isTaskMissingFromPriorDay(dueToday, new Date('2026-08-27T19:00:00.000Z'), options.timeZone),
    false,
  );
  assert.equal(
    isTaskMissingFromPriorDay(dueToday, new Date('2026-08-28T07:00:00.000Z'), options.timeZone),
    true,
  );
});

test('tomorrow-during-school work belongs to today', () => {
  const now = new Date('2026-08-27T19:00:00.000Z');
  const result = selectDashboardTasksForDate([
    task('tomorrow-at-school', '2026-08-28T15:00:00.000Z'),
    task('tomorrow-at-night', '2026-08-29T06:00:00.000Z'),
  ], '2026-08-27', now, options);

  assert.deepEqual(result.map(item => item.id), ['tomorrow-at-school']);
});

test('a school-time task returns on its due day once overdue', () => {
  const assignment = task('today-at-school', '2026-08-27T15:00:00.000Z');
  const afterDeadline = new Date('2026-08-27T15:01:00.000Z');

  assert.deepEqual(
    selectDashboardTasksForDate([assignment], '2026-08-27', new Date('2026-08-27T14:59:00.000Z'), options),
    [],
  );
  assert.deepEqual(
    selectDashboardTasksForDate([assignment], '2026-08-27', afterDeadline, options)
      .map(item => item.id),
    ['today-at-school'],
  );
  assert.deepEqual(
    selectDashboardTasksForDate([assignment], '2026-08-26', afterDeadline, options),
    [],
  );
});
