import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns';

/** Civil-date carriers: retain the selected weekday, not a stale prior week. */
export function shiftCalendarWeek(weekStart: Date, selectedDate: Date, direction: -1 | 1) {
  const offset = Math.max(0, Math.min(6, differenceInCalendarDays(selectedDate, weekStart)));
  const next = startOfDay(addDays(weekStart, direction * 7));
  return { weekStart: next, selectedDate: addDays(next, offset) };
}
