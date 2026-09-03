import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const formSource = await readFile(
  new URL('../components/tasks/TaskForm.tsx', import.meta.url),
  'utf8',
);

test('imported tasks reuse the normal schedule editor without changing their deadline', () => {
  assert.match(formSource, /task\.source === 'canvas' \|\| task\.source === 'google_classroom'/);
  assert.match(formSource, /setScheduleDate\(scheduleEntry\?\.scheduledDate \|\| ''\)/);
  assert.match(formSource, /setScheduleStartTime\(scheduleEntry\?\.startAt/);
  assert.match(formSource, /setDurationInput\(formatDurationInput\(scheduleEntry\?\.durationSeconds\)\)/);
  assert.match(formSource, /const hasUnchangedExternalDeadline = Boolean\([\s\S]*deadlineAt = hasUnchangedExternalDeadline[\s\S]*task\?\.due_date/);
  assert.match(formSource, /Work sessions may happen after the deadline/);
  assert.doesNotMatch(formSource, /setScheduleError\(['"]That (?:would|duration).*deadline/);
});

test('legacy imported descriptions are converted to safe readable text for editing', () => {
  assert.match(formSource, /import \{ externalHtmlToPlainText \} from '@\/lib\/safe-content'/);
  assert.match(
    formSource,
    /task\.source === 'canvas' \|\| task\.source === 'google_classroom'[\s\S]*\? externalHtmlToPlainText\(task\.description\)[\s\S]*: task\.description \|\| ''/,
  );
  assert.doesNotMatch(formSource, /dangerouslySetInnerHTML/);
});

test('an imported task schedule can be updated, removed, and durably confirmed', () => {
  assert.match(formSource, /upsertTaskSchedule\(user\.id, taskId/);
  assert.match(formSource, /removeTaskSchedule\(user\.id, taskId\)/);
  assert.match(formSource, /await waitForSchedulePersistence\(user\.id, \[task\.id\]\)/);
  assert.match(formSource, /The task details were saved, but its planned work time did not reach the database/);
});
