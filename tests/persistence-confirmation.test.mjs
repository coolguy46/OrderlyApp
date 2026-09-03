import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [plannerStore, scheduleStore] = await Promise.all([
  readFile(new URL('../lib/planner/store.ts', import.meta.url), 'utf8'),
  readFile(new URL('../lib/schedule/store.ts', import.meta.url), 'utf8'),
]);

test('planner exposes a bounded persistence acknowledgement backed by its durable outbox', () => {
  assert.match(plannerStore, /export async function waitForPlannerPersistence\(/);
  assert.match(plannerStore, /waitForPlannerPersistence: \(userId: string, timeoutMs\?: number\) => Promise<boolean>/);
  assert.match(plannerStore, /after\.sessionGeneration !== expectedGeneration/);
  assert.match(plannerStore, /if \(!after\.pendingRevisionByUser\[userId\]\) return true/);
  assert.match(plannerStore, /if \(!plannerPersistenceQueues\.has\(userId\)\) return false/);
  assert.match(plannerStore, /waitForPlannerQueueBefore\(queue, deadline\)/);
});

test('schedule acknowledgement can scope a batch and rejects pending writes without a live queue', () => {
  assert.match(scheduleStore, /export async function waitForSchedulePersistence\(/);
  assert.match(scheduleStore, /taskIds\?: readonly string\[\]/);
  assert.match(scheduleStore, /beforeWait\.sessionGeneration !== expectedGeneration/);
  assert.match(scheduleStore, /targetTaskIds\.every\(taskId => !after\.pendingByUser\[userId\]\?\.\[taskId\]\)/);
  assert.match(scheduleStore, /if \(!hasFollowUpQueue\) return false/);
  assert.match(scheduleStore, /waitForScheduleQueuesBefore\(queues, deadline\)/);
});
