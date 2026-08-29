import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deleteCreatedTasks,
  plannerMutationIsCurrent,
} from '../lib/planner/assistant-mutation.ts';

test('created-task cleanup reports every failed deletion for retry', async () => {
  const attempted = [];
  const result = await deleteCreatedTasks(['created-1', 'created-2', 'created-3'], async taskId => {
    attempted.push(taskId);
    if (taskId === 'created-2') return false;
    if (taskId === 'created-3') throw new Error('network failure');
    return true;
  });

  assert.deepEqual(attempted, ['created-1', 'created-2', 'created-3']);
  assert.deepEqual(result.deletedTaskIds, ['created-1']);
  assert.deepEqual(result.failedTaskIds, ['created-2', 'created-3']);
});

test('planner mutations become stale after an account or generation change', () => {
  assert.equal(plannerMutationIsCurrent({
    operationUserId: 'user-a',
    operationGeneration: 4,
    currentUserId: 'user-a',
    currentGeneration: 4,
  }), true);
  assert.equal(plannerMutationIsCurrent({
    operationUserId: 'user-a',
    operationGeneration: 4,
    currentUserId: 'user-b',
    currentGeneration: 4,
  }), false);
  assert.equal(plannerMutationIsCurrent({
    operationUserId: 'user-a',
    operationGeneration: 4,
    currentUserId: 'user-a',
    currentGeneration: 5,
  }), false);
});
