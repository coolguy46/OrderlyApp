import assert from 'node:assert/strict';
import test from 'node:test';

import { selectUnscheduledTasks } from '../lib/schedule/unscheduled.ts';

test('the unscheduled selector returns the full collection instead of ten items', () => {
  const pending = Array.from({ length: 15 }, (_, index) => ({
    id: `task-${index}`,
    status: 'pending',
  }));
  const completed = { id: 'completed-task', status: 'completed' };
  const result = selectUnscheduledTasks(
    [...pending, completed],
    [
      { taskId: 'task-1', scheduledDate: '2026-08-26', startAt: null },
      { taskId: 'task-5', scheduledDate: null, startAt: '2026-08-26T20:00:00.000Z' },
    ],
  );

  assert.equal(result.length, 13);
  assert.equal(result.some(task => task.id === 'task-14'), true);
  assert.equal(result.some(task => task.id === 'task-1'), false);
  assert.equal(result.some(task => task.id === 'completed-task'), false);
});

test('a duration-only entry does not hide an undated task from the unscheduled shelf', () => {
  const task = { id: 'duration-only', status: 'pending' };
  const result = selectUnscheduledTasks(
    [task],
    [{ taskId: task.id, scheduledDate: null, startAt: null, durationSeconds: 3600 }],
  );

  assert.deepEqual(result, [task]);
});
