import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const taskFormSource = await readFile(
  new URL('../components/tasks/TaskForm.tsx', import.meta.url),
  'utf8',
);

test('TaskForm accepts an existing commitment and initializes every editable event field', () => {
  assert.match(taskFormSource, /commitment\?: RecurringCommitmentInput \| null/);
  assert.match(taskFormSource, /setTitle\(commitment\.title\)/);
  assert.match(taskFormSource, /setDescription\(commitment\.description \|\| ''\)/);
  assert.match(taskFormSource, /setEventLocation\(commitment\.location \|\| ''\)/);
  assert.match(taskFormSource, /setEventDate\(commitment\.startDate \|\| initialDate\)/);
  assert.match(taskFormSource, /setEventStartTime\(normalizedClock\(commitment\.startTime\)\)/);
  assert.match(taskFormSource, /setEventEndTime\(normalizedClock\(commitment\.endTime\)\)/);
  assert.match(taskFormSource, /setEventRecurrenceDays\(repeatsWeekly/);
  assert.match(taskFormSource, /setEventKind\(commitment\.kind\)/);
  assert.match(taskFormSource, /setEventColor\(commitment\.color \|\| EVENT_COLORS\[0\]\)/);
});

test('saving an edited event upserts the original ID and preserves planner metadata', () => {
  assert.match(taskFormSource, /id: commitment\?\.id \|\| newCommitmentId\(\)/);
  assert.match(taskFormSource, /timeZone: eventTimeZone/);
  assert.match(taskFormSource, /enabled: commitment\?\.enabled \?\? true/);
  assert.match(taskFormSource, /occurrenceOverrides: commitment\?\.occurrenceOverrides \|\| \{\}/);
  assert.match(taskFormSource, /upsertCommitment\(user\.id, commitmentInput\)/);
  assert.match(taskFormSource, /commitment[\s\S]*'Update Event'/);
});

test('editing an event can remove the same commitment after confirmation', () => {
  assert.match(taskFormSource, /const handleDeleteEvent = async \(\) => \{/);
  assert.match(taskFormSource, /removeCommitment\(user\.id, commitment\.id\)/);
  assert.match(taskFormSource, /await waitForPlannerPersistence\(user\.id\)/);
  assert.match(taskFormSource, /title="Remove Event"/);
  assert.match(taskFormSource, /onConfirm=\{handleDeleteEvent\}/);
});
