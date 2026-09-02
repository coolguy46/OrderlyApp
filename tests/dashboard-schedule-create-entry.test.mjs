import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  dashboardScheduleCreationSlot,
} from '../components/dashboard/dashboard-schedule-slot.ts';

const source = await readFile(
  new URL('../components/dashboard/DashboardSchedule.tsx', import.meta.url),
  'utf8',
);

test('dashboard schedule clicks create an exact snapped 30-minute slot', () => {
  assert.deepEqual(
    dashboardScheduleCreationSlot('2026-09-02', 10 * 54 + 8, 0),
    {
      date: '2026-09-02',
      startTime: '10:15',
      durationSeconds: 30 * 60,
    },
  );
  assert.equal(
    dashboardScheduleCreationSlot('2026-09-02', 300, -300).startTime,
    '11:00',
    'pointer math must remain accurate after the calendar scrolls',
  );
});

test('dashboard schedule opens the shared Task/Event form with the clicked slot', () => {
  assert.match(source, /setCreationSlot\(\{[\s\S]*\.\.\.dashboardScheduleCreationSlot\(dateKey, event\.clientY, bounds\.top\),[\s\S]*userId/);
  assert.match(source, /<TaskForm[\s\S]*isOpen=\{Boolean\(creationSlot && creationSlot\.userId === userId\)\}[\s\S]*initialMode="task"[\s\S]*initialDate=\{creationSlot\?\.userId === userId \? creationSlot\.date : ''\}[\s\S]*initialStartTime=\{creationSlot\?\.userId === userId \? creationSlot\.startTime : ''\}[\s\S]*initialDurationSeconds=\{creationSlot\?\.userId === userId \? creationSlot\.durationSeconds : null\}/);
  assert.match(source, /Click an empty time to add a task or event\./);
});

test('existing dashboard blocks do not trigger empty-time creation', () => {
  assert.match(source, /if \(target\.closest\('\[data-dashboard-schedule-block\]'\)\) return/);
  assert.match(source, /data-dashboard-schedule-block[\s\S]*onClick=\{\(event\) => \{[\s\S]*event\.stopPropagation\(\);[\s\S]*setDetailOccurrenceId\(item\.id\)/);
});

test('dashboard calendar state is fenced and reset when the active account changes', () => {
  assert.match(source, /useStoredCalendarEvents\(userId\)/);
  assert.doesNotMatch(source, /useState<StoredCalendarEvent\[\]>/);
  assert.match(source, /setSelectedDateKey\(today\);[\s\S]*setDetailOccurrenceId\(null\);[\s\S]*setCreationSlot\(null\);[\s\S]*\}, \[timeZone, userId\]\)/);
  assert.match(source, /if \(!userId\) return;[\s\S]*setCreationSlot\(\{[\s\S]*userId/);
});
