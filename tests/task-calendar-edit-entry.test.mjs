import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const taskCalendarSource = await readFile(
  new URL('../components/calendar/TaskCalendar.tsx', import.meta.url),
  'utf8',
);

test('calendar task chips open the shared task editor in month and week views', () => {
  const editEntryCalls = taskCalendarSource.match(/onClick=\{\(\) => openTaskEditor\(task\.id\)\}/g) || [];

  assert.equal(editEntryCalls.length, 2);
  assert.match(taskCalendarSource, /const openTaskEditor = \(taskId: string\) => \{[\s\S]*setEditingTaskId\(taskId\);[\s\S]*setTaskFormOpen\(true\);/);
  assert.match(taskCalendarSource, /<TaskForm[\s\S]*isOpen=\{taskFormOpen\}[\s\S]*task=\{editingTask\}/);
});
test('the edit entry point is source-agnostic and closing clears the selected task', () => {
  const openTaskEditor = taskCalendarSource.match(
    /const openTaskEditor = \(taskId: string\) => \{([\s\S]*?)\n  \};/,
  )?.[1] || '';

  assert.doesNotMatch(openTaskEditor, /source|canvas|google_classroom/);
  assert.match(taskCalendarSource, /const closeTaskForm = \(\) => \{[\s\S]*setTaskFormOpen\(false\);[\s\S]*setEditingTaskId\(null\);/);
});
