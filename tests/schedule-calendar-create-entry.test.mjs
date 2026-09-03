import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [calendarSource, plannerSource, formSource, gridSource] = await Promise.all([
  readFile(new URL('../components/calendar/ScheduleCalendar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/planner/Planner.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/tasks/TaskForm.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../components/planner/WeekTimeGrid.tsx', import.meta.url), 'utf8'),
]);

test('an empty calendar slot opens the shared Task/Event form with its exact slot', () => {
  assert.match(calendarSource, /onEmptySlotClick=\{handleEmptySlotClick\}/);
  assert.match(calendarSource, /setCreationSlot\(\{[\s\S]*date,[\s\S]*startTime,[\s\S]*durationSeconds/);
  assert.match(calendarSource, /<TaskForm[\s\S]*initialMode="task"[\s\S]*initialDate=\{creationSlot\?\.date \|\| ''\}[\s\S]*initialStartTime=\{creationSlot\?\.startTime \|\| ''\}[\s\S]*initialDurationSeconds=\{creationSlot\?\.durationSeconds \|\| null\}/);
  assert.match(formSource, /role="tablist"\s+aria-label="Create a task or event"/);
  assert.match(formSource, /setMode\('task'\)/);
  assert.match(formSource, /setMode\('event'\)/);
});

test('the Assistant scheduler uses the same direct create and edit flow', () => {
  assert.match(plannerSource, /onEmptySlotClick=\{handleEmptySlotClick\}/);
  assert.match(plannerSource, /onBlockClick=\{handleBlockClick\}/);
  assert.match(plannerSource, /<TaskForm[\s\S]*initialMode="task"[\s\S]*initialDate=\{creationSlot\?\.date \|\| ''\}[\s\S]*initialStartTime=\{creationSlot\?\.startTime \|\| ''\}[\s\S]*initialDurationSeconds=\{creationSlot\?\.durationSeconds \|\| null\}/);
  assert.match(plannerSource, /task=\{editingTask\}/);
  assert.match(plannerSource, /commitment=\{editingCommitment\}/);
});

test('saving a new task writes its schedule and waits for durable confirmation', () => {
  assert.match(formSource, /const savedTask = await addTask\(taskData\)/);
  assert.match(formSource, /persistSchedule\(savedTask\.id\)/);
  assert.match(formSource, /await waitForSchedulePersistence\(user\.id, \[savedTask\.id\]\)/);
  assert.match(formSource, /await deleteTask\(savedTask\.id\)/);
  assert.match(formSource, /notifySaved\(\);[\s\S]*closeForm\(\);/);
});

test('existing blocks stop the empty-slot click and open their own editor', () => {
  assert.match(calendarSource, /onBlockClick=\{handleBlockClick\}/);
  assert.match(calendarSource, /if \(block\.taskId\) \{[\s\S]*openTaskFromOccurrence\(block\.id\)/);
  assert.match(calendarSource, /setEditingCommitment\(commitment\)/);
  assert.match(gridSource, /onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*onClick\?\.\(block\)/);
});

test('keyboard empty-slot creation reads the live visible scroll position', () => {
  assert.match(gridSource, /keyboardStartMinute=\{\(\) => keyboardEmptySlotStartMinute\([\s\S]*scrollRef\.current\?\.scrollTop,[\s\S]*initialScrollHour \* 60/);
});
