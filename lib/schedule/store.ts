'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_SCHEDULE_DURATION_SECONDS, isLocalDate } from './selectors';
import type {
  LocalDate,
  ScheduleBatchOperation,
  ScheduleEntry,
  ScheduleEntryInput,
  ScheduleOccurrenceOverride,
} from './types';

const SCHEDULE_STORE_VERSION = 1;

export interface ScheduleState {
  entriesByUser: Record<string, Record<string, ScheduleEntry>>;
  upsertTaskSchedule: (userId: string, taskId: string, input: ScheduleEntryInput) => ScheduleEntry | null;
  removeTaskSchedule: (userId: string, taskId: string) => void;
  setOccurrenceOverride: (
    userId: string,
    taskId: string,
    occurrenceDate: LocalDate,
    override: ScheduleOccurrenceOverride,
  ) => void;
  clearOccurrenceOverride: (userId: string, taskId: string, occurrenceDate: LocalDate) => void;
  moveOccurrence: (
    userId: string,
    taskId: string,
    occurrenceDate: LocalDate,
    scheduledDate: LocalDate,
    startAt: string | null,
  ) => void;
  resizeOccurrence: (
    userId: string,
    taskId: string,
    occurrenceDate: LocalDate,
    durationSeconds: number | null,
  ) => void;
  applyScheduleBatch: (userId: string, operations: ScheduleBatchOperation[]) => void;
  replaceUserSchedules: (userId: string, entries: ScheduleEntry[]) => void;
  clearTaskSchedules: (userId: string, taskIds?: string[]) => void;
}

function normalizedDays(days: number[] | null | undefined): number[] | null {
  const result = [...new Set((days || []).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((left, right) => left - right);
  return result.length > 0 ? result : null;
}

function normalizedDuration(value: number | null | undefined): number | null {
  if (!Number.isFinite(value) || !value || value <= 0) return null;
  return Math.min(86_400, Math.trunc(value));
}

function normalizedEntryInput(
  input: ScheduleEntryInput,
  previous?: ScheduleEntry,
): Required<ScheduleEntryInput> {
  const scheduledDate = input.scheduledDate === undefined
    ? previous?.scheduledDate || null
    : isLocalDate(input.scheduledDate) ? input.scheduledDate : null;
  const requestedStartAt = input.startAt === undefined ? previous?.startAt || null : input.startAt;
  const startAt = scheduledDate && requestedStartAt && !Number.isNaN(new Date(requestedStartAt).getTime())
    ? new Date(requestedStartAt).toISOString()
    : null;
  const requestedRecurrence = input.recurrence === undefined
    ? previous?.recurrence || 'none'
    : input.recurrence;
  return {
    scheduledDate,
    startAt,
    durationSeconds: input.durationSeconds === undefined
      ? previous?.durationSeconds || null
      : normalizedDuration(input.durationSeconds),
    recurrence: requestedRecurrence === 'daily' || requestedRecurrence === 'weekly' || requestedRecurrence === 'monthly'
      ? requestedRecurrence
      : 'none',
    recurrenceDays: input.recurrenceDays === undefined
      ? previous?.recurrenceDays || null
      : normalizedDays(input.recurrenceDays),
    recurrenceEndDate: input.recurrenceEndDate === undefined
      ? previous?.recurrenceEndDate || null
      : isLocalDate(input.recurrenceEndDate) ? input.recurrenceEndDate : null,
  };
}

function hasScheduleMetadata(input: Required<ScheduleEntryInput>): boolean {
  return Boolean(input.scheduledDate || input.startAt || input.durationSeconds);
}

function entryFromInput(
  userId: string,
  taskId: string,
  input: ScheduleEntryInput,
  previous?: ScheduleEntry,
): ScheduleEntry | null {
  const normalized = normalizedEntryInput(input, previous);
  if (!hasScheduleMetadata(normalized)) return null;
  const now = new Date().toISOString();
  return {
    id: previous?.id || taskId,
    userId,
    taskId,
    ...normalized,
    occurrenceOverrides: previous?.occurrenceOverrides || {},
    createdAt: previous?.createdAt || now,
    updatedAt: now,
  };
}

function applyOperation(
  userEntries: Record<string, ScheduleEntry>,
  userId: string,
  operation: ScheduleBatchOperation,
): Record<string, ScheduleEntry> {
  const next = { ...userEntries };
  if (operation.type === 'remove') {
    delete next[operation.taskId];
    return next;
  }
  if (operation.type === 'upsert') {
    const entry = entryFromInput(userId, operation.taskId, operation.input, next[operation.taskId]);
    if (entry) next[operation.taskId] = entry;
    else delete next[operation.taskId];
    return next;
  }

  const existing = next[operation.taskId];
  if (!existing || !isLocalDate(operation.occurrenceDate)) return next;
  const occurrenceOverrides = { ...existing.occurrenceOverrides };
  if (operation.type === 'clear_override') {
    delete occurrenceOverrides[operation.occurrenceDate];
  } else {
    occurrenceOverrides[operation.occurrenceDate] = {
      ...(occurrenceOverrides[operation.occurrenceDate] || {}),
      ...operation.override,
      updatedAt: new Date().toISOString(),
    };
  }
  next[operation.taskId] = {
    ...existing,
    occurrenceOverrides,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      entriesByUser: {},
      upsertTaskSchedule: (userId, taskId, input) => {
        if (!userId || !taskId) return null;
        const previous = get().entriesByUser[userId]?.[taskId];
        const entry = entryFromInput(userId, taskId, input, previous);
        set(state => {
          const userEntries = { ...(state.entriesByUser[userId] || {}) };
          if (entry) userEntries[taskId] = entry;
          else delete userEntries[taskId];
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
        return entry;
      },
      removeTaskSchedule: (userId, taskId) => {
        set(state => {
          const userEntries = { ...(state.entriesByUser[userId] || {}) };
          delete userEntries[taskId];
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
      },
      setOccurrenceOverride: (userId, taskId, occurrenceDate, override) => {
        if (!get().entriesByUser[userId]?.[taskId]) {
          get().upsertTaskSchedule(userId, taskId, {
            scheduledDate: isLocalDate(override.scheduledDate) ? override.scheduledDate : occurrenceDate,
            startAt: override.startAt || null,
            durationSeconds: override.durationSeconds
              || (override.startAt ? DEFAULT_SCHEDULE_DURATION_SECONDS : null),
          });
          return;
        }
        set(state => ({
          entriesByUser: {
            ...state.entriesByUser,
            [userId]: applyOperation(state.entriesByUser[userId] || {}, userId, {
              type: 'override', taskId, occurrenceDate, override,
            }),
          },
        }));
      },
      clearOccurrenceOverride: (userId, taskId, occurrenceDate) => {
        set(state => ({
          entriesByUser: {
            ...state.entriesByUser,
            [userId]: applyOperation(state.entriesByUser[userId] || {}, userId, {
              type: 'clear_override', taskId, occurrenceDate,
            }),
          },
        }));
      },
      moveOccurrence: (userId, taskId, occurrenceDate, scheduledDate, startAt) => {
        const existing = get().entriesByUser[userId]?.[taskId];
        if (!existing) {
          get().upsertTaskSchedule(userId, taskId, {
            scheduledDate,
            startAt,
            durationSeconds: startAt ? DEFAULT_SCHEDULE_DURATION_SECONDS : null,
          });
          return;
        }
        get().setOccurrenceOverride(userId, taskId, occurrenceDate, {
          scheduledDate,
          startAt,
          ...(startAt && !existing.durationSeconds
            ? { durationSeconds: DEFAULT_SCHEDULE_DURATION_SECONDS }
            : {}),
        });
      },
      resizeOccurrence: (userId, taskId, occurrenceDate, durationSeconds) => {
        if (!get().entriesByUser[userId]?.[taskId]) {
          get().upsertTaskSchedule(userId, taskId, { scheduledDate: occurrenceDate, durationSeconds });
          return;
        }
        get().setOccurrenceOverride(userId, taskId, occurrenceDate, { durationSeconds });
      },
      applyScheduleBatch: (userId, operations) => {
        set(state => {
          let userEntries = state.entriesByUser[userId] || {};
          for (const operation of operations) userEntries = applyOperation(userEntries, userId, operation);
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
      },
      replaceUserSchedules: (userId, entries) => {
        const userEntries = Object.fromEntries(entries
          .filter(entry => entry.userId === userId && entry.taskId)
          .map(entry => [entry.taskId, entry]));
        set(state => ({ entriesByUser: { ...state.entriesByUser, [userId]: userEntries } }));
      },
      clearTaskSchedules: (userId, taskIds) => {
        set(state => {
          if (!taskIds) {
            return { entriesByUser: { ...state.entriesByUser, [userId]: {} } };
          }
          const userEntries = { ...(state.entriesByUser[userId] || {}) };
          for (const taskId of taskIds) delete userEntries[taskId];
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
      },
    }),
    {
      name: 'orderly-schedule-storage',
      version: SCHEDULE_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ entriesByUser: state.entriesByUser }),
    },
  ),
);
