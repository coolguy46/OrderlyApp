import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCanvasManagedTaskValues,
  CANVAS_TASK_UPSERT_CONFLICT,
} from '../lib/integrations/canvas-task-write.ts';

const assignment = {
  id: 'canvas-assignment-42',
  courseName: 'English 9',
  title: 'Essay revision',
  description: 'Revise the final draft',
  hasDueTime: true,
  type: 'assignment',
  status: 'upcoming',
  url: 'https://canvas.example/assignments/42',
};

test('Canvas refresh changes only Canvas-owned task metadata', () => {
  const patch = buildCanvasManagedTaskValues({
    assignment,
    dueDate: new Date('2026-09-04T06:59:00.000Z'),
    dueTime: '23:59',
    courseName: 'English 9',
    subjectId: 'subject-1',
  });

  assert.deepEqual(Object.keys(patch).sort(), [
    'assignment_type',
    'course_name',
    'description',
    'due_date',
    'due_time',
    'external_url',
    'subject_id',
    'title',
  ]);

  const existing = {
    ...patch,
    status: 'completed',
    completed_at: '2026-09-02T18:00:00.000Z',
    scheduled_date: '2026-09-05',
    scheduled_start_at: '2026-09-05T17:00:00.000Z',
    duration_seconds: 3600,
    schedule_recurrence_end_date: null,
    schedule_occurrence_overrides: { '2026-09-05': { startAt: '2026-09-05T18:00:00.000Z' } },
  };
  const refreshed = { ...existing, ...patch };

  assert.equal(refreshed.status, 'completed');
  assert.equal(refreshed.completed_at, existing.completed_at);
  assert.equal(refreshed.scheduled_date, existing.scheduled_date);
  assert.equal(refreshed.scheduled_start_at, existing.scheduled_start_at);
  assert.equal(refreshed.duration_seconds, 3600);
  assert.deepEqual(refreshed.schedule_occurrence_overrides, existing.schedule_occurrence_overrides);
});

test('Canvas inserts use the immutable account/source/external identity', () => {
  assert.equal(CANVAS_TASK_UPSERT_CONFLICT, 'user_id,source,external_id');
});
