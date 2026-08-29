import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreScheduleSnapshotPreservingChanges } from '../lib/schedule/undo.ts';

function entry(taskId, startAt, updatedAt) {
  return {
    id: taskId,
    userId: 'user-a',
    taskId,
    scheduledDate: '2026-08-29',
    startAt,
    durationSeconds: 1800,
    recurrence: 'none',
    recurrenceDays: null,
    recurrenceEndDate: null,
    occurrenceOverrides: {},
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt,
  };
}

test('Undo restores its own entries without replacing unrelated newer entries', () => {
  const before = [
    entry('planned', '2026-08-29T17:00:00.000Z', 'before'),
    entry('unrelated', '2026-08-29T18:00:00.000Z', 'before'),
  ];
  const applied = [
    entry('planned', '2026-08-29T19:00:00.000Z', 'assistant'),
    before[1],
  ];
  const newerUnrelated = entry('unrelated', '2026-08-29T22:00:00.000Z', 'newer');

  const restored = restoreScheduleSnapshotPreservingChanges(before, applied, [
    applied[0],
    newerUnrelated,
  ]);

  assert.deepEqual(restored.restoredTaskIds, ['planned']);
  assert.deepEqual(restored.skippedTaskIds, []);
  assert.equal(restored.entries.find(item => item.taskId === 'planned')?.startAt, before[0].startAt);
  assert.equal(restored.entries.find(item => item.taskId === 'unrelated')?.startAt, newerUnrelated.startAt);
});

test('Undo preserves a newer edit to the same entry while an async cleanup is pending', () => {
  const before = [entry('planned', '2026-08-29T17:00:00.000Z', 'before')];
  const applied = [entry('planned', '2026-08-29T19:00:00.000Z', 'assistant')];
  const editedDuringUndo = entry('planned', '2026-08-29T23:00:00.000Z', 'newer');

  const restored = restoreScheduleSnapshotPreservingChanges(before, applied, [editedDuringUndo]);

  assert.deepEqual(restored.restoredTaskIds, []);
  assert.deepEqual(restored.skippedTaskIds, ['planned']);
  assert.deepEqual(restored.entries, [editedDuringUndo]);
});

test('Undo is idempotent when remote cleanup already removed a newly-created task schedule', () => {
  const created = entry('created', '2026-08-29T19:00:00.000Z', 'assistant');
  const restored = restoreScheduleSnapshotPreservingChanges([], [created], []);

  assert.deepEqual(restored.entries, []);
  assert.deepEqual(restored.restoredTaskIds, ['created']);
  assert.deepEqual(restored.skippedTaskIds, []);
});
