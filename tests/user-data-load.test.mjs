import assert from 'node:assert/strict';
import test from 'node:test';

import { readUserDataSnapshot } from '../lib/user-data-load.ts';

function readers(overrides = {}) {
  return {
    getTasks: async () => [],
    getGoals: async () => [],
    getStudySessions: async () => [],
    getExams: async () => [],
    getSubjects: async () => [],
    getFriends: async () => [],
    ...overrides,
  };
}

test('a legitimate all-empty user snapshot loads successfully', async () => {
  const snapshot = await readUserDataSnapshot('user-1', readers());

  assert.deepEqual(snapshot, {
    tasks: [],
    goals: [],
    studySessions: [],
    exams: [],
    subjects: [],
    friends: [],
  });
});

test('one failed collection rejects the complete snapshot', async () => {
  const transportError = new Error('network unavailable');

  await assert.rejects(
    readUserDataSnapshot('user-1', readers({
      getSubjects: async () => { throw transportError; },
    })),
    transportError,
  );
});
