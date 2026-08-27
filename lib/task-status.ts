import type { Task } from './supabase/types';
import {
  localDateFromIso,
  localDateTimeToIso,
} from './schedule/selectors.ts';

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;

function resolvedTimeZone(timeZone?: string): string {
  const fallback = typeof Intl === 'undefined'
    ? 'UTC'
    : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const candidate = timeZone || fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve a task deadline to the exact instant used for missing/overdue state.
 *
 * Canvas and Classroom deadlines are already authoritative ISO instants and
 * must not be reconstructed from display fields. Manual tasks are rebuilt
 * from their wall-clock date and optional due time so legacy rows that stored
 * midnight still behave correctly. A date-only task is due at the end of day.
 */
export function taskDueAt(task: Task, timeZone?: string): Date | null {
  if (!task.due_date) return null;

  const parsed = new Date(task.due_date);
  if (task.source === 'canvas' || task.source === 'google_classroom') {
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const zone = resolvedTimeZone(timeZone);
  const localDate = /^\d{4}-\d{2}-\d{2}$/.test(task.due_date)
    ? task.due_date
    : localDateFromIso(task.due_date, zone);
  if (!localDate) return Number.isNaN(parsed.getTime()) ? null : parsed;

  const configuredTime = task.due_time && TIME_PATTERN.test(task.due_time)
    ? task.due_time
    : '23:59:59';
  const instant = localDateTimeToIso(
    localDate,
    configuredTime.length === 5 ? `${configuredTime}:00` : configuredTime,
    zone,
  );
  if (instant) return new Date(instant);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A missing task is an unfinished task whose exact deadline has passed. */
export function isTaskMissing(
  task: Task,
  now: Date | number = Date.now(),
  timeZone?: string,
): boolean {
  if (task.status === 'completed') return false;
  const dueAt = taskDueAt(task, timeZone);
  if (!dueAt) return false;
  const nowMs = typeof now === 'number' ? now : now.getTime();
  return dueAt.getTime() < nowMs;
}

/** Calendar-day distance from `now` to the task deadline in the user's zone. */
export function taskDueDayDistance(
  task: Task,
  now: Date | number = Date.now(),
  timeZone?: string,
): number | null {
  const dueAt = taskDueAt(task, timeZone);
  if (!dueAt) return null;
  const nowDate = typeof now === 'number' ? new Date(now) : now;
  const zone = resolvedTimeZone(timeZone);
  const dueDate = localDateFromIso(dueAt.toISOString(), zone);
  const currentDate = localDateFromIso(nowDate.toISOString(), zone);
  if (!dueDate || !currentDate) return null;
  const [dueYear, dueMonth, dueDay] = dueDate.split('-').map(Number);
  const [nowYear, nowMonth, nowDay] = currentDate.split('-').map(Number);
  return Math.round(
    (Date.UTC(dueYear, dueMonth - 1, dueDay) - Date.UTC(nowYear, nowMonth - 1, nowDay))
      / 86_400_000,
  );
}

/**
 * Whether an unfinished task belongs in the Missing view.
 *
 * A task that passed its deadline earlier today is overdue, but it remains in
 * today's workload until the user's local day ends. It becomes "missing" only
 * after its deadline date is before the current local date.
 */
export function isTaskMissingFromPriorDay(
  task: Task,
  now: Date | number = Date.now(),
  timeZone?: string,
): boolean {
  if (task.status === 'completed') return false;
  const dayDistance = taskDueDayDistance(task, now, timeZone);
  return dayDistance !== null && dayDistance < 0;
}
