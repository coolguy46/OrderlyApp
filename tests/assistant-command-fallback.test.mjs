import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isUnverifiedCalendarOutcome,
  recoverExplicitRangeFromFalseSchoolConflict,
} from '../lib/schedule/assistant-command-fallback.ts';
import { findScheduleClockRange } from '../lib/schedule/command-text.ts';

test('prose-only model calendar outcomes are never treated as verified facts', () => {
  assert.equal(isUnverifiedCalendarOutcome('I can\'t add it at 10–11 PM because that time overlaps school.'), true);
  assert.equal(isUnverifiedCalendarOutcome('Orderly scheduled the task on your calendar.'), true);
  assert.equal(isUnverifiedCalendarOutcome('That conflicts with your workout.'), true);
  assert.equal(isUnverifiedCalendarOutcome('Your week has three assignments due Friday.'), false);
  assert.equal(isUnverifiedCalendarOutcome('Would you like help organizing those assignments?'), false);
});
import { localDateTimeToIso } from '../lib/schedule/selectors.ts';

const normalizedSchoolConflict = {
  status: 'clarification',
  summary: 'That time overlaps “School day (starts 08:00)”. Pick another time.',
  actions: [],
};

function readyPreview(command) {
  return {
    status: 'ready',
    summary: `Schedule ${command}`,
    actions: [{ type: 'create_task' }],
  };
}

test('an explicit PM range keeps both meridiems and maps to the intended local date', () => {
  const range = findScheduleClockRange('create a task for tonight from 10 pm to 11 pm');

  assert.ok(range);
  assert.equal(range.startHour, '10');
  assert.equal(range.startPeriod?.toLowerCase(), 'pm');
  assert.equal(range.endHour, '11');
  assert.equal(range.endPeriod?.toLowerCase(), 'pm');
  assert.equal(
    localDateTimeToIso('2026-08-28', '22:00:00', 'America/Los_Angeles'),
    '2026-08-29T05:00:00.000Z',
  );
  assert.equal(
    localDateTimeToIso('2026-08-28', '23:00:00', 'America/Los_Angeles'),
    '2026-08-29T06:00:00.000Z',
  );
});

test('recovers the user clock range when the AI rewrite creates a false school conflict', () => {
  const request = 'create a task for tonight from 10 pm to 11 pm to work on my common app';
  const normalized = 'Schedule Common App today at 10 pm for 11 hours';
  const interpreted = [];

  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [{ role: 'user', content: request }],
    normalizedCommand: normalized,
    normalizedPreview: normalizedSchoolConflict,
    interpret(command) {
      interpreted.push(command);
      return command === request ? readyPreview(command) : normalizedSchoolConflict;
    },
  });

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.command, request);
  assert.equal(recovery.preview.status, 'ready');
  assert.deepEqual(interpreted, [request]);
});

test('a follow-up correction can retry the immediately preceding explicit range', () => {
  const original = 'create a task tonight from 10 pm to 11 pm for my common app';
  const correction = 'that cannot overlap because school ends at 3:30 pm';
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [
      { role: 'user', content: original },
      { role: 'assistant', content: normalizedSchoolConflict.summary },
      { role: 'user', content: correction },
    ],
    normalizedCommand: 'Schedule Common App today at 10 am for 1 hour',
    normalizedPreview: normalizedSchoolConflict,
    interpret(command) {
      return command === original ? readyPreview(command) : normalizedSchoolConflict;
    },
  });

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.command, original);
});

test('does not bypass a real school collision', () => {
  const request = 'create a task today from 10 am to 11 am';
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [{ role: 'user', content: request }],
    normalizedCommand: 'Schedule task today at 10 am for 1 hour',
    normalizedPreview: normalizedSchoolConflict,
    interpret() {
      return normalizedSchoolConflict;
    },
  });

  assert.equal(recovery.recovered, false);
  assert.equal(recovery.preview, normalizedSchoolConflict);
});

test('does not use an old clock range beyond the latest two user messages', () => {
  const oldRequest = 'create a task tonight from 10 pm to 11 pm';
  let interpretCalls = 0;

  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [
      { role: 'user', content: oldRequest },
      { role: 'assistant', content: 'Okay.' },
      { role: 'user', content: 'What is due tomorrow?' },
      { role: 'assistant', content: 'Here are your tasks.' },
      { role: 'user', content: 'Please schedule it.' },
    ],
    normalizedCommand: 'Schedule task today at 10 am for 1 hour',
    normalizedPreview: normalizedSchoolConflict,
    interpret() {
      interpretCalls += 1;
      return readyPreview(oldRequest);
    },
  });

  assert.equal(recovery.recovered, false);
  assert.equal(interpretCalls, 0);
});

test('leaves non-school clarifications unchanged', () => {
  const clarification = {
    status: 'clarification',
    summary: 'How long should this activity take?',
    actions: [],
  };
  let interpretCalls = 0;
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [{ role: 'user', content: 'from 10 pm to 11 pm' }],
    normalizedCommand: 'Schedule task tonight',
    normalizedPreview: clarification,
    interpret() {
      interpretCalls += 1;
      return readyPreview('unused');
    },
  });

  assert.equal(recovery.recovered, false);
  assert.equal(recovery.preview, clarification);
  assert.equal(interpretCalls, 0);
});
