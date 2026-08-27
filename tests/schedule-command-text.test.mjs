import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAmbiguousBareTime,
  normalizeScheduleCommandWords,
} from '../lib/schedule/command-text.ts';

test('assistant matching ignores known imported-task source prefixes', () => {
  const command = normalizeScheduleCommandWords('Schedule Engagement tomorrow for 30 minutes');

  assert.equal(normalizeScheduleCommandWords('[Canvas] Engagement'), 'engagement');
  assert.equal(normalizeScheduleCommandWords('[Google Classroom] Engagement'), 'engagement');
  assert.equal(command.includes(normalizeScheduleCommandWords('[Canvas] Engagement')), true);
});

test('all bare 1–12 clock times require clarification', () => {
  for (const hour of [1, 4, 7, 8, 11, 12]) {
    assert.equal(findAmbiguousBareTime(`Schedule chemistry at ${hour}`), String(hour));
  }
  assert.equal(findAmbiguousBareTime('Find a gap after 9'), '9');
  assert.equal(findAmbiguousBareTime('Move chemistry from 8 to 11'), '8');
});

test('AM/PM and explicit 24-hour times do not require clarification', () => {
  assert.equal(findAmbiguousBareTime('Schedule chemistry at 4 pm'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry from 4 to 5 pm'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry at 08:00'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry at 20:00'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry from 13:00 to 14:00'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry 13:00-14:00'), null);
});

test('durations and ISO dates are not mistaken for ambiguous clock times', () => {
  assert.equal(findAmbiguousBareTime('Study for 2 hours every day'), null);
  assert.equal(findAmbiguousBareTime('Schedule chemistry on 2026-08-27 for 45 minutes'), null);
  assert.equal(findAmbiguousBareTime('Schedule [Canvas] 1-3 Problem Set tomorrow for 45 minutes'), null);
  assert.equal(findAmbiguousBareTime('Schedule [Canvas] 1-3 Problem Set at 4 pm'), null);
});
