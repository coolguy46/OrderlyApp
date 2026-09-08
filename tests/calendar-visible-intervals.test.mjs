import assert from 'node:assert/strict';
import test from 'node:test';
import { buildVisibleScheduleOccurrences, visibleCommitmentOccurrences, calendarIntervalGeometry } from '../lib/schedule/visible-intervals.ts';
import { buildScheduleOccurrences, localDateTimeToIso } from '../lib/schedule/selectors.ts';
import { buildCommitmentOccurrences } from '../lib/planner/commitments.ts';

const zone = 'America/Los_Angeles';
const task = { id: 'overnight-task', user_id: 'fixture', title: 'Night work', status: 'pending', source: 'manual', due_date: null, recurrence: 'none' };
const entry = { id: 'schedule-night', taskId: task.id, scheduledDate: '2026-09-06', startAt: localDateTimeToIso('2026-09-06', '23:30', zone), durationSeconds: 7200, recurrence: 'none', occurrenceOverrides: {} };
const event = { id: 'overnight-event', title: 'Night event', kind: 'personal', daysOfWeek: [0], startDate: '2026-09-06', endDate: '2026-09-06', startTime: '23:30', endTime: '01:30', timeZone: zone };

test('timed task carryover remains visible on the next week without changing its source', () => {
  const input = { tasks: [task], entries: [entry], startDate: '2026-09-07', endDate: '2026-09-13', timeZone: zone };
  assert.equal(buildScheduleOccurrences(input).timed.length, 0, 'the source-date selector alone omits carryover');
  const result = buildVisibleScheduleOccurrences(input);
  assert.equal(result.timed.length, 1);
  assert.equal(result.timed[0].recurrenceSourceDate, '2026-09-06');
  assert.equal(result.timed[0].startAt, entry.startAt);
  assert.equal(result.untimed.length, 0);
});

test('visible schedules exclude past untimed work and intervals ending exactly at midnight', () => {
  const result = buildVisibleScheduleOccurrences({ tasks: [task], entries: [{ ...entry, durationSeconds: 1800 }], startDate: '2026-09-07', endDate: '2026-09-07', timeZone: zone });
  assert.equal(result.timed.length, 0);
  const untimed = buildVisibleScheduleOccurrences({ tasks: [task], entries: [{ ...entry, startAt: null }], startDate: '2026-09-07', endDate: '2026-09-07', timeZone: zone });
  assert.equal(untimed.untimed.length, 0);
});

test('overnight event survives a day or week boundary and retains its editable occurrence ID', () => {
  assert.equal(buildCommitmentOccurrences(event, '2026-09-07', '2026-09-07').length, 0);
  const result = visibleCommitmentOccurrences(event, '2026-09-07', '2026-09-07', zone);
  assert.equal(result.length, 1);
  assert.equal(result[0].sourceDate, '2026-09-06');
  assert.equal(result[0].id, 'commitment:overnight-event@2026-09-06');
});

test('event visibility follows the calendar timezone, including a different event timezone', () => {
  const tokyoEvent = { ...event, daysOfWeek: [1], startDate: '2026-09-07', endDate: '2026-09-07', startTime: '08:00', endTime: '09:00', timeZone: 'Asia/Tokyo' };
  assert.equal(visibleCommitmentOccurrences(tokyoEvent, '2026-09-06', '2026-09-06', zone).length, 1);
  assert.equal(visibleCommitmentOccurrences(tokyoEvent, '2026-09-07', '2026-09-07', zone).length, 0);
});

test('day geometry clips overnight work rather than overflowing or moving it to the wrong hour', () => {
  const end = localDateTimeToIso('2026-09-07', '01:30', zone);
  assert.deepEqual(calendarIntervalGeometry(entry.startAt, end, '2026-09-06', zone), { startMinute: 1410, durationMinutes: 30 });
  assert.deepEqual(calendarIntervalGeometry(entry.startAt, end, '2026-09-07', zone), { startMinute: 0, durationMinutes: 90 });
  assert.equal(calendarIntervalGeometry(entry.startAt, end, '2026-09-08', zone), null);
});

test('geometry uses wall-clock positions through daylight-saving changes', () => {
  const start = localDateTimeToIso('2027-03-14', '01:30', zone);
  const end = localDateTimeToIso('2027-03-14', '03:30', zone);
  assert.equal(new Date(end) - new Date(start), 3600000);
  assert.deepEqual(calendarIntervalGeometry(start, end, '2027-03-14', zone), { startMinute: 90, durationMinutes: 120 });
});

test('24-hour work can carry through two civil boundaries around a short DST day', () => {
  const result = buildVisibleScheduleOccurrences({ tasks: [task], entries: [{ ...entry, scheduledDate: '2027-03-13', startAt: localDateTimeToIso('2027-03-13', '23:30', zone), durationSeconds: 86400 }], startDate: '2027-03-15', endDate: '2027-03-15', timeZone: zone });
  assert.equal(result.timed.length, 1);
});

test('invalid ranges and invalid instants produce no display geometry', () => {
  assert.deepEqual(buildVisibleScheduleOccurrences({ tasks: [task], entries: [entry], startDate: 'invalid', endDate: '2026-09-07', timeZone: zone }), { timed: [], untimed: [] });
  assert.equal(calendarIntervalGeometry('invalid', entry.startAt, '2026-09-07', zone), null);
});
