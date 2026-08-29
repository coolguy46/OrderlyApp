import { addMinutes, format } from 'date-fns';
import type { Exam, Task } from '@/lib/supabase/types';
import type {
  PlannerAssignmentType,
  PlannerExamInput,
  PlannerRequestedActivity,
  PlannerSettings,
  PlannerTaskInput,
  RecurringCommitmentInput,
  CommitmentOccurrenceOverride,
} from './types';
import { PLANNER_PROMPT_TASK_SOURCE } from './types';
import { zonedDateTimeToTimestamp } from './engine';

export interface StoredCalendarEvent {
  id: string;
  title: string;
  description?: string;
  date: string;
  time?: string;
  endTime?: string;
  color?: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'weekdays';
  occurrenceOverrides?: Record<string, CommitmentOccurrenceOverride>;
}

const CALENDAR_EVENTS_STORAGE_PREFIX = 'orderly-calendar-events-v2';
const LEGACY_CALENDAR_EVENTS_STORAGE_KEY = 'calendarEvents';
const LEGACY_CALENDAR_EVENTS_MIGRATION_KEY = `${CALENDAR_EVENTS_STORAGE_PREFIX}:legacy-migration`;
const LEGACY_PLANNER_STORAGE_KEY = 'orderly-planner-storage';

export interface LegacyCalendarEventsMigration {
  version: 1;
  ownerUserId: string;
  status: 'available' | 'imported';
  eventCount: number;
  updatedAt: string;
}

export interface LegacyCalendarEventsRecoveryInfo {
  status: 'available' | 'already-imported' | 'unavailable';
  eventCount: number;
  ownerKnown: boolean;
}

export type LegacyCalendarEventsRecoveryResult =
  | { status: 'recovered'; events: StoredCalendarEvent[]; recoveredCount: number }
  | { status: 'already-imported'; events: StoredCalendarEvent[]; recoveredCount: number }
  | { status: 'unavailable' | 'not-confirmed' | 'failed'; events: StoredCalendarEvent[]; recoveredCount: 0 };

function normalizedStorageUserId(userId: string | null | undefined): string | null {
  const value = userId?.trim();
  return value || null;
}

export function storedCalendarEventsStorageKey(userId: string): string {
  return `${CALENDAR_EVENTS_STORAGE_PREFIX}:${encodeURIComponent(userId)}`;
}

export function legacyCalendarEventsMigrationStorageKey(): string {
  return LEGACY_CALENDAR_EVENTS_MIGRATION_KEY;
}

function parseStoredCalendarEvents(raw: string | null): StoredCalendarEvent[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseLegacyCalendarEventsMigration(raw: string | null): LegacyCalendarEventsMigration | null | 'invalid' {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LegacyCalendarEventsMigration>;
    if (
      parsed.version !== 1
      || typeof parsed.ownerUserId !== 'string'
      || !parsed.ownerUserId.trim()
      || (parsed.status !== 'available' && parsed.status !== 'imported')
      || typeof parsed.eventCount !== 'number'
      || !Number.isInteger(parsed.eventCount)
      || parsed.eventCount < 0
      || typeof parsed.updatedAt !== 'string'
    ) return 'invalid';
    return {
      version: 1,
      ownerUserId: parsed.ownerUserId.trim(),
      status: parsed.status,
      eventCount: parsed.eventCount,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return 'invalid';
  }
}

/**
 * Older authenticated planner builds persisted the active account alongside
 * their browser data. Use that existing owner marker when available; never
 * infer ownership from whichever account happens to be signed in now.
 */
function legacyPlannerOwnerUserId(storage: Storage): string | null {
  try {
    const parsed = JSON.parse(storage.getItem(LEGACY_PLANNER_STORAGE_KEY) || 'null') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const state = record.state && typeof record.state === 'object' && !Array.isArray(record.state)
      ? record.state as Record<string, unknown>
      : record;
    return normalizedStorageUserId(
      typeof state.activeUserId === 'string' ? state.activeUserId : null,
    );
  } catch {
    return null;
  }
}

function containsEveryLegacyEvent(
  scopedEvents: readonly StoredCalendarEvent[],
  legacyEvents: readonly StoredCalendarEvent[],
): boolean {
  const scopedIds = new Set(scopedEvents.map(event => event.id));
  return legacyEvents.every(event => scopedIds.has(event.id));
}

function mergedCalendarEvents(
  scopedEvents: readonly StoredCalendarEvent[],
  legacyEvents: readonly StoredCalendarEvent[],
): StoredCalendarEvent[] {
  const seenIds = new Set<string>();
  return [...scopedEvents, ...legacyEvents].filter(event => {
    if (seenIds.has(event.id)) return false;
    seenIds.add(event.id);
    return true;
  });
}

function restoreStorageValue(storage: Storage, key: string, previousValue: string | null): void {
  if (previousValue === null) storage.removeItem(key);
  else storage.setItem(key, previousValue);
}

/**
 * Return recovery metadata without exposing, copying, or assigning any legacy
 * event. A caller may use this to offer an explicit recovery action, but a
 * passive account visit can never claim the ownerless `calendarEvents` value.
 */
export function getLegacyCalendarEventsRecoveryInfo(
  userId: string | null | undefined,
): LegacyCalendarEventsRecoveryInfo {
  if (typeof window === 'undefined') return { status: 'unavailable', eventCount: 0, ownerKnown: false };
  const ownerUserId = normalizedStorageUserId(userId);
  if (!ownerUserId) return { status: 'unavailable', eventCount: 0, ownerKnown: false };

  try {
    const legacyEvents = parseStoredCalendarEvents(
      window.localStorage.getItem(LEGACY_CALENDAR_EVENTS_STORAGE_KEY),
    );
    if (!legacyEvents?.length) return { status: 'unavailable', eventCount: 0, ownerKnown: false };

    const storedMigration = parseLegacyCalendarEventsMigration(
      window.localStorage.getItem(LEGACY_CALENDAR_EVENTS_MIGRATION_KEY),
    );
    // A corrupt ownership record must fail closed. Guessing here could expose
    // another account's events on a shared browser.
    if (storedMigration === 'invalid') return { status: 'unavailable', eventCount: 0, ownerKnown: true };
    const migration = storedMigration || (() => {
      const legacyOwnerUserId = legacyPlannerOwnerUserId(window.localStorage);
      return legacyOwnerUserId
        ? {
            version: 1 as const,
            ownerUserId: legacyOwnerUserId,
            status: 'available' as const,
            eventCount: legacyEvents.length,
            updatedAt: '',
          }
        : null;
    })();
    // Truly ownerless data cannot safely be attached to whichever account is
    // currently open on a shared browser. Recovery is only offered when an
    // earlier authenticated build recorded a matching owner.
    if (!migration) return { status: 'unavailable', eventCount: 0, ownerKnown: false };
    if (migration.ownerUserId !== ownerUserId) {
      return { status: 'unavailable', eventCount: 0, ownerKnown: true };
    }

    const scopedEvents = parseStoredCalendarEvents(
      window.localStorage.getItem(storedCalendarEventsStorageKey(ownerUserId)),
    ) || [];
    if (
      migration?.status === 'imported'
      && containsEveryLegacyEvent(scopedEvents, legacyEvents)
    ) {
      return { status: 'already-imported', eventCount: legacyEvents.length, ownerKnown: true };
    }

    return {
      status: 'available',
      eventCount: legacyEvents.length,
      ownerKnown: true,
    };
  } catch {
    return { status: 'unavailable', eventCount: 0, ownerKnown: false };
  }
}

/**
 * Explicitly recover pre-account-scoping events for their confirmed owner.
 *
 * The legacy value is deliberately retained as a backup. The scoped copy and
 * owner/status marker are verified before success is reported; if either
 * write fails, both values are restored to their exact previous state.
 */
export function recoverLegacyCalendarEvents(options: {
  userId: string | null | undefined;
  confirmedOwnerUserId: string | null | undefined;
}): LegacyCalendarEventsRecoveryResult {
  const ownerUserId = normalizedStorageUserId(options.userId);
  const confirmedOwnerUserId = normalizedStorageUserId(options.confirmedOwnerUserId);
  if (typeof window === 'undefined' || !ownerUserId) {
    return { status: 'unavailable', events: [], recoveredCount: 0 };
  }

  const currentEvents = readStoredCalendarEvents(ownerUserId);
  if (confirmedOwnerUserId !== ownerUserId) {
    return { status: 'not-confirmed', events: currentEvents, recoveredCount: 0 };
  }

  const storage = window.localStorage;
  const scopedKey = storedCalendarEventsStorageKey(ownerUserId);
  const migrationKey = LEGACY_CALENDAR_EVENTS_MIGRATION_KEY;
  let previousScopedValue: string | null = null;
  let previousMigrationValue: string | null = null;
  let capturedPreviousValues = false;

  try {
    const legacyEvents = parseStoredCalendarEvents(storage.getItem(LEGACY_CALENDAR_EVENTS_STORAGE_KEY));
    if (!legacyEvents?.length) {
      return { status: 'unavailable', events: currentEvents, recoveredCount: 0 };
    }

    previousScopedValue = storage.getItem(scopedKey);
    previousMigrationValue = storage.getItem(migrationKey);
    capturedPreviousValues = true;
    const storedMigration = parseLegacyCalendarEventsMigration(previousMigrationValue);
    const legacyOwnerUserId = storedMigration === null
      ? legacyPlannerOwnerUserId(storage)
      : null;
    if (
      storedMigration === 'invalid'
      || (storedMigration?.ownerUserId || legacyOwnerUserId) !== ownerUserId
    ) {
      return { status: 'unavailable', events: currentEvents, recoveredCount: 0 };
    }
    const migration = storedMigration || {
      version: 1 as const,
      ownerUserId,
      status: 'available' as const,
      eventCount: legacyEvents.length,
      updatedAt: '',
    };

    const scopedEvents = parseStoredCalendarEvents(previousScopedValue) || [];
    if (migration?.status === 'imported' && containsEveryLegacyEvent(scopedEvents, legacyEvents)) {
      return {
        status: 'already-imported',
        events: scopedEvents,
        recoveredCount: legacyEvents.length,
      };
    }

    const nextEvents = mergedCalendarEvents(scopedEvents, legacyEvents);
    const nextScopedValue = JSON.stringify(nextEvents);
    const nextMigrationValue = JSON.stringify({
      version: 1,
      ownerUserId,
      status: 'imported',
      eventCount: legacyEvents.length,
      updatedAt: new Date().toISOString(),
    } satisfies LegacyCalendarEventsMigration);

    storage.setItem(scopedKey, nextScopedValue);
    if (storage.getItem(scopedKey) !== nextScopedValue) throw new Error('Calendar recovery copy verification failed');
    storage.setItem(migrationKey, nextMigrationValue);
    if (storage.getItem(migrationKey) !== nextMigrationValue) throw new Error('Calendar recovery owner verification failed');

    window.dispatchEvent(new CustomEvent('orderly-calendar-events-changed', {
      detail: { userId: ownerUserId },
    }));
    return { status: 'recovered', events: nextEvents, recoveredCount: legacyEvents.length };
  } catch {
    // localStorage has no multi-key transaction. Roll back the scoped copy and
    // marker so a failed import never becomes a partial or silent claim.
    if (capturedPreviousValues) {
      try {
        restoreStorageValue(storage, scopedKey, previousScopedValue);
        restoreStorageValue(storage, migrationKey, previousMigrationValue);
      } catch {
        // The untouched legacy key remains the recovery backup even if the
        // browser refuses a rollback write (for example, storage is disabled).
      }
    }
    return { status: 'failed', events: readStoredCalendarEvents(ownerUserId), recoveredCount: 0 };
  }
}

function validTime(value: string | null | undefined): value is string {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours, minutes] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function defaultEndTime(startTime: string): string {
  const [hours, minutes] = startTime.split(':').map(Number);
  return format(addMinutes(new Date(2000, 0, 1, hours, minutes), 60), 'HH:mm');
}

export interface PlannerTaskExpansionOptions {
  horizonStart?: string | Date;
  horizonDays?: number;
  timeZone?: string;
}

export interface PlannerRequestedActivityExpansionOptions {
  horizonStart: string | Date;
  settings: PlannerSettings;
  preferredEnd?: string;
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

function zonedDateParts(value: Date, timeZone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(value).map(part => [part.type, part.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear().toString().padStart(4, '0')}-${(result.getUTCMonth() + 1).toString().padStart(2, '0')}-${result.getUTCDate().toString().padStart(2, '0')}`;
}

function localDayOfWeek(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function localDayOfMonth(localDate: string): number {
  return Number(localDate.slice(8, 10));
}

function normalizedRecurrenceDays(days: number[] | null | undefined): number[] {
  return [...new Set((days || [])
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
}

function taskAnchorDate(task: Task, timeZone: string): string | null {
  const value = task.due_date || task.created_at;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : zonedDateParts(date, timeZone).date;
}

function recurringDueTime(task: Task, timeZone: string): string {
  if (validTime(task.due_time)) return task.due_time;
  if (task.due_date && task.source && task.source !== 'manual') {
    const stored = new Date(task.due_date);
    if (!Number.isNaN(stored.getTime())) return zonedDateParts(stored, timeZone).time;
  }
  return '23:59';
}

/** Resolve the task's real deadline without losing a separately stored manual time. */
export function plannerTaskDeadline(task: Task, requestedTimeZone?: string): string | null {
  if (!task.due_date) return null;
  const stored = new Date(task.due_date);
  if (Number.isNaN(stored.getTime())) return null;

  // External integrations already store an exact timezone-aware due timestamp.
  if (task.source === 'canvas' || task.source === 'google_classroom') return stored.toISOString();

  const timeZone = safeTimeZone(requestedTimeZone);
  const localDate = zonedDateParts(stored, timeZone).date;
  const time = validTime(task.due_time) ? task.due_time : '23:59';
  return new Date(zonedDateTimeToTimestamp(localDate, time, timeZone)).toISOString();
}

function assignmentType(task: Task): PlannerAssignmentType {
  const value = task.assignment_type;
  return value === 'assignment' || value === 'exam' || value === 'quiz'
    || value === 'discussion' || value === 'project' || value === 'other'
    ? value
    : 'assignment';
}

export function taskToPlannerInput(task: Task, requestedTimeZone?: string): PlannerTaskInput {
  const timeZone = safeTimeZone(requestedTimeZone);
  return {
    id: task.id,
    taskId: task.id,
    occurrenceDate: task.due_date ? taskAnchorDate(task, timeZone) : null,
    title: task.title,
    description: task.description,
    subjectId: task.subject_id,
    courseName: task.course_name,
    priority: task.priority,
    status: task.status,
    dueAt: plannerTaskDeadline(task, timeZone),
    assignmentType: assignmentType(task),
    source: task.source || 'manual',
    externalId: task.external_id,
    updatedAt: task.updated_at,
    recurrence: task.recurrence || 'none',
    recurrenceDays: task.recurrence_days,
  };
}

/**
 * Expand recurring Orderly tasks into stable, distinct due-date occurrences for
 * the local one-week horizon. Every occurrence retains `taskId`, the original
 * database row that the existing completion flow expects.
 */
export function tasksToPlannerInputs(
  tasks: readonly Task[],
  options: PlannerTaskExpansionOptions = {},
): PlannerTaskInput[] {
  const timeZone = safeTimeZone(options.timeZone);
  const requestedStart = options.horizonStart instanceof Date
    ? options.horizonStart
    : new Date(options.horizonStart || Date.now());
  const horizonStart = Number.isNaN(requestedStart.getTime()) ? new Date() : requestedStart;
  const horizonDays = Math.max(1, Math.min(7, Math.trunc(options.horizonDays || 7)));
  const firstLocalDate = zonedDateParts(horizonStart, timeZone).date;
  const endLocalDate = addLocalDays(firstLocalDate, horizonDays);
  const results: PlannerTaskInput[] = [];
  const occurrenceKeys = new Set<string>();

  for (const task of [...tasks].sort((left, right) => left.id.localeCompare(right.id))) {
    const recurrence = task.recurrence || 'none';
    if (recurrence === 'none') {
      if (!occurrenceKeys.has(task.id)) {
        results.push(taskToPlannerInput(task, timeZone));
        occurrenceKeys.add(task.id);
      }
      continue;
    }

    const anchorDate = taskAnchorDate(task, timeZone);
    if (!anchorDate || anchorDate >= endLocalDate) continue;
    const dueTime = recurringDueTime(task, timeZone);
    const configuredDays = normalizedRecurrenceDays(task.recurrence_days);
    const weeklyDays = configuredDays.length > 0
      ? configuredDays
      : [localDayOfWeek(anchorDate)];
    const anchorDayOfMonth = localDayOfMonth(anchorDate);

    for (let offset = 0; offset < horizonDays; offset += 1) {
      const occurrenceDate = addLocalDays(firstLocalDate, offset);
      if (occurrenceDate < anchorDate || occurrenceDate >= endLocalDate) continue;

      const isAnchor = occurrenceDate === anchorDate;
      const occurs = isAnchor
        || recurrence === 'daily'
        || (recurrence === 'weekly' && weeklyDays.includes(localDayOfWeek(occurrenceDate)))
        || (recurrence === 'monthly' && localDayOfMonth(occurrenceDate) === anchorDayOfMonth);
      if (!occurs) continue;

      const occurrenceId = `${task.id}@${occurrenceDate}`;
      if (occurrenceKeys.has(occurrenceId)) continue;
      occurrenceKeys.add(occurrenceId);
      results.push({
        ...taskToPlannerInput(task, timeZone),
        id: occurrenceId,
        taskId: task.id,
        occurrenceDate,
        dueAt: new Date(zonedDateTimeToTimestamp(occurrenceDate, dueTime, timeZone)).toISOString(),
      });
    }
  }

  return results.sort((left, right) =>
    (left.dueAt || '').localeCompare(right.dueAt || '')
    || left.id.localeCompare(right.id)
  );
}

/**
 * Materialize prompt-only activity templates into day-bounded work inputs.
 * `availableFrom` prevents tomorrow's requested work from being pulled into
 * today simply because there is spare capacity.
 */
export function requestedActivitiesToPlannerInputs(
  activities: readonly PlannerRequestedActivity[],
  options: PlannerRequestedActivityExpansionOptions,
): PlannerTaskInput[] {
  const timeZone = safeTimeZone(options.settings.timeZone);
  const requestedStart = options.horizonStart instanceof Date
    ? options.horizonStart
    : new Date(options.horizonStart);
  const horizonStart = Number.isNaN(requestedStart.getTime()) ? new Date() : requestedStart;
  const horizonDays = Math.max(1, Math.min(7, Math.trunc(options.settings.horizonDays || 7)));
  const firstLocalDate = zonedDateParts(horizonStart, timeZone).date;
  const results: PlannerTaskInput[] = [];
  const occurrenceIds = new Set<string>();

  for (const activity of [...activities].sort((left, right) => left.id.localeCompare(right.id))) {
    const startOffset = Math.max(0, Math.min(6, Math.trunc(activity.startOffsetDays || 0)));
    const durationDays = Math.max(1, Math.min(7, Math.trunc(activity.durationDays || 1)));
    const endOffset = Math.min(horizonDays, startOffset + durationDays);
    const configuredDays = normalizedRecurrenceDays(activity.daysOfWeek);
    const fallbackWeeklyDay = localDayOfWeek(addLocalDays(firstLocalDate, startOffset));
    let oncePlaced = false;

    for (let offset = startOffset; offset < endOffset; offset += 1) {
      const occurrenceDate = addLocalDays(firstLocalDate, offset);
      const dayOfWeek = localDayOfWeek(occurrenceDate);
      const occurs = activity.recurrence === 'daily'
        ? configuredDays.length === 0 || configuredDays.includes(dayOfWeek)
        : activity.recurrence === 'weekly'
          ? (configuredDays.length > 0 ? configuredDays.includes(dayOfWeek) : dayOfWeek === fallbackWeeklyDay)
          : !oncePlaced && (configuredDays.length === 0 || configuredDays.includes(dayOfWeek));
      if (!occurs) continue;
      oncePlaced = true;

      const occurrenceId = `${PLANNER_PROMPT_TASK_SOURCE}:${activity.id}@${occurrenceDate}`;
      if (occurrenceIds.has(occurrenceId)) continue;
      occurrenceIds.add(occurrenceId);
      const deadlineTime = validTime(activity.deadlineTime)
        ? activity.deadlineTime
        : validTime(options.preferredEnd)
          ? options.preferredEnd
          : options.settings.schoolDays.includes(dayOfWeek)
            ? options.settings.bedtime
            : options.settings.weekendAvailableEnd;
      const deadlineDate = deadlineTime === '00:00'
        ? addLocalDays(occurrenceDate, 1)
        : occurrenceDate;

      results.push({
        id: occurrenceId,
        taskId: null,
        activityId: activity.id,
        occurrenceDate,
        availableFrom: new Date(zonedDateTimeToTimestamp(occurrenceDate, '00:00', timeZone)).toISOString(),
        title: activity.title,
        description: activity.description,
        subjectId: null,
        courseName: null,
        priority: 'medium',
        status: 'pending',
        dueAt: new Date(zonedDateTimeToTimestamp(deadlineDate, deadlineTime, timeZone)).toISOString(),
        assignmentType: 'other',
        source: PLANNER_PROMPT_TASK_SOURCE,
        externalId: activity.id,
        updatedAt: null,
        estimateMinutes: activity.minutesPerOccurrence,
        recurrence: activity.recurrence === 'once' ? 'none' : activity.recurrence,
        recurrenceDays: configuredDays,
      });
    }
  }

  return results.sort((left, right) =>
    (left.dueAt || '').localeCompare(right.dueAt || '')
    || left.id.localeCompare(right.id)
  );
}

export function examToPlannerInput(exam: Exam): PlannerExamInput {
  return {
    id: exam.id,
    title: exam.title,
    description: exam.description,
    subjectId: exam.subject_id,
    examAt: new Date(exam.exam_date).toISOString(),
    preparationProgress: exam.preparation_progress,
    priority: 'high',
    updatedAt: exam.updated_at,
  };
}

function normalizedExamTitle(value: string): string {
  return value
    .replace(/^\s*\[(?:canvas|classroom)\]\s*/i, '')
    .replace(/^\s*prepare\s+for\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Remove exam rows already represented by the same exact Canvas exam/quiz task. */
export function examsToPlannerInputs(
  exams: readonly Exam[],
  taskInputs: readonly PlannerTaskInput[] = [],
): PlannerExamInput[] {
  const canvasExamTasks = taskInputs.filter(task =>
    task.source === 'canvas'
    && (task.assignmentType === 'exam' || task.assignmentType === 'quiz')
    && task.dueAt
  );

  return exams
    .map(examToPlannerInput)
    .filter(exam => !canvasExamTasks.some(task => {
      const taskDeadline = new Date(task.dueAt || '').getTime();
      const examDeadline = new Date(exam.examAt).getTime();
      if (!Number.isFinite(taskDeadline) || !Number.isFinite(examDeadline)) return false;
      if (Math.abs(taskDeadline - examDeadline) > 60_000) return false;
      if (normalizedExamTitle(task.title) !== normalizedExamTitle(exam.title)) return false;
      return !task.subjectId || !exam.subjectId || task.subjectId === exam.subjectId;
    }))
    .sort((left, right) => left.examAt.localeCompare(right.examAt) || left.id.localeCompare(right.id));
}

export function storedEventsToCommitments(
  events: readonly StoredCalendarEvent[],
  timeZone: string,
): RecurringCommitmentInput[] {
  return events.flatMap(event => {
    if (!event.id || !event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) return [];
    const startTime = validTime(event.time) ? event.time : '09:00';
    const endTime = validTime(event.endTime) && event.endTime !== startTime
      ? event.endTime
      : defaultEndTime(startTime);
    const day = new Date(`${event.date}T12:00:00`).getDay();
    const recurrence = event.recurrence || 'none';
    const daysOfWeek = recurrence === 'daily'
      ? [0, 1, 2, 3, 4, 5, 6]
      : recurrence === 'weekdays'
        ? [1, 2, 3, 4, 5]
        : [day];

    return [{
      id: `calendar-${event.id}`,
      title: event.title,
      kind: 'other' as const,
      daysOfWeek,
      startTime,
      endTime,
      startDate: event.date,
      endDate: recurrence === 'none' ? event.date : null,
      timeZone,
      enabled: true,
      color: event.color || '#0ea5e9',
      updatedAt: null,
      occurrenceOverrides: event.occurrenceOverrides || {},
    }];
  });
}

/**
 * Read browser-only calendar events for one signed-in account.
 *
 * Older Orderly builds used the unowned global `calendarEvents` key. There is
 * no trustworthy way to tell which account created that value, so assigning it
 * to the next account that happens to sign in can expose one student's events
 * to another student on a shared browser. Keep that legacy value untouched for
 * recovery, but never expose it to an account automatically. Account-scoped
 * values are the only values this reader returns.
 */
export function readStoredCalendarEvents(userId: string | null | undefined): StoredCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  const ownerUserId = normalizedStorageUserId(userId);
  if (!ownerUserId) return [];

  try {
    const scopedKey = storedCalendarEventsStorageKey(ownerUserId);
    const scopedEvents = parseStoredCalendarEvents(window.localStorage.getItem(scopedKey));
    if (scopedEvents !== null) return scopedEvents;

    return [];
  } catch {
    return [];
  }
}

export function writeStoredCalendarEvents(
  userId: string | null | undefined,
  events: readonly StoredCalendarEvent[],
): void {
  if (typeof window === 'undefined') return;
  const ownerUserId = normalizedStorageUserId(userId);
  if (!ownerUserId) return;
  window.localStorage.setItem(storedCalendarEventsStorageKey(ownerUserId), JSON.stringify(events));
  window.dispatchEvent(new CustomEvent('orderly-calendar-events-changed', {
    detail: { userId: ownerUserId },
  }));
}
