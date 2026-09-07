import { addLocalDays, isLocalDate } from '../schedule/selectors';

// Bound expansion per operation, not how far into the future a date can be.
export const MAX_CALENDAR_DAYS = 366;
export const DEFAULT_CONTEXT_DAYS = 14;
export interface CalendarDateRange { from: string; through: string }
export class CalendarCapacityError extends Error {}

export function calendarRange(from: string, days: number): CalendarDateRange {
  if (!isLocalDate(from) || !Number.isInteger(days) || days < 1 || days > MAX_CALENDAR_DAYS) {
    throw new CalendarCapacityError(`Choose a valid date range of 1–${MAX_CALENDAR_DAYS} days per request. Longer ranges must be split; they are never shortened automatically.`);
  }
  return { from, through: addLocalDays(from, days - 1) };
}

export function validateCalendarRange(range: CalendarDateRange): CalendarDateRange {
  if (!isLocalDate(range.from) || !isLocalDate(range.through)) throw new Error('Invalid calendar range');
  const days = Math.round((Date.parse(`${range.through}T12:00:00Z`) - Date.parse(`${range.from}T12:00:00Z`)) / 86400000) + 1;
  return calendarRange(range.from, days);
}
