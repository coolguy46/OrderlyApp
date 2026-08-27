import type { Task } from '@/lib/supabase/types';
import { plannerTaskDeadline } from '@/lib/planner/adapters';
import {
  addLocalDays,
  isLocalDate,
  isMonthlyRecurrenceDate,
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
import {
  findAmbiguousBareTime,
  findScheduleClockRange,
  normalizeScheduleCommandWords,
} from './command-text';

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

export interface ScheduleCommandBatchAction {
  type: 'schedule_batch';
  operations: ScheduleBatchOperation[];
}

export type ScheduleCommandAction = ScheduleCommandCreateTaskAction | ScheduleCommandBatchAction;

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

function localDateFromParts(year: number, month: number, day: number): LocalDate | null {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isLocalDate(value) ? value : null;
}

function parseNaturalDate(text: string, context: ScheduleCommandContext): ParsedDate {
  const nowDate = localDateParts(new Date(context.now), context.timeZone).date;
  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    const parsed = localDateFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    if (parsed) return { date: parsed, explicit: true };
  }

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashMatch) {
    const currentYear = Number(nowDate.slice(0, 4));
    const rawYear = slashMatch[3] ? Number(slashMatch[3]) : currentYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    const parsed = localDateFromParts(year, Number(slashMatch[1]), Number(slashMatch[2]));
    if (parsed) return { date: parsed, explicit: true };
  }

  const monthPattern = new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
  const monthMatch = text.match(monthPattern);
  if (monthMatch) {
    const parsed = localDateFromParts(
      Number(monthMatch[3] || nowDate.slice(0, 4)),
      MONTHS[monthMatch[1].toLowerCase()],
      Number(monthMatch[2]),
    );
    if (parsed) return { date: parsed, explicit: true };
  }

  if (/\bday\s+after\s+tomorrow\b/i.test(text)) return { date: addLocalDays(nowDate, 2), explicit: true };
  if (/\btomorrow\b/i.test(text)) return { date: addLocalDays(nowDate, 1), explicit: true };
  if (/\btoday\b/i.test(text)) return { date: nowDate, explicit: true };

  const repeatedNext = text.match(/\b((?:next\s+)+)(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
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
    if (!pattern.test(text)) continue;
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

function clockValue(hourValue: string, minuteValue: string | undefined, periodValue: string | undefined): { time: string; assumption?: string } | null {
  let hour = Number(hourValue);
  const minute = Number(minuteValue || 0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  const period = periodValue?.toLowerCase();
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'pm' && hour !== 12) hour += 12;
    if (period === 'am' && hour === 12) hour = 0;
  } else if (hour >= 1 && hour <= 12 && !hourValue.startsWith('0')) {
    // Bare 1–12 values have two equally valid meanings. The public command
    // interpreter returns a clarification before reaching this fallback.
    return null;
  }
  return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

function parseTimeRange(text: string): ParsedTimeRange {
  const range = findScheduleClockRange(text);
  if (range) {
    const inheritedStartPeriod = range.startPeriod || range.endPeriod;
    const inheritedEndPeriod = range.endPeriod || range.startPeriod;
    const startValue = clockValue(range.startHour, range.startMinute, inheritedStartPeriod);
    const endValue = clockValue(range.endHour, range.endMinute, inheritedEndPeriod);
    return {
      start: startValue ? { ...startValue, index: range.index } : null,
      end: endValue ? { ...endValue, index: range.index + range.raw.length } : null,
    };
  }

  const single = /\b(?:at|from|starting(?:\s+at)?)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text)
    || /\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/i.exec(text)
    || /\b(\d{1,2})\s*(am|pm)\b/i.exec(text);
  if (!single || single.index === undefined) return { start: null, end: null };
  const period = single.length === 3 && /^(?:am|pm)$/i.test(single[2] || '') ? single[2] : single[3];
  const minute = single.length === 3 && period === single[2] ? undefined : single[2];
  const value = clockValue(single[1], minute, period);
  return { start: value ? { ...value, index: single.index } : null, end: null };
}

function recurrenceFromText(text: string, startDate: LocalDate): ParsedRecurrence {
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
  }

  return { recurrence, recurrenceDays, recurrenceEndDate, explicit };
}

function titleCase(value: string): string {
  return value.split(/\s+/).filter(Boolean).map(word => {
    if (/^(?:sat|act|psat|ap|ib|lsat|mcat)$/i.test(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

function activityTitle(text: string, duration: ParsedDuration | null): string {
  const cutoff = duration?.index ?? text.length;
  const prefix = text.slice(0, cutoff);
  const actionPattern = /\b(?:study(?:\s+for)?|practice|review|read|exercise|train|work\s+on|prepare\s+for|meditate|write|code)\b/gi;
  const actionMatches = [...prefix.matchAll(actionPattern)];
  const actionMatch = actionMatches[actionMatches.length - 1];
  let value = actionMatch?.index !== undefined ? prefix.slice(actionMatch.index) : prefix;
  value = value
    .replace(/^(?:please\s+)?(?:can\s+you\s+)?(?:add|schedule|create|put|plan|include|fit\s+in)\s+/i, '')
    .replace(/^(?:me\s+)?(?:a\s+)?(?:week\s+)?(?:where\s+)?(?:i|it)\s+(?:can\s+|will\s+|has\s+)?/i, '')
    .replace(/\b(?:today|tomorrow|next\s+)+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\b.*$/i, '')
    .replace(/\b(?:every|each|daily|weekly|weekdays?)\b.*$/i, '')
    .replace(/\bfor\s*$/i, '')
    .replace(/[,:-]+$/g, '')
    .trim();

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
  const normalizedText = normalizeScheduleCommandWords(text);
  const included = context.tasks.filter(task => {
    const title = normalizeScheduleCommandWords(task.title);
    return title.length >= 2 && normalizedText.includes(title);
  }).sort((left, right) => normalizeScheduleCommandWords(right.title).length - normalizeScheduleCommandWords(left.title).length);
  if (included.length > 0) {
    const bestLength = normalizeScheduleCommandWords(included[0].title).length;
    const best = included.filter(task => normalizeScheduleCommandWords(task.title).length === bestLength);
    const selected = context.selectedTaskId
      ? best.find(task => task.id === context.selectedTaskId)
      : null;
    if (selected) return { task: selected, candidates: best };
    return { task: best.length === 1 ? best[0] : null, candidates: best };
  }

  const commandTokens = new Set(normalizedText.split(' ').filter(token => token.length > 1));
  const scored = context.tasks.map(task => {
    const tokens = normalizeScheduleCommandWords(task.title).split(' ').filter(Boolean);
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
      || recurrence === 'monthly' && isMonthlyRecurrenceDate(date, startDate);
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

interface ScheduleGuardResult {
  blockedSummary: string | null;
  assumption: string | null;
}

/**
 * Enforce hard deadline and collision invariants on a proposed schedule. New
 * activities have no deadline, while Canvas/manual tasks retain their exact
 * due instant. Untimed work is checked by local date; timed work must finish
 * on or before the deadline.
 */
function guardSchedulePlacement(
  command: string,
  context: ScheduleCommandContext,
  task: Task | null,
  title: string,
  schedule: ScheduleEntryInput,
): ScheduleGuardResult {
  const proposed = occurrencePreviews(title, task?.id || null, schedule, context);
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
        return {
          blockedSummary: `I cannot schedule “${task.title}” there because some or all of the work would finish after its exact deadline. Choose an earlier date or time.`,
          assumption: null,
        };
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
    assumption: uniqueConflicts.length > 0
      ? `Allowed an overlap with ${uniqueConflicts.slice(0, 2).join(' and ')} because you explicitly said “force”.`
      : null,
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
  let durationSeconds = normalizedDuration(durationMatch, assumptions);
  if (!durationSeconds && range.start && range.end) {
    const start = localDateTimeToIso(date.date, `${range.start.time}:00`, context.timeZone);
    const end = localDateTimeToIso(date.date, `${range.end.time}:00`, context.timeZone);
    if (start && end) durationSeconds = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
  }
  if (!durationSeconds) {
    return { ...preview, status: 'clarification', summary: 'How long should this activity take? Try “for 45 minutes” or “from 4 pm to 5 pm”.' };
  }
  if (range.start?.assumption) assumptions.push(range.start.assumption);
  const recurrence = recurrenceFromText(command, date.date);
  const title = activityTitle(command, durationMatch);
  const existing = resolveTask(command, context);
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
    : `Create “${title}” and ${range.start ? 'schedule it' : 'save its duration'}${recurrence.explicit ? ' with the requested repeat rule' : ''}.`;
  preview.actions = task
    ? [{ type: 'schedule_batch', operations: [{ type: 'upsert', taskId: task.id, input: schedule }] }]
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
  const entry = entryForTask(context, resolved.task.id);
  const duration = normalizedDuration(parseDuration(command), preview.assumptions);
  if (!entry) return { ...preview, status: 'clarification', summary: `“${resolved.task.title}” has no saved schedule yet.` };
  if (!duration) return { ...preview, status: 'clarification', summary: 'What should the new duration be?' };
  const date = parseNaturalDate(command, context);
  const anchorDate = date.explicit ? date.date : entry.scheduledDate;
  if (anchorDate) {
    const placement: ScheduleEntryInput = {
      scheduledDate: anchorDate,
      startAt: entry.startAt,
      durationSeconds: duration,
      recurrence: 'none',
      recurrenceDays: null,
      recurrenceEndDate: null,
    };
    const guard = guardSchedulePlacement(command, context, resolved.task, resolved.task.title, placement);
    if (guard.blockedSummary) return { ...preview, status: 'clarification', summary: guard.blockedSummary };
    if (guard.assumption) preview.assumptions.push(guard.assumption);
  }
  const operation: ScheduleBatchOperation = date.explicit && entry.recurrence !== 'none'
    ? { type: 'override', taskId: resolved.task.id, occurrenceDate: date.date, override: { durationSeconds: duration } }
    : { type: 'upsert', taskId: resolved.task.id, input: { ...entry, durationSeconds: duration } };
  preview.status = 'ready';
  preview.summary = `Set “${resolved.task.title}” to ${formatDuration(duration)}${date.explicit && entry.recurrence !== 'none' ? ' for that occurrence' : ''}.`;
  preview.actions = [{ type: 'schedule_batch', operations: [operation] }];
  preview.occurrences = [{ taskId: resolved.task.id, title: resolved.task.title, date: date.date, startAt: null, durationSeconds: duration }];
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
  const recurrence = recurrenceFromText(command, date.date);
  if (!recurrence.explicit) return { ...preview, status: 'clarification', summary: 'How should it repeat? Try “every day”, “weekdays”, or “every Tuesday”.' };
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
  const ambiguousTime = findAmbiguousBareTime(normalized);
  if (ambiguousTime) {
    return {
      ...emptyPreview(normalized),
      status: 'clarification',
      summary: `Is ${ambiguousTime} AM or PM? Add AM/PM, or use an explicit 24-hour time such as 08:00 or 20:00.`,
    };
  }
  if (/\b(?:best\s+time|find\s+(?:me\s+)?(?:a\s+)?(?:gap|opening)|free\s+(?:time|slot)|when\s+(?:can|should)\s+i)\b/i.test(normalized)) {
    return previewForGap(normalized, context);
  }
  if (/^\s*(?:delete|remove|unschedule|clear)\b/i.test(normalized)) return previewForDelete(normalized, context);
  if (/^\s*(?:move|reschedule|shift)\b/i.test(normalized)) return previewForMove(normalized, context);
  if (/^\s*(?:resize|extend|shorten)\b|\bchange\s+(?:the\s+)?duration\b/i.test(normalized)) return previewForResize(normalized, context);
  if (/^\s*repeat\b|\bmake\b.+\brepeat\b/i.test(normalized)) return previewForRepeat(normalized, context);
  if (/^\s*(?:add|schedule|create|put|plan|include|fit\s+in)\b/i.test(normalized)
    || (/\b(?:study|practice|review|read|exercise|train|work\s+on|prepare\s+for|meditate|write|code)\b/i.test(normalized)
      && Boolean(parseDuration(normalized)))) {
    return previewForAdd(normalized, context);
  }
  return {
    ...emptyPreview(normalized),
    status: 'clarification',
    summary: 'Try “schedule chemistry tomorrow at 4 pm for 45 minutes”, “move chemistry to Friday at 5 pm”, “repeat chemistry every weekday”, “unschedule chemistry”, or “find a 30 minute gap tomorrow”.',
  };
}
