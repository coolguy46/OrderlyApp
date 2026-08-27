import assert from 'node:assert/strict';
import test from 'node:test';

import { saveExistingTaskInOrder } from '../lib/task-form-save-sequence.ts';

test('persists the edited schedule before completing a recurring task', async () => {
  const operations = [];
  const result = await saveExistingTaskInOrder({
    saveDetails: async () => {
      operations.push('details');
      return true;
    },
    persistSchedule: () => operations.push('schedule'),
    completeTask: async () => {
      operations.push('complete');
      return true;
    },
    shouldComplete: true,
    isCurrent: () => true,
  });

  assert.equal(result, 'completed');
  assert.deepEqual(operations, ['details', 'schedule', 'complete']);
});

test('does not persist or complete after a failed detail save', async () => {
  const operations = [];
  const result = await saveExistingTaskInOrder({
    saveDetails: async () => false,
    persistSchedule: () => operations.push('schedule'),
    completeTask: async () => {
      operations.push('complete');
      return true;
    },
    shouldComplete: true,
    isCurrent: () => true,
  });

  assert.equal(result, 'details-failed');
  assert.deepEqual(operations, []);
});

test('does not publish stale form work after the form session changes', async () => {
  const operations = [];
  const result = await saveExistingTaskInOrder({
    saveDetails: async () => true,
    persistSchedule: () => operations.push('schedule'),
    completeTask: async () => true,
    shouldComplete: true,
    isCurrent: () => false,
  });

  assert.equal(result, 'cancelled');
  assert.deepEqual(operations, []);
});
