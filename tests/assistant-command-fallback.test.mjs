import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverExplicitRangeFromFalseSchoolConflict } from '../lib/schedule/assistant-command-fallback.ts';
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

test('the intended local PM range maps to the correct instants', () => {
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

  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [{ role: 'user', content: request }],
    normalizedCommand: normalized,
    normalizedPreview: normalizedSchoolConflict,
    interpret(command) {
      return command === request ? readyPreview(command) : normalizedSchoolConflict;
    },
  });

  assert.equal(recovery.recovered, true);
  assert.equal(recovery.command, request);
  assert.equal(recovery.preview.status, 'ready');
});

test('a follow-up correction retries the immediately preceding explicit range', () => {
  const original = 'create a task tonight from 10 pm to 11 pm for my common app';
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [
      { role: 'user', content: original },
      { role: 'assistant', content: normalizedSchoolConflict.summary },
      { role: 'user', content: 'that cannot overlap because school ends at 3:30 pm' },
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
  let calls = 0;
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [
      { role: 'user', content: 'create a task tonight from 10 pm to 11 pm' },
      { role: 'assistant', content: 'Okay.' },
      { role: 'user', content: 'What is due tomorrow?' },
      { role: 'assistant', content: 'Here are your tasks.' },
      { role: 'user', content: 'Please schedule it.' },
    ],
    normalizedCommand: 'Schedule task today at 10 am for 1 hour',
    normalizedPreview: normalizedSchoolConflict,
    interpret() {
      calls += 1;
      return readyPreview('unused');
    },
  });

  assert.equal(recovery.recovered, false);
  assert.equal(calls, 0);
});

test('leaves non-school clarifications unchanged', () => {
  const clarification = {
    status: 'clarification',
    summary: 'How long should this activity take?',
    actions: [],
  };
  let calls = 0;
  const recovery = recoverExplicitRangeFromFalseSchoolConflict({
    messages: [{ role: 'user', content: 'from 10 pm to 11 pm' }],
    normalizedCommand: 'Schedule task tonight',
    normalizedPreview: clarification,
    interpret() {
      calls += 1;
      return readyPreview('unused');
    },
  });

  assert.equal(recovery.recovered, false);
  assert.equal(recovery.preview, clarification);
  assert.equal(calls, 0);
});
