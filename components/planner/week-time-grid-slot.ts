export const GRID_MINUTES_PER_DAY = 24 * 60;
export const GRID_SNAP_MINUTES = 15;
export const DEFAULT_EMPTY_SLOT_DURATION_MINUTES = 30;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Convert a viewport pointer position into a snapped wall-clock minute.
 * `columnTop` deliberately comes from getBoundingClientRect(): when the time
 * grid scrolls, the column's top moves with its content, so no separate
 * scrollTop correction is needed.
 */
export function emptySlotStartMinute(
  clientY: number,
  columnTop: number,
  durationMinutes = DEFAULT_EMPTY_SLOT_DURATION_MINUTES,
): number {
  const safeDuration = clamp(
    Math.ceil(durationMinutes / GRID_SNAP_MINUTES) * GRID_SNAP_MINUTES,
    GRID_SNAP_MINUTES,
    GRID_MINUTES_PER_DAY,
  );
  const requestedMinute = clientY - columnTop;
  const snappedMinute = Math.round(requestedMinute / GRID_SNAP_MINUTES) * GRID_SNAP_MINUTES;
  return clamp(snappedMinute, 0, GRID_MINUTES_PER_DAY - safeDuration);
}

/** Choose the first visible snapped slot when a day column is keyboard-activated. */
export function keyboardEmptySlotStartMinute(
  scrollTop: number | null | undefined,
  fallbackMinute: number,
  durationMinutes = DEFAULT_EMPTY_SLOT_DURATION_MINUTES,
): number {
  const visibleMinute = typeof scrollTop === 'number' && Number.isFinite(scrollTop)
    ? scrollTop
    : fallbackMinute;
  return emptySlotStartMinute(visibleMinute, 0, durationMinutes);
}

export function canActivateEmptySlot(input: {
  now: number;
  suppressUntil: number;
  dragActive: boolean;
  resizeActive: boolean;
}): boolean {
  return input.now >= input.suppressUntil && !input.dragActive && !input.resizeActive;
}
