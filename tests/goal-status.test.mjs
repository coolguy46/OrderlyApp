import assert from 'node:assert/strict';
import test from 'node:test';

import { goalStatusForSave, isGoalComplete } from '../lib/goal-status.ts';

test('editing a completed goal preserves its completed status', () => {
  assert.equal(goalStatusForSave(4, 10, 'completed'), 'completed');
});

test('new goals default to active', () => {
  assert.equal(goalStatusForSave(0, 10), 'active');
});

test('saving progress at or beyond the target completes the goal', () => {
  assert.equal(goalStatusForSave(10, 10), 'completed');
  assert.equal(goalStatusForSave(12, 10, 'active'), 'completed');
  assert.equal(isGoalComplete({ status: 'active', current_value: 10, target_value: 10 }), true);
  assert.equal(isGoalComplete({ status: 'active', current_value: 9, target_value: 10 }), false);
});
