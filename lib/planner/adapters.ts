import { addMinutes, format } from 'date-fns';
import type { Exam, Task } from '@/lib/supabase/types';
import type {
  PlannerAssignmentType,
  PlannerExamInput,
  PlannerRequestedActivity,
  PlannerSettings,
  PlannerTaskInput,
  RecurringCommitmentInput,
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
    }];
  });
}

export function readStoredCalendarEvents(): StoredCalendarEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = JSON.parse(localStorage.getItem('calendarEvents') || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
