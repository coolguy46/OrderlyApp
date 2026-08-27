export const MAX_STUDY_SESSION_MINUTES = 24 * 60;
const MAX_STUDY_SESSION_SECONDS = MAX_STUDY_SESSION_MINUTES * 60;

export function focusTimerStateAfterBreak(focusDurationSeconds: number): {
  mode: 'focus';
  timeLeft: number;
} {
  return {
    mode: 'focus',
    timeLeft: Math.max(0, Math.floor(focusDurationSeconds)),
  };
}

export interface StopwatchStudySessionTiming {
  durationMinutes: number;
  startedAt: string;
  endedAt: string;
  wasTruncated: boolean;
}

/**
 * The database intentionally limits one study-session row to 24 hours. A
 * forgotten stopwatch must still be resettable, so retain the most recent
 * 24-hour window instead of creating a permanently unsaveable retry payload.
 */
export function stopwatchStudySessionTiming(
  elapsedSeconds: number,
  originalStartedAt: string | null,
  endedAt: string,
): StopwatchStudySessionTiming {
  const endedAtMs = new Date(endedAt).getTime();
  if (!Number.isFinite(endedAtMs)) {
    throw new RangeError('endedAt must be a valid ISO timestamp');
  }

  const safeElapsedSeconds = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.floor(elapsedSeconds))
    : 0;
  const wasTruncated = safeElapsedSeconds > MAX_STUDY_SESSION_SECONDS;
  const boundedElapsedSeconds = Math.min(safeElapsedSeconds, MAX_STUDY_SESSION_SECONDS);
  const durationMinutes = Math.min(
    MAX_STUDY_SESSION_MINUTES,
    Math.max(1, Math.round(boundedElapsedSeconds / 60)),
  );
  const originalStartedAtMs = originalStartedAt
    ? new Date(originalStartedAt).getTime()
    : Number.NaN;
  const derivedStartedAtMs = endedAtMs - boundedElapsedSeconds * 1000;
  const startedAtMs = wasTruncated || !Number.isFinite(originalStartedAtMs)
    ? derivedStartedAtMs
    : originalStartedAtMs;

  return {
    durationMinutes,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    wasTruncated,
  };
}
