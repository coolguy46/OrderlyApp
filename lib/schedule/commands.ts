import type { Task } from '@/lib/supabase/types';
import { plannerTaskDeadline } from '@/lib/planner/adapters';
import type {
  CommitmentKind,
  RecurringCommitmentInput,
} from '@/lib/planner/types';
import {
  addLocalDays,
  isLocalDate,
  localDateFromIso,
  localDateTimeToIso,
} from './selectors';
import type {
  LocalDate,
  ScheduleBatchOperation,
  ScheduleEntry,
  ScheduleEntryInput,
  ScheduleOccurrence,
  ScheduleRecurrence,
} from './types';

export type ScheduleCommandKind =
  | 'add'
  | 'move'
  | 'resize'
  | 'repeat'
  | 'delete'
  | 'find_gap';

export type ScheduleCommandStatus = 'ready' | 'query' | 'clarification' | 'invalid';

export interface ScheduleCommandBusyInterval {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  taskId?: string | null;
}

export interface ScheduleCommandContext {
  now: string;
  timeZone: string;
  tasks: readonly Task[];
  entries: readonly ScheduleEntry[];
  occurrences: readonly ScheduleOccurrence[];
  busy?: readonly ScheduleCommandBusyInterval[];
  selectedTaskId?: string | null;
  selectedDate?: LocalDate | null;
  availableStartTime?: string;
  availableEndTime?: string;
}

export interface ScheduleCommandCreateTaskAction {
  type: 'create_task';
  title: string;
  description: string | null;
  schedule: ScheduleEntryInput;
}

/**
 * A calendar event is intentionally distinct from a task. Events are fixed
 * commitments (classes, games, meetings, appointments, and similar blocks),
 * so they must not acquire task-only behavior such as completion, deadlines,
 * priority, or the untimed task shelf.
 */
export interface ScheduleCommandCreateEventAction {
  type: 'create_event';
  title: string;
  description: string | null;
  kind: CommitmentKind;
  schedule: ScheduleEntryInput;
}

export interface ScheduleCommandBatchAction {
  type: 'schedule_batch';
  operations: ScheduleBatchOperation[];
}

export type ScheduleCommandAction =
  | ScheduleCommandCreateTaskAction
  | ScheduleCommandCreateEventAction
  | ScheduleCommandBatchAction;

export interface ScheduleCommandEventCommitmentOptions {
  id: string;
  timeZone: string;
  updatedAt: string;
  color?: string | null;
}

export interface ScheduleCommandGap {
  startAt: string;
  endAt: string;
  date: LocalDate;
  label: string;
}

export interface ScheduleCommandOccurrencePreview {
  taskId: string | null;
  title: string;
  date: LocalDate;
  startAt: string | null;
  durationSeconds: number | null;
}

export interface ScheduleCommandPreview {
  id: string;
  command: string;
  commands: string[];
  normalizedCommand: string;
  kind: ScheduleCommandKind | null;
  status: ScheduleCommandStatus;
  summary: string;
  actions: ScheduleCommandAction[];
  assumptions: string[];
  candidates: Array<{ taskId: string; title: string }>;
  gaps: ScheduleCommandGap[];
  occurrences: ScheduleCommandOccurrencePreview[];
}

interface ParsedDuration {
  seconds: number;
  index: number;
  length: number;
}

interface ParsedDate {
  date: LocalDate;
  explicit: boolean;
}

interface ParsedClock {
  time: string;
  index: number;
  assumption?: string;
}

interface ParsedTimeRange {
  start: ParsedClock | null;
  end: ParsedClock | null;
  ambiguous: boolean;
  equalEndpoints: boolean;
}

interface ParsedRecurrence {
  recurrence: ScheduleRecurrence;
  recurrenceDays: number[] | null;
  recurrenceEndDate: LocalDate | null;
  explicit: boolean;
}

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;
const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};
const SLOT_SECONDS = 15 * 60;
const MAX_PREVIEW_DAYS = 14;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function emptyPreview(command: string): ScheduleCommandPreview {
  const normalizedCommand = command.trim().replace(/\s+/g, ' ');
  return {
    id: `command-${stableHash(normalizedCommand.toLowerCase())}`,
    command: normalizedCommand,
    commands: normalizedCommand ? [normalizedCommand] : [],
    normalizedCommand: normalizedCommand.toLowerCase(),
    kind: null,
    status: 'invalid',
    summary: 'I could not understand that schedule command.',
    actions: [],
    assumptions: [],
    candidates: [],
    gaps: [],
    occurrences: [],
  };
}

function localDateParts(value: Date, timeZone: string): { date: LocalDate; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value).map(part => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function dateFromLocalDate(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function localDayOfWeek(value: LocalDate): number {
  return dateFromLocalDate(value).getUTCDay();
}

/** Convert a validated event command into the planner's durable event shape. */
export function scheduleEventActionToCommitment(
  action: ScheduleCommandCreateEventAction,
  options: ScheduleCommandEventCommitmentOptions,
): RecurringCommitmentInput | null {
  const scheduledDate = action.schedule.scheduledDate;
  const startAt = action.schedule.startAt;
  const durationSeconds = action.schedule.durationSeconds;
  const recurrence = action.schedule.recurrence || 'none';
  if (
    !scheduledDate
    || !isLocalDate(scheduledDate)
    || !startAt
    || !Number.isFinite(durationSeconds)
    || !durationSeconds
    || durationSeconds <= 0
    || recurrence === 'monthly'
  ) return null;

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + durationSeconds * 1_000);
  try {
    const localStart = localDateParts(start, options.timeZone);
    const localEnd = localDateParts(end, options.timeZone);
    // scheduledDate is the authoritative local event date. A mismatch means
    // the action was generated for a different timezone and must be rebuilt.
    if (localStart.date !== scheduledDate) return null;

    const daysOfWeek = recurrence === 'daily'
      ? [0, 1, 2, 3, 4, 5, 6]
      : recurrence === 'weekly'
        ? [...new Set(action.schedule.recurrenceDays || [localDayOfWeek(scheduledDate)])]
          .filter(day => Number.isInteger(day) && day >= 0 && day <= 6)
          .sort((left, right) => left - right)
        : [localDayOfWeek(scheduledDate)];
    if (daysOfWeek.length === 0) return null;

    return {
      id: options.id,
      title: action.title,
      kind: action.kind,
      daysOfWeek,
      startTime: localStart.time,
      endTime: localEnd.time,
      startDate: scheduledDate,
      endDate: recurrence === 'none'
        ? scheduledDate
        : action.schedule.recurrenceEndDate || null,
      timeZone: options.timeZone,
      enabled: true,
      color: options.color || null,
      updatedAt: options.updatedAt,
      occurrenceOverrides: {},
    };
  } catch {
    return null;
  }
}

function localDateFromParts(year: number, month: number, day: number): LocalDate | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isLocalDate(value) ? value : null;
}

function parseNaturalDate(text: string, context: ScheduleCommandContext): ParsedDate {
  const nowDate = localDateParts(new Date(context.now), context.timeZone).date;
  // A date after "through" / "until" is a recurrence boundary, not the
  // activity's start date. Parse that tail separately in recurrenceFromText.
  const recurrenceBoundaryIndex = text.search(/\b(?:through|until|ending(?:\s+on)?)\b/i);
  const startDateText = recurrenceBoundaryIndex >= 0
    ? text.slice(0, recurrenceBoundaryIndex)
    : text;
  const isoMatch = startDateText.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const parsed = localDateFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (parsed) return { date: parsed, explicit: true };
  }

  const slashMatch = startDateText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const currentYear = Number(nowDate.slice(0, 4));
    const rawYear = slashMatch[3] ? Number(slashMatch[3]) : currentYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const parsed = localDateFromParts(year, Number(slashMatch[1]), Number(slashMatch[2]));
    if (parsed) return { date: parsed, explicit: true };
  }

  const monthPattern = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
  const monthMatch = startDateText.match(monthPattern);
  if (monthMatch) {
    const parsed = localDateFromParts(
      Number(monthMatch[3] || nowDate.slice(0, 4)),
      MONTHS[monthMatch[1].toLowerCase()],
      Number(monthMatch[2]),
    );
    if (parsed) return { date: parsed, explicit: true };
  }

  if (/\bday\s+after\s+tomorrow\b/i.test(startDateText)) return { date: addLocalDays(nowDate, 2), explicit: true };
  if (/\btomorrow\b/i.test(startDateText)) return { date: addLocalDays(nowDate, 1), explicit: true };
  if (/\b(?:today|tonight)\b/i.test(startDateText)) return { date: nowDate, explicit: true };

  const repeatedNext = startDateText.match(/\b((?:next\s+)+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (repeatedNext) {
    const nextCount = repeatedNext[1].trim().split(/\s+/).length;
    const targetDay = DAY_NAMES.indexOf(repeatedNext[2].toLowerCase() as typeof DAY_NAMES[number]);
    let difference = (targetDay - localDayOfWeek(nowDate) + 7) % 7;
    if (difference === 0) difference = 7;
    return { date: addLocalDays(nowDate, difference + (nextCount - 1) * 7), explicit: true };
  }

  for (let day = 0; day < DAY_NAMES.length; day += 1) {
    const full = DAY_NAMES[day];
    const abbreviation = full.slice(0, 3);
    // Bare three-letter abbreviations are too ambiguous (notably the SAT
    // exam versus Saturday). Accept a full weekday anywhere, or a shorthand
    // only in explicit date language such as "on Sat" / "this Sat".
    const pattern = new RegExp(`\\b${full}\\b|\\b(?:on|this)\\s+${abbreviation}\\b`, 'i');
    if (!pattern.test(startDateText)) continue;
    const difference = (day - localDayOfWeek(nowDate) + 7) % 7;
    return { date: addLocalDays(nowDate, difference), explicit: true };
  }

  if (context.selectedDate && isLocalDate(context.selectedDate)) {
    return { date: context.selectedDate, explicit: false };
  }
  return { date: nowDate, explicit: false };
}

function parseDuration(text: string): ParsedDuration | null {
  const combined = /\b(\d{1,2})\s*h(?:ours?)?\s*(?:(\d{1,2})\s*m(?:in(?:ute)?s?)?)?\b/i.exec(text);
  if (combined?.index !== undefined) {
    const seconds = Number(combined[1]) * 3600 + Number(combined[2] || 0) * 60;
    return { seconds, index: combined.index, length: combined[0].length };
  }
  const hours = /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr)\b/i.exec(text);
  if (hours?.index !== undefined) {
    return { seconds: Math.round(Number(hours[1]) * 3600), index: hours.index, length: hours[0].length };
  }
  const minutes = /\b(?:for\s+)?(\d{1,4})\s*(?:minutes?|mins?|min)\b/i.exec(text);
  if (minutes?.index !== undefined) {
    return { seconds: Number(minutes[1]) * 60, index: minutes.index, length: minutes[0].length };
  }
  return null;
}

function normalizedDuration(duration: ParsedDuration | null, assumptions: string[]): number | null {
  if (!duration || !Number.isFinite(duration.seconds) || duration.seconds <= 0) return null;
  const clamped = clamp(duration.seconds, SLOT_SECONDS, 24 * 3600);
  const rounded = Math.ceil(clamped / SLOT_SECONDS) * SLOT_SECONDS;
  if (rounded !== duration.seconds) assumptions.push('Rounded the duration up to the 15-minute calendar grid.');
  return rounded;
}

function clockValue(
  hourValue: string,
  minuteValue: string | undefined,
  periodValue: string | undefined,
  assumedPeriod?: 'am' | 'pm',
): { time: string; assumption?: string } | null {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59 || hour > 23) return null;
  const explicitPeriod = periodValue?.toLowerCase();
  const period = explicitPeriod || assumedPeriod;
  let assumption: string | undefined;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
    if (!explicitPeriod) {
      assumption = `Interpreted ${hourValue}${minuteValue ? `:${minuteValue}` : ''} as ${period.toUpperCase()}.`;
    }
  } else if (hour >= 1 && hour <= 12) {
    // A bare 8 must not silently mean 8 AM while a bare 7 means 7 PM. The
    // caller can supply a daypart or ask the user for AM/PM.
    return null;
  }
  return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, assumption };
}

function parseTimeRange(text: string): ParsedTimeRange {
  const daypart: 'am' | 'pm' | undefined = /\b(?:tonight|evening)\b/i.test(text)
    ? 'pm'
    : /\b(?:morning)\b/i.test(text)
      ? 'am'
      : undefined;
  const rangePattern = /\b(from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(-|–|—|to|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/gi;
  const range = [...text.matchAll(rangePattern)].find(candidate => {
    const separator = candidate[5].toLowerCase();
    const prefix = text.slice(Math.max(0, (candidate.index || 0) - 24), candidate.index || 0);
    const suffix = text.slice((candidate.index || 0) + candidate[0].length, (candidate.index || 0) + candidate[0].length + 16);
    const nearbyDayOrTimeLanguage = /\b(?:today|tonight|tomorrow|morning|evening|between|at)\s*$/i.test(prefix);
    const nearbyDaypart = /^\s*(?:tonight|morning|evening)\b/i.test(suffix);
    // A hyphenated title such as "1-4 Problem Set" is not a clock range.
    // Dashes need a clock signal; "to" and "until" are themselves signals.
    return Boolean(
      candidate[1]
      || candidate[3]
      || candidate[4]
      || candidate[7]
      || candidate[8]
      || separator === 'to'
      || separator === 'until'
      || nearbyDaypart
      || nearbyDayOrTimeLanguage
    );
  });
  if (range?.index !== undefined) {
    const candidatePeriods = (
      hourValue: string,
      minuteValue: string | undefined,
      explicitPeriod: string | undefined,
      role: 'start' | 'end',
    ) => {
      if (explicitPeriod) return [clockValue(hourValue, minuteValue, explicitPeriod)].filter(Boolean);
      const hour = Number(hourValue);
      if (hour === 0 || hour > 12) return [clockValue(hourValue, minuteValue, undefined)].filter(Boolean);
      // A daypart anchors the start. Keep both possibilities for an inferred
      // end so "11 to 1 tonight" can correctly cross midnight.
      if (daypart && role === 'start') {
        return [clockValue(hourValue, minuteValue, undefined, daypart)].filter(Boolean);
      }
      return [
        clockValue(hourValue, minuteValue, undefined, 'am'),
        clockValue(hourValue, minuteValue, undefined, 'pm'),
      ].filter(Boolean);
    };
    const startHour = range[2];
    const startMinute = range[3];
    const startPeriod = range[4];
    const endHour = range[6];
    const endMinute = range[7];
    const endPeriod = range[8];
    const sameWrittenClock = Number(startHour) === Number(endHour)
      && Number(startMinute || 0) === Number(endMinute || 0);
    const explicitlyDifferentPeriods = Boolean(
      startPeriod
      && endPeriod
      && startPeriod.toLowerCase() !== endPeriod.toLowerCase()
    );
    if (sameWrittenClock && !explicitlyDifferentPeriods) {
      return { start: null, end: null, ambiguous: false, equalEndpoints: true };
    }
    const starts = candidatePeriods(startHour, startMinute, startPeriod, 'start');
    const ends = candidatePeriods(endHour, endMinute, endPeriod, 'end');
    const bothBareTwelveHourClocks = !startPeriod && !endPeriod && !daypart
      && Number(startHour) >= 1 && Number(startHour) <= 12
      && Number(endHour) >= 1 && Number(endHour) <= 12;
    if (bothBareTwelveHourClocks) {
      return { start: null, end: null, ambiguous: true, equalEndpoints: false };
    }

    const pairs = starts.flatMap(start => ends.flatMap(end => {
      if (!start || !end) return [];
      const [startHour, startMinute] = start.time.split(':').map(Number);
      const [endHour, endMinute] = end.time.split(':').map(Number);
      const startTotal = startHour * 60 + startMinute;
      const endTotal = endHour * 60 + endMinute;
      const durationMinutes = endTotal > startTotal
        ? endTotal - startTotal
        : endTotal + 24 * 60 - startTotal;
      return durationMinutes > 0 ? [{ start, end, durationMinutes }] : [];
    })).sort((left, right) => left.durationMinutes - right.durationMinutes);
    const selected = pairs[0];
    const usedInference = !startPeriod || !endPeriod;
    if (!selected || (usedInference && selected.durationMinutes > 12 * 60)) {
      return { start: null, end: null, ambiguous: true, equalEndpoints: false };
    }
    return {
      start: { ...selected.start, index: range.index },
      end: { ...selected.end, index: range.index + range[0].length },
      ambiguous: false,
      equalEndpoints: false,
    };
  }

  const single = /\b(?:at|from|starting(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text)
    || /\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/i.exec(text)
    || /\b(\d{1,2})\s*(am|pm)\b/i.exec(text);
  if (!single || single.index === undefined) {
    return { start: null, end: null, ambiguous: false, equalEndpoints: false };
  }
  const period = single.length === 3 && /^(?:am|pm)$/i.test(single[2] || '') ? single[2] : single[3];
  const minute = single.length === 3 && period === single[2] ? undefined : single[2];
  const value = clockValue(single[1], minute, period, daypart);
  return {
    start: value ? { ...value, index: single.index } : null,
    end: null,
    ambiguous: !value && Number(single[1]) >= 1 && Number(single[1]) <= 12,
    equalEndpoints: false,
  };
}

function recurrenceFromText(
  text: string,
  startDate: LocalDate,
  context: ScheduleCommandContext,
): ParsedRecurrence {
  let recurrence: ScheduleRecurrence = 'none';
  let recurrenceDays: number[] | null = null;
  let explicit = false;

  if (/\b(?:every|each)\s+day\b|\bdaily\b|\beveryday\b/i.test(text)) {
    recurrence = 'daily';
    explicit = true;
  } else if (/\b(?:every\s+)?weekdays?\b/i.test(text)) {
    recurrence = 'weekly';
    recurrenceDays = [1, 2, 3, 4, 5];
    explicit = true;
  } else if (/\bweekly\b|\b(?:every|each)\s+week\b/i.test(text)) {
    recurrence = 'weekly';
    explicit = true;
  }

  const namedDays = DAY_NAMES.flatMap((day, index) => {
    const full = new RegExp(`\\b(?:every|each|on)\\s+${day}s?\\b`, 'i');
    const abbreviated = new RegExp(`\\b(?:every|each|on)\\s+${day.slice(0, 3)}\\b`, 'i');
    return full.test(text) || abbreviated.test(text) ? [index] : [];
  });
  if (namedDays.length > 0 && recurrence !== 'daily') {
    recurrence = 'weekly';
    recurrenceDays = [...new Set(namedDays)].sort((left, right) => left - right);
    explicit = true;
  }
  if (recurrence === 'weekly' && !recurrenceDays) recurrenceDays = [localDayOfWeek(startDate)];

  let recurrenceEndDate: LocalDate | null = null;
  const daysDuration = text.match(/\bfor\s+(\d{1,2})\s+days?\b/i);
  if (daysDuration) recurrenceEndDate = addLocalDays(startDate, clamp(Number(daysDuration[1]), 1, 365) - 1);
  else if (/\bfor\s+(?:a|one|1)\s+week\b|\bfor\s+the\s+week\b/i.test(text)) {
    recurrenceEndDate = addLocalDays(startDate, 6);
  } else {
    const boundary = text.match(/\b(?:through|until|ending(?:\s+on)?)\s+(.+)$/i);
    if (boundary) {
      // Resolve relative boundaries from the first occurrence, not from the
      // current day. For example, a plan beginning next Monday "through
      // Friday" means that week's Friday.
      const boundaryNow = localDateTimeToIso(startDate, '12:00:00', context.timeZone);
      const parsedBoundary = parseNaturalDate(boundary[1], {
        ...context,
        now: boundaryNow || context.now,
        selectedDate: null,
      });
      if (parsedBoundary.explicit) {
        recurrenceEndDate = parsedBoundary.date;
        const boundaryHasExplicitYear = /\b\d{4}\b|\/\d{2,4}\b/.test(boundary[1]);
        if (recurrenceEndDate < startDate && !boundaryHasExplicitYear) {
          const nextYear = Number(recurrenceEndDate.slice(0, 4)) + 1;
          recurrenceEndDate = localDateFromParts(
            nextYear,
            Number(recurrenceEndDate.slice(5, 7)),
            Number(recurrenceEndDate.slice(8, 10)),
          );
        }
      }
    }
  }

  return { recurrence, recurrenceDays, recurrenceEndDate, explicit };
}

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:the|a|an|my|task|assignment|event)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(value: string): string {
  return value.split(/\s+/).filter(Boolean).map(word => {
    if (/^(?:sat|act|psat|ap|ib|lsat|mcat)$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function stripTrailingScheduleDetails(value: string): string {
  return value
    .replace(/\s+\b(?:every|each|daily|weekly|weekdays?)\b[\s\S]*$/i, '')
    .replace(/\s+\b(?:through|until|ending(?:\s+on)?)\b[\s\S]*$/i, '')
    .replace(/\s+\b(?:day\s+after\s+tomorrow|today|tonight|tomorrow)\b[\s\S]*$/i, '')
    .replace(/\s+\b(?:(?:next\s+)+|this\s+|on\s+)(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b[\s\S]*$/i, '')
    .replace(/\s+\b(?:on\s+)?(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b[\s\S]*$/i, '')
    .replace(new RegExp(`\\s+\\b(?:on\\s+)?(?:${Object.keys(MONTHS).join('|')})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b[\\s\\S]*$`, 'i'), '')
    .replace(/\s+\b(?:at|from|starting(?:\s+at)?|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b[\s\S]*$/i, '')
    .trim();
}

interface RequestedNewCalendarEntity {
  type: 'task' | 'event';
  kind: CommitmentKind | null;
}

/**
 * Infer only explicit event nouns. Generic scheduled work remains a task so a
 * title containing ordinary activity prose cannot silently lose completion
 * and deadline behavior.
 */
function requestedNewCalendarEntity(command: string): RequestedNewCalendarEntity {
  const actionable = withoutConversationalCommandPrefix(command);
  const mutation = actionable.match(
    /^(?:add|schedule|create|put|plan|include|fit\s+in)\s+(?:me\s+)?(?:a\s+|an\s+)?([\s\S]+)$/i,
  );
  if (!mutation) return { type: 'task', kind: null };
  const target = mutation[1];

  // Explicit task language wins even when its title mentions an event, e.g.
  // "create a task to prepare for the game".
  if (/\b(?:task|assignment|homework|to[ -]?do)\b/i.test(target)) {
    return { type: 'task', kind: null };
  }
  const eventKind: CommitmentKind | null = /\b(?:meeting|appointment)\b/i.test(target)
    ? 'appointment'
    : /\bgame\b/i.test(target)
      ? 'sports'
      : /\bclass\b/i.test(target)
        ? 'class'
        : null;
  if (/^(?:calendar\s+)?event\b/i.test(target) || eventKind) {
    return { type: 'event', kind: eventKind || 'other' };
  }
  return { type: 'task', kind: null };
}

function activityTitle(text: string, duration: ParsedDuration | null): string {
  const actionPattern = /\b(?:study(?:\s+for)?|practice|review|read|exercise|train|work\s+on|prepare\s+for|meditate|write|code)\b/gi;
  const actionMatches = [...text.matchAll(actionPattern)];
  const actionMatch = actionMatches[actionMatches.length - 1];
  const durationComesAfterAction = actionMatch?.index !== undefined
    && (duration?.index === undefined || duration.index > actionMatch.index);
  const cutoff = durationComesAfterAction ? duration?.index ?? text.length : text.length;
  let value = actionMatch?.index !== undefined
    ? text.slice(actionMatch.index, cutoff)
    : text.slice(0, duration?.index ?? text.length);
  value = stripTrailingScheduleDetails(value
    .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:add|schedule|create|put|plan|include|fit\s+in)\s+/i, '')
    .replace(/^(?:me\s+)?(?:a\s+|an\s+)?(?:task|event|block)\s+(?:called\s+|named\s+|to\s+)?/i, '')
    .replace(/^(?:me\s+)?(?:a\s+)?(?:week\s+)?(?:where\s+)?(?:i|it)\s+(?:can\s+|will\s+|has\s+)?/i, '')
    .replace(/\bfor\s*$/i, '')
    .replace(/[,:-]+$/g, '')
    .trim());

  const study = value.match(/^study\s+for\s+(.+)$/i) || value.match(/^study\s+(.+)$/i);
  if (study) return `${titleCase(study[1].replace(/^(?:the|my)\s+/i, '').trim())} Study`;
  const prepare = value.match(/^prepare\s+for\s+(.+)$/i);
  if (prepare) return `${titleCase(prepare[1].replace(/^(?:the|my)\s+/i, '').trim())} Preparation`;
  return titleCase(value) || 'Scheduled activity';
}

function resolveTask(
  text: string,
  context: ScheduleCommandContext,
): { task: Task | null; candidates: Task[] } {
  const pronoun = /\b(?:it|this|that|selected task)\b/i.test(text);
  if (pronoun && context.selectedTaskId) {
    const selected = context.tasks.find(task => task.id === context.selectedTaskId) || null;
    if (selected) return { task: selected, candidates: [selected] };
  }
  const normalizedText = normalizeWords(text);
  const included = context.tasks.filter(task => {
    const title = normalizeWords(task.title);
    return title.length >= 2 && normalizedText.includes(title);
  }).sort((left, right) => normalizeWords(right.title).length - normalizeWords(left.title).length);
  if (included.length > 0) {
    const bestLength = normalizeWords(included[0].title).length;
    const best = included.filter(task => normalizeWords(task.title).length === bestLength);
    const selected = context.selectedTaskId
      ? best.find(task => task.id === context.selectedTaskId)
      : null;
    if (selected) return { task: selected, candidates: best };
    return { task: best.length === 1 ? best[0] : null, candidates: best };
  }

  const commandTokens = new Set(normalizedText.split(' ').filter(token => token.length > 1));
  const scored = context.tasks.map(task => {
    const tokens = normalizeWords(task.title).split(' ').filter(Boolean);
    const matches = tokens.filter(token => commandTokens.has(token)).length;
    return { task, score: tokens.length ? matches / tokens.length : 0 };
  }).filter(item => item.score >= 0.6).sort((left, right) => right.score - left.score || left.task.title.localeCompare(right.task.title));
  if (!scored.length) return { task: null, candidates: [] };
  const best = scored.filter(item => item.score === scored[0].score).map(item => item.task);
  const selected = context.selectedTaskId
    ? best.find(task => task.id === context.selectedTaskId)
    : null;
  if (selected) return { task: selected, candidates: best };
  return { task: best.length === 1 ? best[0] : null, candidates: best };
}

function entryForTask(context: ScheduleCommandContext, taskId: string): ScheduleEntry | null {
  return context.entries.find(entry => entry.taskId === taskId) || null;
}

function localTimeFromIso(value: string | null | undefined, context: ScheduleCommandContext): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return localDateParts(parsed, context.timeZone).time;
}

function occurrencePreviews(
  title: string,
  taskId: string | null,
  schedule: ScheduleEntryInput,
  context: ScheduleCommandContext,
): ScheduleCommandOccurrencePreview[] {
  const startDate = schedule.scheduledDate;
  if (!startDate || !isLocalDate(startDate)) return [];
  const recurrence = schedule.recurrence || 'none';
  const endDate = schedule.recurrenceEndDate && isLocalDate(schedule.recurrenceEndDate)
    ? schedule.recurrenceEndDate
    : recurrence === 'none' ? startDate : addLocalDays(startDate, 6);
  const results: ScheduleCommandOccurrencePreview[] = [];
  const recurrenceDays = schedule.recurrenceDays || [];
  for (let index = 0, date = startDate; date <= endDate && index < MAX_PREVIEW_DAYS; index += 1, date = addLocalDays(date, 1)) {
    const occurs = recurrence === 'daily'
      || recurrence === 'none' && date === startDate
      || recurrence === 'weekly' && (recurrenceDays.length ? recurrenceDays.includes(localDayOfWeek(date)) : localDayOfWeek(date) === localDayOfWeek(startDate))
      || recurrence === 'monthly' && date.slice(8) === startDate.slice(8);
    if (!occurs) continue;
    const baseTime = localTimeFromIso(schedule.startAt, context);
    const startAt = baseTime
      ? localDateTimeToIso(date, `${baseTime}:00`, context.timeZone)
      : null;
    results.push({ taskId, title, date, startAt, durationSeconds: schedule.durationSeconds || null });
  }
  return results;
}

function scheduleInput(
  context: ScheduleCommandContext,
  date: LocalDate,
  time: string | null,
  durationSeconds: number | null,
  recurrence: ParsedRecurrence,
): ScheduleEntryInput | null {
  const startAt = time ? localDateTimeToIso(date, `${time}:00`, context.timeZone) : null;
  if (time && !startAt) return null;
  return {
    scheduledDate: date,
    startAt,
    durationSeconds,
    recurrence: recurrence.recurrence,
    recurrenceDays: recurrence.recurrenceDays,
    recurrenceEndDate: recurrence.recurrenceEndDate,
  };
}

function explicitOverlapPermission(command: string): boolean {
  return /\b(?:force|anyway|allow\s+(?:the\s+)?overlap|even\s+if\s+(?:it\s+)?overlaps?)\b/i.test(command);
}

function withoutConversationalCommandPrefix(value: string): string {
  return value
    .replace(
      /^\s*(?:(?:please|actually|just)\s+)*(?:(?:can|could|would|will)\s+(?:you|u)\s+|(?:i(?:'d| would)\s+like|i\s+(?:want|need))(?:\s+(?:you|u))?\s+to\s+|go\s+ahead(?:\s+and)?\s+)?(?:(?:please|actually|just)\s+)*/i,
      '',
    )
    .trim();
}

function hasExplicitDirectScheduleIntent(value: string): boolean {
  const actionable = withoutConversationalCommandPrefix(value);
  return /^(?:add|schedule|create|put|plan|include|fit\s+in|move|reschedule|shift|resize|extend|shorten|repeat|delete|remove|unschedule|clear)\b/i.test(actionable)
    || /^(?:study(?:\s+for)?|practice|review|read|exercise|train|work\s+on|prepare\s+for|meditate|write|code)\b/i.test(actionable);
}

/**
 * Split only when the user starts a second explicit calendar operation. This
 * deliberately does not split on a bare "and" followed by activity prose, so
 * titles such as "research and write essay" remain one activity. The original
 * fragments are preserved so dates and AM/PM markers reach the deterministic
 * interpreter without an AI rewrite.
 */
function splitExplicitDirectScheduleOperations(value: string): string[] | null {
  const boundary = /(?:[;\n]+|\b(?:and\s+then|then|also|and)\b)\s*(?=(?:(?:please|actually|just)\s+)*(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:add|schedule|create|put|plan|include|fit\s+in|move|reschedule|shift|resize|extend|shorten|repeat|delete|remove|unschedule|clear)\b)/gi;
  const boundaries = [...value.matchAll(boundary)];
  if (boundaries.length === 0) return null;

  const parts: string[] = [];
  let start = 0;
  for (const match of boundaries) {
    if (match.index === undefined) return null;
    const part = value.slice(start, match.index).replace(/[;\s]+$/g, '').trim();
    if (!part) return null;
    parts.push(part);
    start = match.index + match[0].length;
  }
  const finalPart = value.slice(start).trim();
  if (!finalPart) return null;
  parts.push(finalPart);

  // Every fragment must independently authorize a calendar operation. If any
  // part is ordinary prose, leave the whole message to chat instead.
  return parts.length > 1 && parts.every(hasExplicitDirectScheduleIntent)
    ? parts
    : null;
}

function hasMultipleDirectScheduleOperations(value: string): boolean {
  const actionStarts = [
    ...value.matchAll(/(?:^|[;\n]|\b(?:and\s+then|then|also|and)\b)\s*(?:(?:please|actually|just)\s+)*(?:(?:can|could|would|will)\s+(?:you|u)\s+)?(?:add|schedule|create|put|plan|include|fit\s+in|move|reschedule|shift|resize|extend|shorten|repeat|delete|remove|unschedule|clear)\b/gi),
  ];
  if (actionStarts.length > 1) return true;
  const clockIntents = [
    ...value.matchAll(/\b(?:at|from|starting(?:\s+at)?)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi),
  ];
  if (clockIntents.length > 1) return true;
  const explicitRanges = [
    ...value.matchAll(/\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:-|–|—|to|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi),
  ];
  if (explicitRanges.length > 1) return true;
  const dateAnchors = [
    ...value.matchAll(/\b(?:today|tonight|tomorrow|day\s+after\s+tomorrow|(?:next\s+)+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|\d{4}-\d{1,2}-\d{1,2})\b/gi),
  ];
  return dateAnchors.length > 1 && /(?:;|\n|\band\b|\bthen\b|\balso\b)/i.test(value);
}

interface ScheduleGuardResult {
  blockedSummary: string | null;
  assumption: string | null;
}

/**
 * Check a proposed schedule for collisions and surface deadline misses as
 * information. A due date describes when work was expected, but it never
 * makes the work impossible to schedule after that instant.
 */
function guardSchedulePlacement(
  command: string,
  context: ScheduleCommandContext,
  task: Task | null,
  title: string,
  schedule: ScheduleEntryInput,
): ScheduleGuardResult {
  const proposed = occurrencePreviews(title, task?.id || null, schedule, context);
  let deadlineAssumption: string | null = null;
  if (task) {
    const deadline = plannerTaskDeadline(task, context.timeZone);
    if (deadline) {
      const deadlineMs = new Date(deadline).getTime();
      const deadlineDate = localDateFromIso(deadline, context.timeZone);
      const recurrenceOutlivesDeadline = task.recurrence === 'none' && schedule.recurrence !== 'none'
        && (!schedule.recurrenceEndDate || Boolean(deadlineDate && schedule.recurrenceEndDate > deadlineDate));
      const missesDeadline = recurrenceOutlivesDeadline || proposed.some(item => {
        if (task.recurrence !== 'none') {
          const recurringDueTime = task.due_time
            || localTimeFromIso(task.due_date, context)
            || '23:59';
          const recurringDeadline = localDateTimeToIso(item.date, `${recurringDueTime}:00`, context.timeZone);
          if (!recurringDeadline) return true;
          if (!item.startAt) return false;
          const duration = Math.max(0, item.durationSeconds || 0) * 1000;
          return new Date(item.startAt).getTime() + duration > new Date(recurringDeadline).getTime();
        }
        if (!item.startAt) return Boolean(deadlineDate && item.date > deadlineDate);
        const duration = Math.max(0, item.durationSeconds || 0) * 1000;
        return new Date(item.startAt).getTime() + duration > deadlineMs;
      });
      if (missesDeadline) {
        deadlineAssumption = `This schedule extends past “${task.title}”’s deadline; the due date stays unchanged.`;
      }
    }
  }

  const conflicts = proposed.flatMap(item => {
    if (!item.startAt || !item.durationSeconds) return [];
    const start = new Date(item.startAt).getTime();
    const end = start + item.durationSeconds * 1000;
    if (!Number.isFinite(start) || end <= start) return [];
    const occurrenceConflicts = context.occurrences.flatMap(existing => {
      if (!existing.startAt || !existing.endAt || existing.taskId === task?.id) return [];
      const existingStart = new Date(existing.startAt).getTime();
      const existingEnd = new Date(existing.endAt).getTime();
      return start < existingEnd && end > existingStart ? [existing.title] : [];
    });
    const busyConflicts = (context.busy || []).flatMap(existing => {
      if (existing.taskId && existing.taskId === task?.id) return [];
      const existingStart = new Date(existing.startAt).getTime();
      const existingEnd = new Date(existing.endAt).getTime();
      return start < existingEnd && end > existingStart ? [existing.title] : [];
    });
    return [...occurrenceConflicts, ...busyConflicts];
  });
  const uniqueConflicts = [...new Set(conflicts)];
  if (uniqueConflicts.length > 0 && !explicitOverlapPermission(command)) {
    const sample = uniqueConflicts.slice(0, 2).map(value => `“${value}”`).join(' and ');
    return {
      blockedSummary: `That time overlaps ${sample}. Pick another time, ask for the best available time, or include “force” to allow the overlap.`,
      assumption: null,
    };
  }
  return {
    blockedSummary: null,
    assumption: [
      deadlineAssumption,
      uniqueConflicts.length > 0
        ? `Allowed an overlap with ${uniqueConflicts.slice(0, 2).join(' and ')} because you explicitly said “force”.`
        : null,
    ].filter(Boolean).join(' ') || null,
  };
}

function previewForAdd(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'add';
  const assumptions: string[] = [];
  const date = parseNaturalDate(command, context);
  if (!date.explicit) assumptions.push(`Used ${date.date} because no date was provided.`);
  const durationMatch = parseDuration(command);
  const range = parseTimeRange(command);
  if (range.equalEndpoints) {
    return { ...preview, status: 'clarification', summary: 'The start and end time are the same. Choose a later end time, or give me an explicit duration.' };
  }
  if (range.ambiguous) {
    return { ...preview, status: 'clarification', summary: 'Is that AM or PM? Include the meridiem so I can place it at the correct time.' };
  }
  let durationSeconds = normalizedDuration(durationMatch, assumptions);
  if (!durationSeconds && range.start && range.end) {
    const start = localDateTimeToIso(date.date, `${range.start.time}:00`, context.timeZone);
    const sameDayEnd = localDateTimeToIso(date.date, `${range.end.time}:00`, context.timeZone);
    const end = start && sameDayEnd && new Date(sameDayEnd).getTime() <= new Date(start).getTime()
      ? localDateTimeToIso(addLocalDays(date.date, 1), `${range.end.time}:00`, context.timeZone)
      : sameDayEnd;
    if (start && end) durationSeconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  }
  if (!durationSeconds) {
    return { ...preview, status: 'clarification', summary: 'How long should this activity take? Try “for 45 minutes” or “from 4 pm to 5 pm”.' };
  }
  if (range.start?.assumption) assumptions.push(range.start.assumption);
  const recurrence = recurrenceFromText(command, date.date, context);
  if (recurrence.recurrenceEndDate && recurrence.recurrenceEndDate < date.date) {
    return { ...preview, status: 'clarification', summary: 'The repeat end date must be on or after the first scheduled date.' };
  }
  const title = activityTitle(command, durationMatch);
  const requestedEntity = requestedNewCalendarEntity(command);
  const existing = requestedEntity.type === 'event'
    ? { task: null, candidates: [] as Task[] }
    : resolveTask(command, context);
  if (!existing.task && existing.candidates.length > 1) {
    return {
      ...preview,
      status: 'clarification',
      summary: 'Which task did you mean?',
      candidates: existing.candidates.map(task => ({ taskId: task.id, title: task.title })),
    };
  }
  const schedule = scheduleInput(context, date.date, range.start?.time || null, durationSeconds, recurrence);
  if (!schedule) return { ...preview, summary: 'That local date or time does not exist in your timezone.' };
  const task = existing.task;
  const guard = guardSchedulePlacement(command, context, task, task?.title || title, schedule);
  if (guard.blockedSummary) {
    return { ...preview, status: 'clarification', summary: guard.blockedSummary, assumptions };
  }
  if (guard.assumption) assumptions.push(guard.assumption);
  preview.status = 'ready';
  preview.assumptions = assumptions;
  preview.summary = task
    ? `${range.start ? 'Schedule' : 'Add duration for'} “${task.title}”${recurrence.explicit ? ' with the requested repeat rule' : ''}.`
    : `Create ${requestedEntity.type === 'event' ? 'event' : 'task'} “${title}” and ${range.start ? 'schedule it' : 'save its duration'}${recurrence.explicit ? ' with the requested repeat rule' : ''}.`;
  preview.actions = task
    ? [{ type: 'schedule_batch', operations: [{ type: 'upsert', taskId: task.id, input: schedule }] }]
    : requestedEntity.type === 'event'
      ? [{
          type: 'create_event',
          title,
          description: null,
          kind: requestedEntity.kind || 'other',
          schedule,
        }]
      : [{ type: 'create_task', title, description: null, schedule }];
  preview.occurrences = occurrencePreviews(task?.title || title, task?.id || null, schedule, context);
  return preview;
}

function relativeMinutes(text: string): number | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\s+(later|earlier)\b/i);
  if (!match) return null;
  const minutes = /^h/i.test(match[2]) ? Number(match[1]) * 60 : Number(match[1]);
  return Math.round(minutes) * (match[3].toLowerCase() === 'earlier' ? -1 : 1);
}

function previewForMove(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'move';
  const resolved = resolveTask(command, context);
  if (!resolved.task) {
    return {
      ...preview,
      status: 'clarification',
      summary: resolved.candidates.length ? 'Which task should I move?' : 'I could not find that task in your schedule.',
      candidates: resolved.candidates.map(task => ({ taskId: task.id, title: task.title })),
    };
  }
  const task = resolved.task;
  const entry = entryForTask(context, task.id);
  if (!entry) return { ...preview, status: 'clarification', summary: `“${task.title}” has no saved schedule yet. Include a date, time, and duration.` };
  const date = parseNaturalDate(command, context);
  const range = parseTimeRange(command);
  if (range.ambiguous) return { ...preview, status: 'clarification', summary: 'Is that AM or PM?' };
  const duration = normalizedDuration(parseDuration(command), preview.assumptions);
  let targetDate = date.explicit ? date.date : entry.scheduledDate;
  let targetTime = range.start?.time || localTimeFromIso(entry.startAt, context);
  const relative = relativeMinutes(command);
  if (relative !== null && entry.startAt) {
    const moved = new Date(new Date(entry.startAt).getTime() + relative * 60_000);
    const parts = localDateParts(moved, context.timeZone);
    targetDate = parts.date;
    targetTime = parts.time;
  }
  if (!targetDate) return { ...preview, status: 'clarification', summary: 'What date should I move it to?' };
  if (!targetTime) return { ...preview, status: 'clarification', summary: 'What time should I move it to?' };
  const startAt = localDateTimeToIso(targetDate, `${targetTime}:00`, context.timeZone);
  if (!startAt) return { ...preview, summary: 'That local date or time does not exist in your timezone.' };
  const placement: ScheduleEntryInput = {
    scheduledDate: targetDate,
    startAt,
    durationSeconds: duration || entry.durationSeconds,
    recurrence: 'none',
    recurrenceDays: null,
    recurrenceEndDate: null,
  };
  const guard = guardSchedulePlacement(command, context, task, task.title, placement);
  if (guard.blockedSummary) return { ...preview, status: 'clarification', summary: guard.blockedSummary };
  if (guard.assumption) preview.assumptions.push(guard.assumption);
  const occurrenceDate = date.explicit && entry.recurrence !== 'none' ? date.date : null;
  const operations: ScheduleBatchOperation[] = occurrenceDate
    ? [{ type: 'override', taskId: task.id, occurrenceDate, override: { scheduledDate: targetDate, startAt, ...(duration ? { durationSeconds: duration } : {}) } }]
    : [{ type: 'upsert', taskId: task.id, input: { ...entry, scheduledDate: targetDate, startAt, ...(duration ? { durationSeconds: duration } : {}) } }];
  preview.status = 'ready';
  preview.summary = `Move “${task.title}” to ${targetDate} at ${targetTime}${occurrenceDate ? ' for this occurrence' : ''}.`;
  preview.actions = [{ type: 'schedule_batch', operations }];
  preview.occurrences = [{ taskId: task.id, title: task.title, date: targetDate, startAt, durationSeconds: duration || entry.durationSeconds }];
  return preview;
}

function previewForResize(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'resize';
  const resolved = resolveTask(command, context);
  if (!resolved.task) {
    return {
      ...preview,
      status: 'clarification',
      summary: resolved.candidates.length ? 'Which task should change duration?' : 'I could not find that scheduled task.',
      candidates: resolved.candidates.map(task => ({ taskId: task.id, title: task.title })),
    };
  }
  const task = resolved.task;
  const entry = entryForTask(context, task.id);
  const duration = normalizedDuration(parseDuration(command), preview.assumptions);
  if (!entry) return { ...preview, status: 'clarification', summary: `“${task.title}” has no saved schedule yet.` };
  if (!duration) return { ...preview, status: 'clarification', summary: 'What should the new duration be?' };
  const date = parseNaturalDate(command, context);
  const occurrenceDate = date.explicit && entry.recurrence !== 'none' ? date.date : null;
  const affectedOccurrences = context.occurrences.filter(occurrence => (
    occurrence.taskId === task.id
    && (!occurrenceDate || occurrence.recurrenceSourceDate === occurrenceDate)
  ));
  const occurrenceOverride = occurrenceDate ? entry.occurrenceOverrides[occurrenceDate] || {} : {};
  const fallbackDate = occurrenceDate
    ? isLocalDate(occurrenceOverride.scheduledDate) ? occurrenceOverride.scheduledDate : occurrenceDate
    : entry.scheduledDate;
  const fallbackTime = localTimeFromIso(entry.startAt, context);
  const fallbackStartAt = Object.prototype.hasOwnProperty.call(occurrenceOverride, 'startAt')
    ? occurrenceOverride.startAt || null
    : fallbackDate && fallbackTime
      ? localDateTimeToIso(fallbackDate, `${fallbackTime}:00`, context.timeZone)
      : null;
  const resizedOccurrences: ScheduleCommandOccurrencePreview[] = affectedOccurrences.length > 0
    ? affectedOccurrences.map(occurrence => {
      const persistedOverride = entry.occurrenceOverrides[occurrence.recurrenceSourceDate] || {};
      const preservesOverrideDuration = !occurrenceDate
        && Object.prototype.hasOwnProperty.call(persistedOverride, 'durationSeconds');
      return {
        taskId: task.id,
        title: task.title,
        date: occurrence.date,
        startAt: occurrence.startAt,
        durationSeconds: preservesOverrideDuration ? occurrence.durationSeconds : duration,
      };
    })
    : fallbackDate
      ? [{
        taskId: task.id,
        title: task.title,
        date: fallbackDate,
        startAt: fallbackStartAt,
        durationSeconds: duration,
      }]
      : [];
  const anchorOccurrence = resizedOccurrences[0];
  if (anchorOccurrence) {
    const placement: ScheduleEntryInput = occurrenceDate
      ? {
        scheduledDate: anchorOccurrence.date,
        startAt: anchorOccurrence.startAt,
        durationSeconds: duration,
        recurrence: 'none',
        recurrenceDays: null,
        recurrenceEndDate: null,
      }
      : { ...entry, durationSeconds: duration };
    const guard = guardSchedulePlacement(command, context, task, task.title, placement);
    if (guard.blockedSummary) return { ...preview, status: 'clarification', summary: guard.blockedSummary };
    if (guard.assumption) preview.assumptions.push(guard.assumption);
  }
  const operation: ScheduleBatchOperation = occurrenceDate
    ? { type: 'override', taskId: task.id, occurrenceDate, override: { durationSeconds: duration } }
    : { type: 'upsert', taskId: task.id, input: { ...entry, durationSeconds: duration } };
  preview.status = 'ready';
  preview.summary = `Set “${task.title}” to ${formatDuration(duration)}${occurrenceDate ? ' for that occurrence' : ''}.`;
  preview.actions = [{ type: 'schedule_batch', operations: [operation] }];
  preview.occurrences = resizedOccurrences;
  return preview;
}

function previewForRepeat(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'repeat';
  const resolved = resolveTask(command, context);
  if (!resolved.task) {
    return {
      ...preview,
      status: 'clarification',
      summary: resolved.candidates.length ? 'Which task should repeat?' : 'I could not find that task.',
      candidates: resolved.candidates.map(task => ({ taskId: task.id, title: task.title })),
    };
  }
  const task = resolved.task;
  const entry = entryForTask(context, task.id);
  const date = parseNaturalDate(command, context);
  const recurrence = recurrenceFromText(command, date.date, context);
  if (!recurrence.explicit) return { ...preview, status: 'clarification', summary: 'How should it repeat? Try “every day”, “weekdays”, or “every Tuesday”.' };
  if (recurrence.recurrenceEndDate && recurrence.recurrenceEndDate < date.date) {
    return { ...preview, status: 'clarification', summary: 'The repeat end date must be on or after the first scheduled date.' };
  }
  const duration = normalizedDuration(parseDuration(command), preview.assumptions) || entry?.durationSeconds || null;
  const time = parseTimeRange(command).start?.time || localTimeFromIso(entry?.startAt, context);
  const anchorDate = date.explicit ? date.date : entry?.scheduledDate || date.date;
  const schedule = scheduleInput(context, anchorDate, time, duration, recurrence);
  if (!schedule) return { ...preview, summary: 'That repeat date or time is invalid.' };
  const guard = guardSchedulePlacement(command, context, task, task.title, schedule);
  if (guard.blockedSummary) return { ...preview, status: 'clarification', summary: guard.blockedSummary };
  if (guard.assumption) preview.assumptions.push(guard.assumption);
  preview.status = 'ready';
  preview.summary = `Repeat “${task.title}” ${recurrence.recurrence === 'daily' ? 'every day' : 'on the selected weekdays'}${recurrence.recurrenceEndDate ? ` through ${recurrence.recurrenceEndDate}` : ''}.`;
  preview.actions = [{ type: 'schedule_batch', operations: [{ type: 'upsert', taskId: task.id, input: schedule }] }];
  preview.occurrences = occurrencePreviews(task.title, task.id, schedule, context);
  return preview;
}

function previewForDelete(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'delete';
  const resolved = resolveTask(command, context);
  if (!resolved.task) {
    return {
      ...preview,
      status: 'clarification',
      summary: resolved.candidates.length ? 'Which task should I unschedule?' : 'I could not find that scheduled task.',
      candidates: resolved.candidates.map(task => ({ taskId: task.id, title: task.title })),
    };
  }
  const entry = entryForTask(context, resolved.task.id);
  if (!entry) return { ...preview, summary: `“${resolved.task.title}” is not currently scheduled.` };
  const date = parseNaturalDate(command, context);
  const oneOccurrence = date.explicit && entry.recurrence !== 'none' && !/\b(?:all|every|series|entire)\b/i.test(command);
  const operation: ScheduleBatchOperation = oneOccurrence
    ? { type: 'override', taskId: resolved.task.id, occurrenceDate: date.date, override: { skipped: true } }
    : { type: 'remove', taskId: resolved.task.id };
  preview.status = 'ready';
  preview.summary = oneOccurrence
    ? `Unschedule the ${date.date} occurrence of “${resolved.task.title}”. The task remains in Orderly.`
    : `Remove “${resolved.task.title}” from the schedule. The task remains in Orderly.`;
  preview.actions = [{ type: 'schedule_batch', operations: [operation] }];
  return preview;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function timeBoundary(text: string, kind: 'after' | 'before'): string | null {
  const match = new RegExp(`\\b${kind}\\s+(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b`, 'i').exec(text);
  if (!match) return null;
  return clockValue(match[1], match[2], match[3])?.time || null;
}

function gapOptions(
  date: LocalDate,
  durationSeconds: number,
  command: string,
  context: ScheduleCommandContext,
): ScheduleCommandGap[] {
  const after = timeBoundary(command, 'after') || context.availableStartTime || '08:00';
  const before = timeBoundary(command, 'before') || context.availableEndTime || '22:00';
  const rangeStart = localDateTimeToIso(date, `${after}:00`, context.timeZone);
  const rangeEnd = localDateTimeToIso(date, `${before}:00`, context.timeZone);
  if (!rangeStart || !rangeEnd) return [];
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  if (endMs <= startMs) return [];
  const busy = [
    ...context.occurrences.flatMap(occurrence => occurrence.startAt && occurrence.endAt
      ? [{ id: occurrence.id, title: occurrence.title, startAt: occurrence.startAt, endAt: occurrence.endAt }]
      : []),
    ...(context.busy || []),
  ].map(item => ({
    start: new Date(item.startAt).getTime(),
    end: new Date(item.endAt).getTime(),
  })).filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > startMs && item.start < endMs)
    .map(item => ({ start: Math.max(startMs, item.start), end: Math.min(endMs, item.end) }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const item of busy) {
    const previous = merged[merged.length - 1];
    if (previous && item.start <= previous.end) previous.end = Math.max(previous.end, item.end);
    else merged.push({ ...item });
  }
  const durationMs = durationSeconds * 1000;
  const slotMs = SLOT_SECONDS * 1000;
  const results: ScheduleCommandGap[] = [];
  let cursor = Math.ceil(startMs / slotMs) * slotMs;
  for (const item of [...merged, { start: endMs, end: endMs }]) {
    if (cursor + durationMs <= item.start) {
      const gapStart = cursor;
      const gapEnd = cursor + durationMs;
      results.push({
        startAt: new Date(gapStart).toISOString(),
        endAt: new Date(gapEnd).toISOString(),
        date,
        label: `${localDateParts(new Date(gapStart), context.timeZone).time}–${localDateParts(new Date(gapEnd), context.timeZone).time}`,
      });
      if (results.length >= 5) break;
    }
    cursor = Math.ceil(Math.max(cursor, item.end) / slotMs) * slotMs;
  }
  return results;
}

function previewForGap(command: string, context: ScheduleCommandContext): ScheduleCommandPreview {
  const preview = emptyPreview(command);
  preview.kind = 'find_gap';
  const date = parseNaturalDate(command, context);
  const resolved = resolveTask(command, context);
  const entry = resolved.task ? entryForTask(context, resolved.task.id) : null;
  const durationMatch = parseDuration(command);
  const duration = normalizedDuration(durationMatch, preview.assumptions) || entry?.durationSeconds || null;
  if (!duration) return { ...preview, status: 'clarification', summary: 'How long a gap should I find?' };
  const gaps = gapOptions(date.date, duration, command, context);
  if (!gaps.length) return { ...preview, status: 'query', summary: `I could not find a free ${formatDuration(duration)} gap on ${date.date}.` };
  preview.gaps = gaps;
  const first = gaps[0];
  const title = activityTitle(command.replace(/^(?:find|show|what(?:'s| is))\s+(?:me\s+)?(?:the\s+)?(?:best\s+time|a\s+gap|an\s+opening)\s+(?:to|for)?\s*/i, ''), durationMatch);
  const shouldSchedule = /\b(?:schedule|put|add|book|best\s+time\s+for|best\s+time\s+to)\b/i.test(command)
    && title !== 'Scheduled activity';
  if (!shouldSchedule) {
    preview.status = 'query';
    preview.summary = `The earliest ${formatDuration(duration)} opening on ${date.date} is ${first.label}.`;
    return preview;
  }
  const schedule: ScheduleEntryInput = {
    scheduledDate: date.date,
    startAt: first.startAt,
    durationSeconds: duration,
    recurrence: 'none',
    recurrenceDays: null,
    recurrenceEndDate: null,
  };
  const guard = guardSchedulePlacement(command, context, resolved.task, resolved.task?.title || title, schedule);
  if (guard.blockedSummary) return { ...preview, status: 'clarification', summary: guard.blockedSummary, gaps };
  if (guard.assumption) preview.assumptions.push(guard.assumption);
  preview.status = 'ready';
  if (resolved.task) {
    preview.summary = `Schedule “${resolved.task.title}” in the earliest open ${formatDuration(duration)} slot: ${first.label} on ${date.date}.`;
    preview.actions = [{ type: 'schedule_batch', operations: [{ type: 'upsert', taskId: resolved.task.id, input: schedule }] }];
    preview.occurrences = occurrencePreviews(resolved.task.title, resolved.task.id, schedule, context);
  } else {
    preview.summary = `Create “${title}” in the earliest open ${formatDuration(duration)} slot: ${first.label} on ${date.date}.`;
    preview.actions = [{ type: 'create_task', title, description: null, schedule }];
    preview.occurrences = occurrencePreviews(title, null, schedule, context);
  }
  return preview;
}

/**
 * Interpret a deliberately bounded, deterministic calendar command. The same
 * command and schedule context always produce the same preview; no model or
 * network request is involved. Mutations are returned for explicit review.
 */
export function interpretScheduleCommand(
  command: string,
  context: ScheduleCommandContext,
): ScheduleCommandPreview {
  const normalized = command.trim().replace(/\s+/g, ' ');
  if (!normalized) return { ...emptyPreview(command), status: 'clarification', summary: 'Type a schedule command first.' };
  const actionable = withoutConversationalCommandPrefix(normalized);
  if (/\b(?:best\s+time|find\s+(?:me\s+)?(?:a\s+)?(?:gap|opening)|free\s+(?:time|slot)|when\s+(?:can|should)\s+i)\b/i.test(actionable)) {
    return previewForGap(normalized, context);
  }
  if (/^\s*(?:delete|remove|unschedule|clear)\b/i.test(actionable)) return previewForDelete(normalized, context);
  if (/^\s*(?:move|reschedule|shift)\b/i.test(actionable)) return previewForMove(normalized, context);
  if (/^\s*(?:resize|extend|shorten)\b|\bchange\s+(?:the\s+)?duration\b/i.test(actionable)) return previewForResize(normalized, context);
  if (/^\s*repeat\b|\bmake\b.+\brepeat\b/i.test(actionable)) return previewForRepeat(normalized, context);
  if (/^\s*(?:add|schedule|create|put|plan|include|fit\s+in)\b/i.test(actionable)
    || (/\b(?:study|practice|review|read|exercise|train|work\s+on|prepare\s+for|meditate|write|code)\b/i.test(actionable)
      && (Boolean(parseDuration(actionable)) || Boolean(parseTimeRange(actionable).end)))) {
    return previewForAdd(normalized, context);
  }
  return {
    ...emptyPreview(normalized),
    status: 'clarification',
    summary: 'Try “schedule chemistry tomorrow at 4 pm for 45 minutes”, “move chemistry to Friday at 5”, “repeat chemistry every weekday”, “unschedule chemistry”, or “find a 30 minute gap tomorrow”.',
  };
}

function isCollectionPlanningRequest(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const action = normalized.match(/^\s*(?:add|schedule|plan|fit\s+in|organize|organise|arrange|spread\s+out|allocate|rebalance|re-?plan|reschedule)\s+(.+)$/i);
  if (!action) return false;
  const target = action[1].trim();

  if (/^(?:them|those|these\s+(?:assignments?|tasks?|items?))\b/i.test(target)) return true;
  if (/^(?:my\s+(?:week|workload|day)|everything)(?:\b|$)/i.test(target)) return true;
  if (/^(?:all|every)(?:\s+of)?\s+(?:my\s+)?(?:pending\s+)?(?:tasks?|assignments?|homework|work|items?)(?:\b|$)/i.test(target)) return true;
  if (/^(?:pending|remaining)\s+(?:tasks?|assignments?|homework|work|items?)(?:\b|$)/i.test(target)) return true;
  if (/^(?:my\s+)?(?:tasks?|assignments?|homework|work)\s+(?:due\s+|for\s+)?(?:today|tomorrow|this\s+week)(?:\b|$)/i.test(target)) return true;
  if (/^(?:today|tomorrow)(?:[’']s)?\s+(?:tasks?|assignments?|homework|work|workload)(?:\b|$)/i.test(target)) return true;

  // "my overdue chemistry assignment" is a named task and must remain in the
  // exact deterministic parser. A generic/bare collection target is broad,
  // including when it carries an unsupported constraint that must not be
  // silently reinterpreted as a single activity.
  return /^(?:(?:all|everything)(?:\s+of)?\s+)?(?:my\s+)?(?:overdue|missing|past[-\s]+due|late)(?:\s+(?:work|homework|tasks?|assignments?|items?))?(?=$|[,.!?]|\s+(?:after|before|only|except|excluding|but|and|plus|prioriti[sz]e|starting|first)\b)/i.test(target);
}

/**
 * Recognize schedule operations that Orderly can answer authoritatively without
 * asking an AI model to reason about dates, clocks, timezones, or collisions.
 * A null result means the message is ordinary conversation or needs AI
 * normalization; a non-null result must be rendered from this preview rather
 * than from model prose.
 */
export function interpretDirectScheduleRequest(
  command: string,
  context: ScheduleCommandContext,
): ScheduleCommandPreview | null {
  const actionable = withoutConversationalCommandPrefix(command);
  // Collection-level planning belongs to the deterministic task allocator,
  // not the single-item command parser. Treating "schedule my overdue" as an
  // add command is what caused the assistant to ask for one activity duration
  // instead of planning the user's actual workload.
  if (isCollectionPlanningRequest(actionable)) {
    return null;
  }
  const gapRequest = /\b(?:best\s+time|find\s+(?:me\s+)?(?:a\s+)?(?:gap|opening)|free\s+(?:time|slot)|when\s+(?:can|should)\s+i)\b/i.test(actionable);
  // Only imperative requests may bypass the model and become mutations.
  // Questions such as "Can I study 4–5?" and "Should I schedule this?"
  // describe possible times; they do not authorize a calendar write.
  if (!gapRequest && !hasExplicitDirectScheduleIntent(command)) return null;
  const explicitOperations = splitExplicitDirectScheduleOperations(command);
  if (explicitOperations) {
    // interpretScheduleCommands is all-or-nothing: an ambiguous, incomplete,
    // invalid, or colliding fragment returns no actions for the entire bundle.
    return interpretScheduleCommands(explicitOperations, context);
  }
  if (hasMultipleDirectScheduleOperations(command)) return null;
  const preview = interpretScheduleCommand(command, context);
  return preview.kind === null ? null : preview;
}

const MAX_COMMAND_BUNDLE_SIZE = 8;

function affectedTaskIds(actions: readonly ScheduleCommandAction[]): string[] {
  return actions.flatMap(action => action.type === 'schedule_batch'
    ? action.operations.map(operation => operation.taskId)
    : []);
}

function occurrenceIsReplacedByActions(
  occurrence: ScheduleOccurrence,
  actions: readonly ScheduleCommandAction[],
): boolean {
  return actions.some(action => action.type === 'schedule_batch' && action.operations.some(operation => {
    if (operation.taskId !== occurrence.taskId) return false;
    if (operation.type === 'upsert' || operation.type === 'remove') return true;
    return operation.occurrenceDate === occurrence.recurrenceSourceDate;
  }));
}

function draftBusyIntervals(
  preview: ScheduleCommandPreview,
  commandIndex: number,
): ScheduleCommandBusyInterval[] {
  return preview.occurrences.flatMap((occurrence, occurrenceIndex) => {
    if (!occurrence.startAt || !occurrence.durationSeconds) return [];
    const start = new Date(occurrence.startAt);
    if (Number.isNaN(start.getTime())) return [];
    return [{
      id: `assistant-bundle-${commandIndex}-${occurrenceIndex}`,
      title: occurrence.title,
      startAt: occurrence.startAt,
      endAt: new Date(start.getTime() + occurrence.durationSeconds * 1_000).toISOString(),
      taskId: occurrence.taskId,
    }];
  });
}

/**
 * Interpret several explicit chat actions as one all-or-nothing calendar
 * draft. Each action is still handled by the deterministic single-command
 * engine. Later actions see earlier draft blocks, so conflicts inside the
 * bundle are caught before anything can be saved.
 */
export function interpretScheduleCommands(
  commands: readonly string[],
  context: ScheduleCommandContext,
): ScheduleCommandPreview {
  const normalized = commands
    .map(command => command.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  if (normalized.length === 0) {
    return {
      ...emptyPreview(''),
      status: 'clarification',
      summary: 'Tell me what you want to add, move, resize, repeat, or remove.',
    };
  }
  if (normalized.length > MAX_COMMAND_BUNDLE_SIZE) {
    const preview = emptyPreview(normalized.join(' | '));
    return {
      ...preview,
      commands: normalized,
      status: 'clarification',
      summary: `That request contains more than ${MAX_COMMAND_BUNDLE_SIZE} calendar changes. Split it into two messages so I can verify every change safely.`,
    };
  }
  if (normalized.length === 1) return interpretScheduleCommand(normalized[0], context);

  const base = emptyPreview(normalized.join(' | '));
  const parts: ScheduleCommandPreview[] = [];
  const touchedTaskIds = new Set<string>();
  let shadowContext: ScheduleCommandContext = {
    ...context,
    occurrences: [...context.occurrences],
    busy: [...(context.busy || [])],
  };

  for (const [index, command] of normalized.entries()) {
    const part = interpretScheduleCommand(command, shadowContext);
    if (part.status !== 'ready' || part.actions.length === 0) {
      return {
        ...base,
        commands: normalized,
        status: part.status === 'invalid' ? 'invalid' : 'clarification',
        summary: `I did not place any of the changes yet because change ${index + 1} needs attention: ${part.summary}`,
        assumptions: parts.flatMap(candidate => candidate.assumptions),
        candidates: part.candidates,
        gaps: part.gaps,
        actions: [],
        occurrences: [],
      };
    }

    const partTaskIds = affectedTaskIds(part.actions);
    const duplicateTaskId = partTaskIds.find(taskId => touchedTaskIds.has(taskId));
    if (duplicateTaskId) {
      const duplicateTask = context.tasks.find(task => task.id === duplicateTaskId);
      return {
        ...base,
        commands: normalized,
        status: 'clarification',
        summary: `I did not place any changes because “${duplicateTask?.title || 'that task'}” is changed more than once in the same request. Combine those edits into one instruction.`,
        actions: [],
        occurrences: [],
      };
    }
    partTaskIds.forEach(taskId => touchedTaskIds.add(taskId));
    parts.push(part);

    // Whole-series changes replace every old occurrence. Occurrence overrides
    // replace only their source occurrence so the rest of a recurring series
    // remains busy while later changes in this draft are checked.
    shadowContext = {
      ...shadowContext,
      occurrences: shadowContext.occurrences.filter(occurrence => (
        !occurrenceIsReplacedByActions(occurrence, part.actions)
      )),
      busy: [
        ...(shadowContext.busy || []),
        ...draftBusyIntervals(part, index),
      ],
    };
  }

  return {
    ...base,
    commands: normalized,
    status: 'ready',
    summary: `${parts.length} calendar changes are ready:\n${parts.map((part, index) => `${index + 1}. ${part.summary}`).join('\n')}`,
    actions: parts.flatMap(part => part.actions),
    assumptions: parts.flatMap(part => part.assumptions),
    candidates: [],
    gaps: parts.flatMap(part => part.gaps),
    occurrences: parts.flatMap(part => part.occurrences),
  };
}
