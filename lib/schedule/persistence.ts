import type { Json, Task } from '@/lib/supabase/types';
import type {
  ScheduleEntry,
  ScheduleOccurrenceOverride,
  ScheduleRecurrence,
} from './types';

export interface PendingScheduleMutation {
  revision: number;
  entry: ScheduleEntry | null;
}

function normalizedRecurrence(value: unknown): ScheduleRecurrence {
  return value === 'daily' || value === 'weekly' || value === 'monthly' ? value : 'none';
}

function normalizedDuration(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(86_400, Math.trunc(value))
    : null;
}

function occurrenceOverridesFromJson(value: Json | undefined): Record<string, ScheduleOccurrenceOverride> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, ScheduleOccurrenceOverride> = {};
  for (const [date, raw] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, Json | undefined>;
    const scheduledDate = typeof candidate.scheduledDate === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(candidate.scheduledDate)
      ? candidate.scheduledDate
      : candidate.scheduledDate === null ? null : undefined;
    const startAt = typeof candidate.startAt === 'string'
      && Number.isFinite(new Date(candidate.startAt).getTime())
      ? new Date(candidate.startAt).toISOString()
      : candidate.startAt === null ? null : undefined;
    const durationSeconds = candidate.durationSeconds === null
      ? null
      : normalizedDuration(candidate.durationSeconds) ?? undefined;
    result[date] = {
      ...(scheduledDate !== undefined ? { scheduledDate } : {}),
      ...(startAt !== undefined ? { startAt } : {}),
      ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      ...(typeof candidate.skipped === 'boolean' ? { skipped: candidate.skipped } : {}),
      ...(typeof candidate.updatedAt === 'string' ? { updatedAt: candidate.updatedAt } : {}),
    };
  }
  return result;
}

function occurrenceOverridesToJson(
  overrides: Record<string, ScheduleOccurrenceOverride>,
): Json {
  return Object.fromEntries(Object.entries(overrides).map(([date, override]) => [date, {
    ...(override.scheduledDate !== undefined ? { scheduledDate: override.scheduledDate } : {}),
    ...(override.startAt !== undefined ? { startAt: override.startAt } : {}),
    ...(override.durationSeconds !== undefined ? { durationSeconds: override.durationSeconds } : {}),
    ...(override.skipped !== undefined ? { skipped: override.skipped } : {}),
    ...(override.updatedAt !== undefined ? { updatedAt: override.updatedAt } : {}),
  }])) as Json;
}

/** Convert task-owned database scheduling columns into the local calendar model. */
export function scheduleEntryFromTask(task: Task): ScheduleEntry | null {
  const scheduledDate = task.scheduled_date && /^\d{4}-\d{2}-\d{2}$/.test(task.scheduled_date)
    ? task.scheduled_date
    : null;
  const startAt = scheduledDate && task.scheduled_start_at
    && Number.isFinite(new Date(task.scheduled_start_at).getTime())
    ? new Date(task.scheduled_start_at).toISOString()
    : null;
  const durationSeconds = normalizedDuration(task.duration_seconds);
  const occurrenceOverrides = occurrenceOverridesFromJson(task.schedule_occurrence_overrides);
  if (!scheduledDate && !startAt && !durationSeconds && Object.keys(occurrenceOverrides).length === 0) {
    return null;
  }

  return {
    id: task.id,
    userId: task.user_id,
    taskId: task.id,
    scheduledDate,
    startAt,
    durationSeconds,
    recurrence: normalizedRecurrence(task.recurrence),
    recurrenceDays: Array.isArray(task.recurrence_days)
      ? [...new Set(task.recurrence_days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
        .sort((left, right) => left - right)
      : null,
    recurrenceEndDate: task.schedule_recurrence_end_date
      && /^\d{4}-\d{2}-\d{2}$/.test(task.schedule_recurrence_end_date)
      ? task.schedule_recurrence_end_date
      : null,
    occurrenceOverrides,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

export function scheduleEntriesFromTasks(tasks: readonly Task[], userId: string): ScheduleEntry[] {
  return tasks.flatMap(task => {
    if (task.user_id !== userId) return [];
    const entry = scheduleEntryFromTask(task);
    return entry ? [entry] : [];
  });
}

export type PersistedTaskScheduleUpdate = Pick<
  NonNullable<import('@/lib/supabase/types').Database['public']['Tables']['tasks']['Update']>,
  | 'scheduled_date'
  | 'scheduled_start_at'
  | 'duration_seconds'
  | 'schedule_recurrence_end_date'
  | 'schedule_occurrence_overrides'
> & Partial<Pick<
  import('@/lib/supabase/types').Database['public']['Tables']['tasks']['Update'],
  'recurrence' | 'recurrence_days'
>>;

/** Map a local-first mutation to the task columns used as the server source of truth. */
export function persistedTaskScheduleUpdate(entry: ScheduleEntry | null): PersistedTaskScheduleUpdate {
  if (!entry) {
    return {
      scheduled_date: null,
      scheduled_start_at: null,
      duration_seconds: null,
      schedule_recurrence_end_date: null,
      schedule_occurrence_overrides: {},
    };
  }
  return {
    scheduled_date: entry.scheduledDate,
    scheduled_start_at: entry.startAt,
    duration_seconds: entry.durationSeconds,
    schedule_recurrence_end_date: entry.recurrenceEndDate,
    schedule_occurrence_overrides: occurrenceOverridesToJson(entry.occurrenceOverrides),
    recurrence: entry.recurrence,
    recurrence_days: entry.recurrence === 'weekly' ? entry.recurrenceDays : null,
  };
}

/**
 * Merge an online snapshot without discarding offline edits. Server rows win
 * unless a task still has a persisted local pending mutation.
 */
export function mergeScheduleHydration(
  userId: string,
  serverEntries: readonly ScheduleEntry[],
  localEntries: Readonly<Record<string, ScheduleEntry>>,
  pending: Readonly<Record<string, PendingScheduleMutation>>,
): Record<string, ScheduleEntry> {
  const merged = Object.fromEntries(serverEntries
    .filter(entry => entry.userId === userId && entry.taskId)
    .map(entry => [entry.taskId, entry]));

  for (const [taskId, mutation] of Object.entries(pending)) {
    if (mutation.entry && mutation.entry.userId === userId && mutation.entry.taskId === taskId) {
      merged[taskId] = mutation.entry;
    } else {
      delete merged[taskId];
    }
  }

  // A version-one cache has no pending ledger. It is intentionally not merged:
  // once the server migration is installed, database state is authoritative.
  void localEntries;
  return merged;
}
