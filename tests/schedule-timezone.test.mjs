import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatIsoTime,
  localDateFromDateCarrier,
  localDateFromIso,
  localDateToDateCarrier,
  localMinuteOfDayFromIso,
  isMonthlyRecurrenceDate,
  nextLocalRecurrenceDate,
} from '../lib/schedule/selectors.ts';

test('scheduled instants display and position in the configured timezone', () => {
  const instant = '2026-08-26T04:00:00.000Z';

  assert.equal(formatIsoTime(instant, 'America/Los_Angeles'), '9:00 PM');
  assert.equal(localMinuteOfDayFromIso(instant, 'America/Los_Angeles'), 21 * 60);
  assert.equal(formatIsoTime(instant, 'UTC'), '4:00 AM');
  assert.equal(localMinuteOfDayFromIso(instant, 'UTC'), 4 * 60);
});

test('daily grouping follows the configured timezone at a date boundary', () => {
  const instant = '2026-08-26T04:00:00.000Z';

  assert.equal(localDateFromIso(instant, 'America/Los_Angeles'), '2026-08-25');
  assert.equal(localDateFromIso(instant, 'UTC'), '2026-08-26');
});

test('civil-date UI carriers round-trip without changing the selected key', () => {
  const carrier = localDateToDateCarrier('2026-03-08');

  assert.ok(carrier);
  assert.equal(carrier.getHours(), 12);
  assert.equal(localDateFromDateCarrier(carrier), '2026-03-08');
  assert.equal(localDateToDateCarrier('2026-02-30'), null);
  assert.equal(localDateFromDateCarrier(new Date(Number.NaN)), null);
});

test('invalid schedule instants do not produce labels or positions', () => {
  assert.equal(formatIsoTime('not-a-date', 'UTC'), null);
  assert.equal(localMinuteOfDayFromIso('not-a-date', 'UTC'), null);
});

test('monthly recurrence clamps safely and preserves end-of-month intent', () => {
  assert.equal(nextLocalRecurrenceDate('2026-01-30', 'monthly'), '2026-02-28');
  assert.equal(nextLocalRecurrenceDate('2026-01-31', 'monthly'), '2026-02-28');
  assert.equal(nextLocalRecurrenceDate('2026-02-28', 'monthly'), '2026-03-31');
  assert.equal(nextLocalRecurrenceDate('2026-03-30', 'monthly'), '2026-04-30');
  assert.equal(isMonthlyRecurrenceDate('2026-02-28', '2026-01-30'), true);
  assert.equal(isMonthlyRecurrenceDate('2026-03-31', '2026-01-30'), true);
  assert.equal(isMonthlyRecurrenceDate('2026-03-30', '2026-01-30'), false);
  assert.equal(isMonthlyRecurrenceDate('2026-04-30', '2026-01-30'), true);
});
