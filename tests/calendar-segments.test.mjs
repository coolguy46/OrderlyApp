import assert from 'node:assert/strict';
import test from 'node:test';
import { splitCalendarIntervalByDay } from '../lib/planner/calendar-segments.ts';

test('overnight blocks render one segment on each calendar day', () => {
  const start = new Date(2026, 0, 30, 23, 30);
  const end = new Date(2026, 0, 31, 1, 15);
  const segments = splitCalendarIntervalByDay(start, end, new Date(2026, 0, 26), 7);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].start.getTime(), start.getTime());
  assert.equal(segments[0].end.getHours(), 0);
  assert.equal(segments[0].end.getDate(), 31);
  assert.equal(segments[0].startsAtSource, true);
  assert.equal(segments[0].endsAtSource, false);
  assert.equal(segments[1].start.getTime(), segments[0].end.getTime());
  assert.equal(segments[1].end.getTime(), end.getTime());
  assert.equal(segments[1].startsAtSource, false);
  assert.equal(segments[1].endsAtSource, true);
});

test('segments are clipped to the visible week', () => {
  const visibleStart = new Date(2026, 1, 2);
  const segments = splitCalendarIntervalByDay(
    new Date(2026, 1, 1, 23, 0),
    new Date(2026, 1, 2, 2, 0),
    visibleStart,
    7,
  );

  assert.equal(segments.length, 1);
  assert.equal(segments[0].start.getTime(), visibleStart.getTime());
  assert.equal(segments[0].startsAtSource, false);
});
