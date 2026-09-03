'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { DEFAULT_SCHEDULE_DURATION_SECONDS, isLocalDate } from './selectors';
import { persistTaskSchedule } from './persistence-client';
import {
  mergeScheduleHydration,
  persistedTaskScheduleUpdate,
  type PendingScheduleMutation,
} from './persistence';
import type {
  LocalDate,
  ScheduleBatchOperation,
  ScheduleEntry,
  ScheduleEntryInput,
  ScheduleOccurrenceOverride,
} from './types';

const SCHEDULE_STORE_VERSION = 2;

export interface ScheduleState {
  activeUserId: string | null;
  sessionGeneration: number;
  entriesByUser: Record<string, Record<string, ScheduleEntry>>;
  pendingByUser: Record<string, Record<string, PendingScheduleMutation>>;
  nextRevisionByUser: Record<string, number>;
  setActiveUser: (userId: string | null) => void;
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
  hydrateUserSchedules: (userId: string, entries: ScheduleEntry[]) => void;
  retryPendingSchedules: (userId: string) => void;
  waitForSchedulePersistence: (
    userId: string,
    taskIds?: readonly string[],
    timeoutMs?: number,
  ) => Promise<boolean>;
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

const persistenceQueues = new Map<string, Promise<void>>();
const DEFAULT_SCHEDULE_PERSISTENCE_WAIT_MS = 15_000;
let onlineRetryInstalled = false;

async function waitForScheduleQueuesBefore(
  queues: readonly Promise<void>[],
  deadline: number,
): Promise<boolean> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return false;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.all(queues).then(() => true, () => false),
      new Promise<boolean>(resolve => {
        timeout = setTimeout(() => resolve(false), remainingMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function samePersistedSchedule(left: ScheduleEntry | undefined, right: ScheduleEntry | undefined): boolean {
  return JSON.stringify(persistedTaskScheduleUpdate(left || null))
    === JSON.stringify(persistedTaskScheduleUpdate(right || null));
}

function schedulePersistenceKey(userId: string, taskId: string): string {
  return `${userId}:${taskId}`;
}

function queueSchedulePersistence(
  userId: string,
  taskId: string,
  expectedGeneration: number,
): void {
  const key = schedulePersistenceKey(userId, taskId);
  const previous = persistenceQueues.get(key) || Promise.resolve();
  const queued = previous.catch(() => undefined).then(async () => {
    const before = useScheduleStore.getState();
    const pending = before.pendingByUser[userId]?.[taskId];
    if (!pending || before.activeUserId !== userId || before.sessionGeneration !== expectedGeneration) return;
    try {
      await persistTaskSchedule(userId, taskId, pending.entry);
    } catch (error) {
      // The local cache remains fully usable offline. A later online event,
      // hydration, or explicit account activation retries this exact revision.
      console.warn('Could not persist task schedule; keeping it queued locally.', error);
      return;
    }

    const after = useScheduleStore.getState();
    const latest = after.pendingByUser[userId]?.[taskId];
    if (
      after.activeUserId !== userId
      || after.sessionGeneration !== expectedGeneration
      || latest?.revision !== pending.revision
    ) return;
    useScheduleStore.setState(state => {
      const userPending = { ...(state.pendingByUser[userId] || {}) };
      delete userPending[taskId];
      return { pendingByUser: { ...state.pendingByUser, [userId]: userPending } };
    });
  }).finally(() => {
    if (persistenceQueues.get(key) === queued) persistenceQueues.delete(key);
  });
  persistenceQueues.set(key, queued);
}

/**
 * Wait for selected task schedule mutations to reach Supabase.
 *
 * When `taskIds` is omitted, the pending task ids present at invocation are
 * captured. A resolved `true` means those task ids have no durable outbox
 * entries left for the same active account/session. Failed writes remain in
 * the outbox and therefore resolve `false`, as do timeouts and account changes.
 */
export async function waitForSchedulePersistence(
  userId: string,
  taskIds?: readonly string[],
  timeoutMs = DEFAULT_SCHEDULE_PERSISTENCE_WAIT_MS,
): Promise<boolean> {
  const initial = useScheduleStore.getState();
  if (initial.activeUserId !== userId) return false;

  const targetTaskIds = [...new Set(
    (taskIds || Object.keys(initial.pendingByUser[userId] || {}))
      .filter(taskId => typeof taskId === 'string' && taskId.length > 0),
  )];
  if (targetTaskIds.length === 0) return true;

  const expectedGeneration = initial.sessionGeneration;
  for (const taskId of targetTaskIds) {
    if (
      initial.pendingByUser[userId]?.[taskId]
      && !persistenceQueues.has(schedulePersistenceKey(userId, taskId))
    ) {
      queueSchedulePersistence(userId, taskId, expectedGeneration);
    }
  }

  const boundedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.trunc(timeoutMs)
    : DEFAULT_SCHEDULE_PERSISTENCE_WAIT_MS;
  const deadline = Date.now() + boundedTimeoutMs;

  while (true) {
    const beforeWait = useScheduleStore.getState();
    if (
      beforeWait.activeUserId !== userId
      || beforeWait.sessionGeneration !== expectedGeneration
    ) return false;

    const pendingTaskIds = targetTaskIds.filter(
      taskId => Boolean(beforeWait.pendingByUser[userId]?.[taskId]),
    );
    if (pendingTaskIds.length === 0) return true;

    const queues = [...new Set(pendingTaskIds
      .map(taskId => persistenceQueues.get(schedulePersistenceKey(userId, taskId)))
      .filter((queue): queue is Promise<void> => Boolean(queue)))];
    if (queues.length === 0 || !(await waitForScheduleQueuesBefore(queues, deadline))) return false;

    const after = useScheduleStore.getState();
    if (
      after.activeUserId !== userId
      || after.sessionGeneration !== expectedGeneration
    ) return false;
    if (targetTaskIds.every(taskId => !after.pendingByUser[userId]?.[taskId])) return true;

    // Revisions created during a save append new per-task queue entries. The
    // next pass waits for those; a pending id without a queue means its last
    // persistence attempt failed and must not be reported as saved.
    const hasFollowUpQueue = targetTaskIds.some(taskId => (
      Boolean(after.pendingByUser[userId]?.[taskId])
      && persistenceQueues.has(schedulePersistenceKey(userId, taskId))
    ));
    if (!hasFollowUpQueue) return false;
  }
}

function retryPendingSchedules(userId: string): void {
  const state = useScheduleStore.getState();
  if (state.activeUserId !== userId) return;
  for (const taskId of Object.keys(state.pendingByUser[userId] || {})) {
    queueSchedulePersistence(userId, taskId, state.sessionGeneration);
  }
}

function installOnlineRetry(): void {
  if (onlineRetryInstalled || typeof window === 'undefined') return;
  onlineRetryInstalled = true;
  window.addEventListener('online', () => {
    const userId = useScheduleStore.getState().activeUserId;
    if (userId) retryPendingSchedules(userId);
  });
}

function markScheduleMutation(userId: string, taskId: string, entry: ScheduleEntry | null): void {
  const state = useScheduleStore.getState();
  const revision = (state.nextRevisionByUser[userId] || 0) + 1;
  useScheduleStore.setState(current => ({
    nextRevisionByUser: { ...current.nextRevisionByUser, [userId]: revision },
    pendingByUser: {
      ...current.pendingByUser,
      [userId]: {
        ...(current.pendingByUser[userId] || {}),
        [taskId]: { revision, entry },
      },
    },
  }));
  const active = useScheduleStore.getState();
  if (active.activeUserId === userId) {
    queueSchedulePersistence(userId, taskId, active.sessionGeneration);
  }
}

export const useScheduleStore = create<ScheduleState>()(
  persist(
    (set, get) => ({
      activeUserId: null,
      sessionGeneration: 0,
      entriesByUser: {},
      pendingByUser: {},
      nextRevisionByUser: {},
      setActiveUser: (userId) => {
        const previous = get().activeUserId;
        if (previous !== userId) {
          set(state => ({ activeUserId: userId, sessionGeneration: state.sessionGeneration + 1 }));
        } else {
          set({ activeUserId: userId });
        }
        installOnlineRetry();
      },
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
        markScheduleMutation(userId, taskId, entry);
        return entry;
      },
      removeTaskSchedule: (userId, taskId) => {
        set(state => {
          const userEntries = { ...(state.entriesByUser[userId] || {}) };
          delete userEntries[taskId];
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
        markScheduleMutation(userId, taskId, null);
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
        markScheduleMutation(userId, taskId, get().entriesByUser[userId]?.[taskId] || null);
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
        markScheduleMutation(userId, taskId, get().entriesByUser[userId]?.[taskId] || null);
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
        const before = get().entriesByUser[userId] || {};
        set(state => {
          let userEntries = state.entriesByUser[userId] || {};
          for (const operation of operations) userEntries = applyOperation(userEntries, userId, operation);
          return { entriesByUser: { ...state.entriesByUser, [userId]: userEntries } };
        });
        const after = get().entriesByUser[userId] || {};
        const affectedTaskIds = [...new Set(operations.map(operation => operation.taskId))];
        for (const taskId of affectedTaskIds) {
          if (!samePersistedSchedule(before[taskId], after[taskId])) {
            markScheduleMutation(userId, taskId, after[taskId] || null);
          }
        }
      },
      replaceUserSchedules: (userId, entries) => {
        const before = get().entriesByUser[userId] || {};
        const userEntries = Object.fromEntries(entries
          .filter(entry => entry.userId === userId && entry.taskId)
          .map(entry => [entry.taskId, entry]));
        set(state => ({ entriesByUser: { ...state.entriesByUser, [userId]: userEntries } }));
        for (const taskId of new Set([...Object.keys(before), ...Object.keys(userEntries)])) {
          if (!samePersistedSchedule(before[taskId], userEntries[taskId])) {
            markScheduleMutation(userId, taskId, userEntries[taskId] || null);
          }
        }
      },
      hydrateUserSchedules: (userId, entries) => {
        set(state => ({
          entriesByUser: {
            ...state.entriesByUser,
            [userId]: mergeScheduleHydration(
              userId,
              entries,
              state.entriesByUser[userId] || {},
              state.pendingByUser[userId] || {},
            ),
          },
        }));
        retryPendingSchedules(userId);
      },
      retryPendingSchedules,
      waitForSchedulePersistence,
      clearTaskSchedules: (userId, taskIds) => {
        set(state => {
          const pendingByUser = { ...state.pendingByUser };
          const nextRevisionByUser = { ...state.nextRevisionByUser };
          if (!taskIds) {
            pendingByUser[userId] = {};
            delete nextRevisionByUser[userId];
            return {
              entriesByUser: { ...state.entriesByUser, [userId]: {} },
              pendingByUser,
              nextRevisionByUser,
            };
          }
          const userEntries = { ...(state.entriesByUser[userId] || {}) };
          const userPending = { ...(pendingByUser[userId] || {}) };
          for (const taskId of taskIds) {
            delete userEntries[taskId];
            delete userPending[taskId];
          }
          pendingByUser[userId] = userPending;
          return {
            entriesByUser: { ...state.entriesByUser, [userId]: userEntries },
            pendingByUser,
          };
        });
      },
    }),
    {
      name: 'orderly-schedule-storage',
      version: SCHEDULE_STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({
        entriesByUser: state.entriesByUser,
        pendingByUser: state.pendingByUser,
        nextRevisionByUser: state.nextRevisionByUser,
      }),
      migrate: (persisted, persistedVersion) => {
        const saved = persisted as Partial<ScheduleState> | undefined;
        const entriesByUser = saved?.entriesByUser || {};
        const pendingByUser = Object.fromEntries(
          Object.entries(saved?.pendingByUser || {}).map(([userId, pending]) => [userId, { ...pending }]),
        );
        const nextRevisionByUser = { ...(saved?.nextRevisionByUser || {}) };

        // Version one stored complete per-account schedules locally but had no
        // server outbox. Seed an outbox exactly once so an upgrade does not
        // erase existing calendar work when the initially-empty task columns
        // hydrate from Supabase.
        if (persistedVersion < SCHEDULE_STORE_VERSION) {
          for (const [userId, entries] of Object.entries(entriesByUser)) {
            const pending = { ...(pendingByUser[userId] || {}) };
            let revision = nextRevisionByUser[userId] || 0;
            for (const [taskId, entry] of Object.entries(entries || {})) {
              if (pending[taskId]) continue;
              revision += 1;
              pending[taskId] = { revision, entry };
            }
            pendingByUser[userId] = pending;
            nextRevisionByUser[userId] = revision;
          }
        }
        return {
          ...saved,
          activeUserId: null,
          sessionGeneration: 0,
          entriesByUser,
          pendingByUser,
          nextRevisionByUser,
        } as ScheduleState;
      },
    },
  ),
);
