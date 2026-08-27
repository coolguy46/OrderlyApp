import type { Subject, Task } from '@/lib/supabase/types';
import type {
  BuildScheduleOccurrencesInput,
  LocalDate,
  ScheduleEntry,
  ScheduleOccurrence,
  ScheduleOccurrenceCollection,
  ScheduleOccurrenceOverride,
  ScheduleRecurrence,
} from './types';

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DURATION_PATTERN = /^(\d{1,3}):(\d{2}):(\d{2})$/;
export const DEFAULT_SCHEDULE_DURATION_SECONDS = 30 * 60;
export const MAX_SCHEDULE_DURATION_SECONDS = 24 * 60 * 60;

export function isLocalDate(value: string | null | undefined): value is LocalDate {
  if (!value || !LOCAL_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function safeTimeZone(value?: string): string {
  const fallback = typeof Intl !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    : 'UTC';
  const candidate = value || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return 'UTC';
  }
}

function dateFromLocalDate(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Convert a civil-date key into a browser-local Date used only as a UI carrier.
 * Noon keeps the carrier away from daylight-saving transitions at midnight.
 */
export function localDateToDateCarrier(value: string): Date | null {
  if (!isLocalDate(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

/** Read a civil-date key back from a browser-local UI carrier. */
export function localDateFromDateCarrier(value: Date): LocalDate | null {
  if (Number.isNaN(value.getTime())) return null;
  const year = value.getFullYear().toString().padStart(4, '0');
  const month = (value.getMonth() + 1).toString().padStart(2, '0');
  const day = value.getDate().toString().padStart(2, '0');
  const result = `${year}-${month}-${day}`;
  return isLocalDate(result) ? result : null;
}

export function addLocalDays(value: LocalDate, amount: number): LocalDate {
  const result = dateFromLocalDate(value);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

/** Find the next civil date in a recurrence without JS month overflow. */
export function nextLocalRecurrenceDate(
  currentDate: LocalDate,
  recurrence: ScheduleRecurrence,
  recurrenceDays?: number[] | null,
): LocalDate {
  if (recurrence === 'daily') return addLocalDays(currentDate, 1);
  if (recurrence === 'weekly') {
    const days = [...new Set(recurrenceDays || [])]
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    if (days.length === 0) return addLocalDays(currentDate, 7);
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addLocalDays(currentDate, offset);
      if (days.includes(dateFromLocalDate(candidate).getUTCDay())) return candidate;
    }
  }
  if (recurrence === 'monthly') {
    const [year, month, day] = currentDate.split('-').map(Number);
    const currentMonthLastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const targetMonthStart = new Date(Date.UTC(year, month, 1));
    const targetYear = targetMonthStart.getUTCFullYear();
    const targetMonth = targetMonthStart.getUTCMonth();
    const targetMonthLastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    const targetDay = day === currentMonthLastDay
      ? targetMonthLastDay
      : Math.min(day, targetMonthLastDay);
    return new Date(Date.UTC(targetYear, targetMonth, targetDay)).toISOString().slice(0, 10);
  }
  return currentDate;
}

/**
 * Test whether a civil date belongs to the monthly sequence produced by
 * `nextLocalRecurrenceDate`. This deliberately walks the sequence instead of
 * comparing day-of-month values: once a recurrence is clamped into the last
 * day of a short month, subsequent occurrences retain that end-of-month
 * intent. Keeping this rule here gives the task shelf, planner, previews, and
 * dashboard one canonical monthly-recurrence definition.
 */
export function isMonthlyRecurrenceDate(
  candidateDate: LocalDate,
  anchorDate: LocalDate,
): boolean {
  if (!isLocalDate(candidateDate) || !isLocalDate(anchorDate) || candidateDate < anchorDate) {
    return false;
  }
  if (candidateDate === anchorDate) return true;

  const [candidateYear, candidateMonth] = candidateDate.split('-').map(Number);
  const [anchorYear, anchorMonth] = anchorDate.split('-').map(Number);
  const monthDistance = (candidateYear - anchorYear) * 12 + candidateMonth - anchorMonth;
  if (monthDistance <= 0) return false;

  let occurrenceDate = anchorDate;
  for (let index = 0; index < monthDistance; index += 1) {
    occurrenceDate = nextLocalRecurrenceDate(occurrenceDate, 'monthly');
  }
  return occurrenceDate === candidateDate;
}

function localDayOfWeek(value: LocalDate): number {
  return dateFromLocalDate(value).getUTCDay();
}

function localDateParts(value: Date, requestedTimeZone?: string): { date: LocalDate; time: string } {
  const timeZone = safeTimeZone(requestedTimeZone);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
  };
}

export function localDateFromIso(value: string, timeZone?: string): LocalDate | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateParts(parsed, timeZone).date;
}

export function localTimeFromIso(value: string, timeZone?: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateParts(parsed, timeZone).time.slice(0, 5);
}

/** Format an ISO instant in the schedule's timezone, never the browser's. */
export function formatIsoTime(value: string, requestedTimeZone?: string): string | null {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(requestedTimeZone),
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

/** Return the wall-clock minute used to position an instant on a day grid. */
export function localMinuteOfDayFromIso(value: string, requestedTimeZone?: string): number | null {
  const localTime = localTimeFromIso(value, requestedTimeZone);
  if (!localTime) return null;
  const [hour, minute] = localTime.split(':').map(Number);
  return hour * 60 + minute;
}

/** Convert a wall-clock date/time in an IANA timezone into a stable ISO instant. */
export function localDateTimeToIso(
  date: LocalDate,
  time: string,
  requestedTimeZone?: string,
): string | null {
  if (!isLocalDate(date) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = time.split(':').map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const timeZone = safeTimeZone(requestedTimeZone);
  const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = desiredAsUtc;
  for (let pass = 0; pass < 4; pass += 1) {
    const rendered = localDateParts(new Date(guess), timeZone);
    const renderedDate = dateFromLocalDate(rendered.date);
    const [renderedHour, renderedMinute, renderedSecond] = rendered.time.split(':').map(Number);
    const renderedAsUtc = Date.UTC(
      renderedDate.getUTCFullYear(),
      renderedDate.getUTCMonth(),
      renderedDate.getUTCDate(),
      renderedHour,
      renderedMinute,
      renderedSecond,
    );
    const adjustment = desiredAsUtc - renderedAsUtc;
    guess += adjustment;
    if (adjustment === 0) break;
  }

  const resolved = localDateParts(new Date(guess), timeZone);
  if (resolved.date !== date || resolved.time !== `${time.slice(0, 5)}:${String(second).padStart(2, '0')}`) {
    return null;
  }
  return new Date(guess).toISOString();
}

export function parseDurationInput(value: string): number | null {
  const match = DURATION_PATTERN.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total <= 0 || total > MAX_SCHEDULE_DURATION_SECONDS) return null;
  return total;
}

export function formatDurationInput(value: number | null | undefined): string {
  if (!value || value <= 0) return '';
  const total = Math.min(Math.trunc(value), MAX_SCHEDULE_DURATION_SECONDS);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function scheduledEndAt(startAt: string | null, durationSeconds: number | null): string | null {
  if (!startAt || !durationSeconds || durationSeconds <= 0) return null;
  const start = new Date(startAt).getTime();
  if (Number.isNaN(start)) return null;
  return new Date(start + durationSeconds * 1000).toISOString();
}

export function selectScheduleEntry(
  entriesByUser: Record<string, Record<string, ScheduleEntry>>,
  userId: string | null | undefined,
  taskId: string | null | undefined,
): ScheduleEntry | null {
  if (!userId || !taskId) return null;
  return entriesByUser[userId]?.[taskId] || null;
}

export function selectScheduleEntriesForUser(
  entriesByUser: Record<string, Record<string, ScheduleEntry>>,
  userId: string | null | undefined,
): ScheduleEntry[] {
  if (!userId) return [];
  return Object.values(entriesByUser[userId] || {}).sort((left, right) =>
    left.taskId.localeCompare(right.taskId)
  );
}

function normalizedDays(value: number[] | null | undefined): number[] {
  return [...new Set((value || []).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
}

export function taskDeadlineDate(task: Task, timeZone?: string): LocalDate | null {
  return task.due_date ? localDateFromIso(task.due_date, timeZone) : null;
}

export interface TaskUntimedDisplayDateOptions {
  timeZone?: string;
  schoolDays?: readonly number[];
  schoolStartTime?: string;
  schoolHomeTime?: string;
}

/**
 * Canvas/Classroom deadlines that land during configured school hours are
 * surfaced on the previous day's task shelf. The real deadline is never edited.
 */
export function taskUntimedDisplayDate(
  task: Task,
  options: TaskUntimedDisplayDateOptions = {},
): LocalDate | null {
  const deadlineDate = taskDeadlineDate(task, options.timeZone);
  if (!deadlineDate) return null;
  if (task.source !== 'canvas' && task.source !== 'google_classroom') return deadlineDate;
  if ((task.recurrence || 'none') !== 'none') return deadlineDate;
  if (!task.due_date) return deadlineDate;

  const schoolDays = [...new Set((options.schoolDays || [])
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))];
  const schoolStart = options.schoolStartTime || '';
  const schoolHome = options.schoolHomeTime || '';
  if (
    schoolDays.length === 0
    || !/^\d{2}:\d{2}$/.test(schoolStart)
    || !/^\d{2}:\d{2}$/.test(schoolHome)
    || schoolStart >= schoolHome
  ) {
    return deadlineDate;
  }

  const due = new Date(task.due_date);
  if (Number.isNaN(due.getTime())) return deadlineDate;
  const local = localDateParts(due, options.timeZone);
  const dueTime = local.time.slice(0, 5);
  const duringSchool = schoolDays.includes(localDayOfWeek(local.date))
    && dueTime >= schoolStart
    && dueTime < schoolHome;
  return duringSchool ? addLocalDays(local.date, -1) : deadlineDate;
}

function recurrenceFor(task: Task, entry: ScheduleEntry | null): ScheduleRecurrence {
  if (task.status === 'completed') return 'none';
  const value = entry?.recurrence || task.recurrence || 'none';
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : 'none';
}

function occursOnDate(
  date: LocalDate,
  anchorDate: LocalDate,
  recurrence: ScheduleRecurrence,
  recurrenceDays: number[],
): boolean {
  if (date < anchorDate) return false;
  if (recurrence === 'none') return date === anchorDate;
  if (recurrence === 'daily') return true;
  if (recurrence === 'weekly') {
    const days = recurrenceDays.length > 0 ? recurrenceDays : [localDayOfWeek(anchorDate)];
    return days.includes(localDayOfWeek(date));
  }
  return isMonthlyRecurrenceDate(date, anchorDate);
}

function hasOwn<T extends object>(value: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function startAtForOccurrence(
  entry: ScheduleEntry | null,
  sourceDate: LocalDate,
  resolvedDate: LocalDate,
  override: ScheduleOccurrenceOverride,
  timeZone?: string,
): string | null {
  if (hasOwn(override, 'startAt')) return override.startAt || null;
  if (!entry?.startAt) return null;
  const base = new Date(entry.startAt);
  if (Number.isNaN(base.getTime())) return null;
  const baseTime = localDateParts(base, timeZone).time;
  return localDateTimeToIso(resolvedDate || sourceDate, baseTime, timeZone);
}

function occurrenceFor(
  task: Task,
  entry: ScheduleEntry | null,
  sourceDate: LocalDate,
  override: ScheduleOccurrenceOverride,
  subjectsById: Map<string, Subject>,
  recurrence: ScheduleRecurrence,
  timeZone?: string,
): ScheduleOccurrence | null {
  if (override.skipped) return null;
  const date = isLocalDate(override.scheduledDate) ? override.scheduledDate : sourceDate;
  const startAt = startAtForOccurrence(entry, sourceDate, date, override, timeZone);
  const durationSeconds = hasOwn(override, 'durationSeconds')
    ? override.durationSeconds || null
    : entry?.durationSeconds || null;
  const subject = task.subject_id ? (subjectsById.get(task.subject_id) || null) : null;
  return {
    id: `${entry?.id || `virtual:${task.id}`}@${sourceDate}`,
    entryId: entry?.id || null,
    taskId: task.id,
    task,
    title: task.title,
    description: task.description,
    subjectId: task.subject_id,
    subject,
    color: subject?.color || null,
    date,
    recurrenceSourceDate: sourceDate,
    startAt,
    endAt: scheduledEndAt(startAt, durationSeconds),
    durationSeconds,
    timed: Boolean(startAt),
    virtual: entry === null,
    recurrence,
  };
}

/**
 * Build the canonical task schedule for an inclusive local-date range.
 * Tasks without saved schedule metadata appear as virtual untimed work on their
 * deadline date, so Canvas/manual imports are immediately useful.
 */
export function buildScheduleOccurrences({
  tasks,
  entries,
  subjects = [],
  overrides = {},
  startDate,
  endDate,
  timeZone,
  schoolHours,
}: BuildScheduleOccurrencesInput): ScheduleOccurrenceCollection {
  if (!isLocalDate(startDate) || !isLocalDate(endDate) || startDate > endDate) {
    return { timed: [], untimed: [] };
  }
  const entriesByTask = new Map(entries.map(entry => [entry.taskId, entry]));
  const subjectsById = new Map(subjects.map(subject => [subject.id, subject]));
  const occurrences: ScheduleOccurrence[] = [];

  for (const task of tasks) {
    const entry = entriesByTask.get(task.id) || null;
    const recurrence = recurrenceFor(task, entry);
    const anchorDate = entry?.scheduledDate || (recurrence === 'none'
      ? taskUntimedDisplayDate(task, {
        timeZone,
        schoolDays: schoolHours?.schoolDays,
        schoolStartTime: schoolHours?.schoolStartTime,
        schoolHomeTime: schoolHours?.schoolHomeTime,
      })
      : taskDeadlineDate(task, timeZone));
    if (!anchorDate || !isLocalDate(anchorDate)) continue;
    const recurrenceDays = normalizedDays(entry?.recurrenceDays || task.recurrence_days);
    const recurrenceEndDate = entry?.recurrenceEndDate;
    const persistedOverrides = entry?.occurrenceOverrides || {};
    const transientOverrides = overrides[task.id] || {};
    const candidateDates = new Set<LocalDate>();

    for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
      if (recurrenceEndDate && date > recurrenceEndDate) continue;
      if (occursOnDate(date, anchorDate, recurrence, recurrenceDays)) candidateDates.add(date);
    }
    // Include moved occurrences whose source is outside the visible range.
    for (const sourceDate of [...Object.keys(persistedOverrides), ...Object.keys(transientOverrides)]) {
      if (isLocalDate(sourceDate)) candidateDates.add(sourceDate);
    }

    for (const sourceDate of candidateDates) {
      if (sourceDate < anchorDate) continue;
      if (recurrenceEndDate && sourceDate > recurrenceEndDate) continue;
      if (!occursOnDate(sourceDate, anchorDate, recurrence, recurrenceDays)) continue;
      const override = {
        ...(persistedOverrides[sourceDate] || {}),
        ...(transientOverrides[sourceDate] || {}),
      };
      const occurrence = occurrenceFor(
        task,
        entry,
        sourceDate,
        override,
        subjectsById,
        recurrence,
        timeZone,
      );
      if (occurrence && occurrence.date >= startDate && occurrence.date <= endDate) {
        occurrences.push(occurrence);
      }
    }
  }

  const timed = occurrences.filter(item => item.timed).sort((left, right) =>
    (left.startAt || '').localeCompare(right.startAt || '') || left.id.localeCompare(right.id)
  );
  const untimed = occurrences.filter(item => !item.timed).sort((left, right) =>
    left.date.localeCompare(right.date) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id)
  );
  return { timed, untimed };
}

/** Backward-friendly alias for consumers that prefer a selector-style name. */
export const selectScheduleOccurrences = buildScheduleOccurrences;
