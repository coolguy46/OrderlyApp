/**
 * Return the whole seconds still visible on a countdown clock.
 *
 * A deadline, rather than a number of interval callbacks, is the source of
 * truth so a throttled/background tab catches up as soon as it runs again.
 */
export function countdownSecondsAt(deadlineMs: number, nowMs: number): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/**
 * Return a stopwatch's accumulated whole seconds for its current run.
 * Paused time is excluded by starting a new run with the previous value as
 * `baseSeconds`.
 */
export function stopwatchSecondsAt(
  baseSeconds: number,
  runStartedAtMs: number,
  nowMs: number
): number {
  const safeBase = Number.isFinite(baseSeconds)
    ? Math.max(0, Math.floor(baseSeconds))
    : 0;
  if (!Number.isFinite(runStartedAtMs) || !Number.isFinite(nowMs)) {
    return safeBase;
  }
  return safeBase + Math.max(0, Math.floor((nowMs - runStartedAtMs) / 1000));
}
