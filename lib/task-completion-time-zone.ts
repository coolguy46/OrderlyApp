function isUsableTimeZone(value: string | null | undefined): value is string {
  if (!value?.trim() || typeof Intl === 'undefined') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

/**
 * Recurring task completion must advance the series in the account's planner
 * timezone. A browser may be traveling (or simply configured differently), so
 * its timezone is only a fallback for accounts that do not yet have a saved
 * planner preference.
 */
export function resolveTaskCompletionTimeZone(
  persistedPlannerTimeZone: string | null | undefined,
  browserTimeZone: string | null | undefined,
): string {
  if (isUsableTimeZone(persistedPlannerTimeZone)) return persistedPlannerTimeZone;
  if (isUsableTimeZone(browserTimeZone)) return browserTimeZone;
  return 'UTC';
}
