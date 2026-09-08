import { buildCommitmentOccurrences } from '../planner/commitments.ts';
import type { RecurringCommitmentInput } from '../planner/types';
import type { BuildScheduleOccurrencesInput, ScheduleOccurrenceCollection } from './types';
import {
  addLocalDays,
  buildScheduleOccurrences,
  isLocalDate,
  localDateFromIso,
  localDateTimeToIso,
  localMinuteOfDayFromIso,
} from './selectors.ts';

function calendarRange(startDate: string, endDate: string, timeZone?: string) {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || startDate > endDate) return null;
  const startAt = localDateTimeToIso(startDate, '00:00', timeZone);
  const endAt = localDateTimeToIso(addLocalDays(endDate, 1), '00:00', timeZone);
  return startAt && endAt ? { startAt, endAt } : null;
}

/** Include timed carryover without moving the task's source date or deadline. */
export function buildVisibleScheduleOccurrences(input: BuildScheduleOccurrencesInput): ScheduleOccurrenceCollection {
  const range = calendarRange(input.startDate, input.endDate, input.timeZone);
  if (!range) return { timed: [], untimed: [] };
  // Sessions may last 24 hours. A short DST day can let a session beginning
  // two civil dates earlier continue into the first visible date.
  const occurrences = buildScheduleOccurrences({ ...input, startDate: addLocalDays(input.startDate, -2) });
  return {
    timed: occurrences.timed.filter(item => {
      if (!item.startAt) return false;
      const start = new Date(item.startAt).getTime();
      const end = item.endAt ? new Date(item.endAt).getTime() : start + 30 * 60_000;
      return start < new Date(range.endAt).getTime() && end > new Date(range.startAt).getTime();
    }),
    untimed: occurrences.untimed.filter(item => item.date >= input.startDate && item.date <= input.endDate),
  };
}

/** Expand in the event's timezone, then intersect the visible calendar range. */
export function visibleCommitmentOccurrences(
  commitment: RecurringCommitmentInput,
  startDate: string,
  endDate: string,
  timeZone: string,
) {
  const range = calendarRange(startDate, endDate, timeZone);
  if (!range) return [];
  const eventTimeZone = commitment.timeZone || timeZone;
  const firstSourceDate = localDateFromIso(range.startAt, eventTimeZone);
  const lastSourceDate = localDateFromIso(new Date(new Date(range.endAt).getTime() - 1).toISOString(), eventTimeZone);
  if (!firstSourceDate || !lastSourceDate) return [];
  return buildCommitmentOccurrences(commitment, addLocalDays(firstSourceDate, -1), lastSourceDate)
    .flatMap(occurrence => {
      const startAt = localDateTimeToIso(occurrence.date, occurrence.startTime, eventTimeZone);
      const eventEndDate = occurrence.endTime > occurrence.startTime ? occurrence.date : addLocalDays(occurrence.date, 1);
      const endAt = localDateTimeToIso(eventEndDate, occurrence.endTime, eventTimeZone);
      if (!startAt || !endAt || startAt >= range.endAt || endAt <= range.startAt) return [];
      return [{ ...occurrence, startAt, endAt }];
    });
}

/** Wall-clock geometry for a single day, including midnight and DST edges. */
export function calendarIntervalGeometry(startAt: string, endAt: string, date: string, timeZone: string) {
  const range = calendarRange(date, date, timeZone);
  if (!range) return null;
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const dayStart = new Date(range.startAt).getTime();
  const dayEnd = new Date(range.endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end <= dayStart || start >= dayEnd) return null;
  const startMinute = start <= dayStart ? 0 : localMinuteOfDayFromIso(startAt, timeZone);
  const endMinute = end >= dayEnd ? 1440 : localMinuteOfDayFromIso(endAt, timeZone);
  if (startMinute === null || endMinute === null) return null;
  return { startMinute, durationMinutes: Math.max(15, endMinute - startMinute) };
}
