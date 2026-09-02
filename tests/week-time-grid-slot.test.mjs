import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canActivateEmptySlot,
  emptySlotStartMinute,
  keyboardEmptySlotStartMinute,
} from '../components/planner/week-time-grid-slot.ts';
import { localDateTimeToIso, localTimeFromIso } from '../lib/schedule/selectors.ts';

test('empty scheduler clicks snap to the nearest 15-minute slot', () => {
  assert.equal(emptySlotStartMinute(132, 0), 135);
  assert.equal(emptySlotStartMinute(127, 0), 120);
});

test('empty scheduler click math remains accurate after vertical scrolling', () => {
  // The full-height day column has moved 360px above the viewport. A click at
  // viewport Y=300 is therefore minute 660 (11:00 AM) in the scrolled grid.
  assert.equal(emptySlotStartMinute(300, -360), 11 * 60);
});

test('keyboard activation follows the currently visible scheduler time', () => {
  assert.equal(keyboardEmptySlotStartMinute(22 * 60 + 8, 6 * 60), 22 * 60 + 15);
  assert.equal(keyboardEmptySlotStartMinute(undefined, 6 * 60), 6 * 60);
  assert.equal(keyboardEmptySlotStartMinute(1_440, 6 * 60), 23 * 60 + 30);
});

test('empty scheduler clicks clamp a 30-minute block inside the day', () => {
  assert.equal(emptySlotStartMinute(-20, 0), 0);
  assert.equal(emptySlotStartMinute(1_440, 0), 23 * 60 + 30);
});

test('the snapped wall-clock time converts through the planner timezone', () => {
  const minute = emptySlotStartMinute(22 * 60 + 4, 0);
  const hour = Math.floor(minute / 60).toString().padStart(2, '0');
  const minutes = (minute % 60).toString().padStart(2, '0');
  const instant = localDateTimeToIso('2026-09-02', `${hour}:${minutes}:00`, 'America/Los_Angeles');

  assert.equal(instant, '2026-09-03T05:00:00.000Z');
  assert.equal(localTimeFromIso(instant || '', 'America/Los_Angeles'), '22:00');
});

test('empty slot activation is suppressed during and immediately after gestures', () => {
  assert.equal(canActivateEmptySlot({ now: 500, suppressUntil: 500, dragActive: false, resizeActive: false }), true);
  assert.equal(canActivateEmptySlot({ now: 499, suppressUntil: 500, dragActive: false, resizeActive: false }), false);
  assert.equal(canActivateEmptySlot({ now: 500, suppressUntil: 0, dragActive: true, resizeActive: false }), false);
  assert.equal(canActivateEmptySlot({ now: 500, suppressUntil: 0, dragActive: false, resizeActive: true }), false);
});
