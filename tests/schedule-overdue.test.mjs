import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleOccurrenceDueAt, isScheduleItemOverdue } from '../lib/schedule/overdue.ts';

const zone = 'America/Los_Angeles';
const now = new Date('2026-09-06T20:00:00Z'); // 1 PM PDT
function occurrence(task = {}, fields = {}) {
  return {
    task: { status: 'pending', source: 'manual', due_date: '2026-09-06', due_time: '12:00', ...task },
    date: '2026-09-06', recurrenceSourceDate: '2026-09-06', recurrence: 'none',
    startAt: '2026-09-06T16:00:00Z', endAt: '2026-09-06T17:00:00Z', ...fields,
  };
}
const due = (task, fields) => scheduleOccurrenceDueAt(occurrence(task, fields), zone);

test('scheduled work uses its real deadline, not its scheduled end or class color', () => {
  assert.equal(due(), '2026-09-06T19:00:00.000Z');
  assert.equal(isScheduleItemOverdue({ dueAt: due() }, now), true);
  assert.equal(isScheduleItemOverdue({ dueAt: due({ due_time: '15:00' }), color: '#ef4444' }, now), false);
  assert.equal(due({ due_date: null }), null, 'scheduling undated work must not invent a deadline');
  assert.equal(isScheduleItemOverdue({ dueAt: null }, now), false);
});

test('date-only deadlines stay current until local end of day', () => {
  assert.equal(due({ due_time: null }), '2026-09-07T06:59:59.000Z');
  assert.equal(isScheduleItemOverdue({ dueAt: due({ due_time: null }) }, now), false);
  assert.equal(isScheduleItemOverdue({ dueAt: due({ due_time: null }) }, new Date('2026-09-07T07:00:00Z')), true);
});

test('completed, missing, invalid, and not-yet-passed deadlines are not overdue', () => {
  for (const dueAt of [undefined, null, '', 'invalid', now, '2026-09-07T07:00:00Z']) {
    assert.equal(isScheduleItemOverdue({ dueAt }, now), false);
  }
  assert.equal(isScheduleItemOverdue({ dueAt: due(), completed: true }, now), false);
  assert.equal(isScheduleItemOverdue({ dueAt: due() }, NaN), false);
  assert.equal(due({ due_date: 'invalid' }), null);
  assert.equal(isScheduleItemOverdue({ dueAt: now }, now.getTime() + 1), true);
});

test('Canvas and Classroom use exact provider instants, ignoring stale display times', () => {
  for (const source of ['canvas', 'google_classroom']) {
    assert.equal(due({ source, due_date: '2026-09-06T20:30:45Z', due_time: '01:00' }), '2026-09-06T20:30:45.000Z');
  }
});

test('recurring deadlines follow the source occurrence, not an old series deadline or moved work date', () => {
  assert.equal(due({ due_date: '2026-09-01' }, {
    recurrence: 'daily', recurrenceSourceDate: '2026-09-07', date: '2026-09-08',
  }), '2026-09-07T19:00:00.000Z');
  assert.equal(isScheduleItemOverdue({ dueAt: due({ due_date: '2026-09-01' }, {
    recurrence: 'daily', recurrenceSourceDate: '2026-09-07',
  }) }, now), false);
  assert.equal(isScheduleItemOverdue({ dueAt: due({}, {
    recurrence: 'weekly', date: '2026-09-08',
  }) }, now), true, 'rescheduling late work does not erase its overdue state');
  assert.equal(due({ due_time: null }, { recurrence: 'daily' }), '2026-09-07T06:59:59.000Z');
  assert.equal(due({ due_date: null }, { recurrence: 'daily' }), null);
});

test('recurring deadlines retain local clock time across daylight-saving changes and preserve seconds', () => {
  assert.equal(due({ due_date: '2026-10-31', due_time: '12:00:15' }, {
    recurrence: 'daily', recurrenceSourceDate: '2026-11-01',
  }), '2026-11-01T20:00:15.000Z');
  assert.equal(due({ source: 'canvas', due_date: '2026-09-01T20:30:45Z' }, {
    recurrence: 'weekly', recurrenceSourceDate: '2026-09-08',
  }), '2026-09-08T20:30:45.000Z');
});
