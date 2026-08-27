import assert from 'node:assert/strict';
import test from 'node:test';

import { countdownSecondsAt, stopwatchSecondsAt } from '../lib/timer-clock.ts';
import {
  focusTimerStateAfterBreak,
  MAX_STUDY_SESSION_MINUTES,
  stopwatchStudySessionTiming,
} from '../lib/timer-transitions.ts';

test('countdown uses its deadline after a long background-tab delay', () => {
  const startedAt = 1_000_000;
  const deadline = startedAt + 25 * 60 * 1000;

  assert.equal(countdownSecondsAt(deadline, startedAt), 25 * 60);
  assert.equal(countdownSecondsAt(deadline, startedAt + 7 * 60 * 1000 + 250), 18 * 60);
  assert.equal(countdownSecondsAt(deadline, deadline), 0);
  assert.equal(countdownSecondsAt(deadline, deadline + 60_000), 0);
});

test('stopwatch uses wall-clock elapsed time after a throttled interval', () => {
  const runStartedAt = 2_000_000;

  assert.equal(stopwatchSecondsAt(12, runStartedAt, runStartedAt), 12);
  assert.equal(stopwatchSecondsAt(12, runStartedAt, runStartedAt + 65_999), 77);
});

test('a resumed stopwatch excludes time spent paused', () => {
  const secondsAtPause = 90;
  const resumedAt = 5_000_000;

  assert.equal(stopwatchSecondsAt(secondsAtPause, resumedAt, resumedAt + 10_500), 100);
});

test('completing a break restores a full focus countdown', () => {
  assert.deepEqual(focusTimerStateAfterBreak(25 * 60), {
    mode: 'focus',
    timeLeft: 25 * 60,
  });
});

test('an over-24-hour stopwatch remains saveable and resettable', () => {
  const endedAt = '2026-08-27T18:00:00.000Z';
  const timing = stopwatchStudySessionTiming(
    25 * 60 * 60,
    '2026-08-26T17:00:00.000Z',
    endedAt,
  );

  assert.deepEqual(timing, {
    durationMinutes: MAX_STUDY_SESSION_MINUTES,
    startedAt: '2026-08-26T18:00:00.000Z',
    endedAt,
    wasTruncated: true,
  });
});

test('a normal stopwatch session keeps its original start timestamp', () => {
  const timing = stopwatchStudySessionTiming(
    90 * 60,
    '2026-08-27T16:30:00.000Z',
    '2026-08-27T18:00:00.000Z',
  );

  assert.equal(timing.durationMinutes, 90);
  assert.equal(timing.startedAt, '2026-08-27T16:30:00.000Z');
  assert.equal(timing.wasTruncated, false);
});
