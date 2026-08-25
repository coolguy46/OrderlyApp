import type { Subject, Task } from '@/lib/supabase/types';

export type LocalDate = string;
export type ScheduleRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface ScheduleOccurrenceOverride {
  scheduledDate?: LocalDate | null;
  startAt?: string | null;
  durationSeconds?: number | null;
  skipped?: boolean;
  updatedAt?: string;
}

export interface ScheduleEntry {
  id: string;
  userId: string;
  taskId: string;
  scheduledDate: LocalDate | null;
  startAt: string | null;
  durationSeconds: number | null;
  recurrence: ScheduleRecurrence;
  recurrenceDays: number[] | null;
  recurrenceEndDate: LocalDate | null;
  occurrenceOverrides: Record<LocalDate, ScheduleOccurrenceOverride>;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleEntryInput {
  scheduledDate?: LocalDate | null;
  startAt?: string | null;
  durationSeconds?: number | null;
  recurrence?: ScheduleRecurrence;
  recurrenceDays?: number[] | null;
  recurrenceEndDate?: LocalDate | null;
}

export interface ScheduleRange {
  startDate: LocalDate;
  endDate: LocalDate;
}

export interface ScheduleOccurrence {
  id: string;
  entryId: string | null;
  taskId: string;
  task: Task;
  title: string;
  description: string | null;
  subjectId: string | null;
  subject: Subject | null;
  color: string | null;
  date: LocalDate;
  recurrenceSourceDate: LocalDate;
  startAt: string | null;
  endAt: string | null;
  durationSeconds: number | null;
  timed: boolean;
  virtual: boolean;
  recurrence: ScheduleRecurrence;
}

export interface ScheduleOccurrenceCollection {
  timed: ScheduleOccurrence[];
  untimed: ScheduleOccurrence[];
}

export type ScheduleOverrideMap = Record<
  string,
  Record<LocalDate, ScheduleOccurrenceOverride>
>;

export interface BuildScheduleOccurrencesInput extends ScheduleRange {
  tasks: readonly Task[];
  entries: readonly ScheduleEntry[];
  subjects?: readonly Subject[];
  /** Optional transient overrides for previews. Persisted overrides live on entries. */
  overrides?: ScheduleOverrideMap;
  timeZone?: string;
}

export type ScheduleBatchOperation =
  | { type: 'upsert'; taskId: string; input: ScheduleEntryInput }
  | { type: 'remove'; taskId: string }
  | {
      type: 'override';
      taskId: string;
      occurrenceDate: LocalDate;
      override: ScheduleOccurrenceOverride;
    }
  | { type: 'clear_override'; taskId: string; occurrenceDate: LocalDate };
