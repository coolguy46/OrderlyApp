'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMinutes,
  differenceInSeconds,
  format,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { ArchiveRestore, ChevronLeft, ChevronRight, CircleHelp } from 'lucide-react';
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import { TaskForm } from '@/components/tasks/TaskForm';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';
import type { UntimedScheduleItem } from '@/components/schedule/UntimedTaskShelf';
import { usePlannerStore } from '@/lib/planner/store';
import {
  getLegacyCalendarEventsRecoveryInfo,
  plannerTaskDeadline,
  recoverLegacyCalendarEvents,
  storedEventsToCommitments,
  type LegacyCalendarEventsRecoveryInfo,
  writeStoredCalendarEvents,
} from '@/lib/planner/adapters';
import { useStoredCalendarEvents } from '@/lib/planner/use-stored-calendar-events';
import { shiftCalendarWeek } from '@/lib/schedule/calendar-navigation';
import { withCommitmentOccurrenceOverride } from '@/lib/planner/commitments';
import { buildVisibleScheduleOccurrences, visibleCommitmentOccurrences } from '@/lib/schedule/visible-intervals';
import {
  DEFAULT_SCHEDULE_DURATION_SECONDS,
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
  selectScheduleEntriesForUser,
  taskDeadlineDate,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { LocalDate, ScheduleEntry, ScheduleOccurrence } from '@/lib/schedule/types';
import { useAppStore } from '@/lib/store';
import type { RecurringCommitmentInput } from '@/lib/planner/types';
import type { Task } from '@/lib/supabase/types';
import { useHydrated } from '@/lib/use-hydrated';
import { toast } from 'sonner';
import { confirmCalendarPersistence } from '@/lib/schedule/confirm-calendar-persistence';

const WEEK_STARTS_ON = 1 as const;

function localDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd');
}

function dateCarrierInTimeZone(timeZone: string, instant = new Date()): Date {
  const date = localDateFromIso(instant.toISOString(), timeZone);
  if (!date) return startOfDay(instant);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function commitmentBlocks(
  commitments: readonly RecurringCommitmentInput[],
  dates: LocalDate[],
  timeZone: string,
  savedCommitments: readonly RecurringCommitmentInput[],
): PlannerBlockView[] {
  if (dates.length === 0) return [];
  const savedIds = new Set(savedCommitments.map(commitment => commitment.id));
  return commitments.flatMap(commitment => {
    return visibleCommitmentOccurrences(commitment, dates[0], dates[dates.length - 1], timeZone).flatMap(occurrence => {
      const school = commitment.kind === 'school';
      const calendarEventId = commitment.id.startsWith('calendar-') && !savedIds.has(commitment.id)
        ? commitment.id.slice('calendar-'.length)
        : null;
      return [{
        id: occurrence.id,
        title: occurrence.title,
        description: [occurrence.description, occurrence.location ? `Location: ${occurrence.location}` : null]
          .filter(Boolean)
          .join('\n') || null,
        startAt: occurrence.startAt,
        endAt: occurrence.endAt,
        color: commitment.color || '#0ea5e9',
        source: school ? 'School day' : calendarEventId ? 'Calendar event' : 'Calendar commitment',
        kind: school ? 'school' as const : 'commitment' as const,
        commitmentId: commitment.id,
        calendarEventId,
        occurrenceDate: occurrence.sourceDate,
        fixed: school,
        locked: school,
      }];
    });
  });
}

function occurrenceDuration(occurrence: ScheduleOccurrence): number {
  return occurrence.durationSeconds || DEFAULT_SCHEDULE_DURATION_SECONDS;
}

function occurrenceDeadline(occurrence: ScheduleOccurrence, timeZone: string): string | null {
  if (occurrence.recurrence === 'none') return plannerTaskDeadline(occurrence.task, timeZone);
  let dueTime = occurrence.task.due_time || '23:59';
  if (
    !occurrence.task.due_time
    && occurrence.task.due_date
    && occurrence.task.source
    && occurrence.task.source !== 'manual'
  ) {
    dueTime = localTimeFromIso(occurrence.task.due_date, timeZone) || dueTime;
  }
  return localDateTimeToIso(occurrence.recurrenceSourceDate, `${dueTime}:00`, timeZone);
}

function occurrenceBlocks(occurrences: readonly ScheduleOccurrence[]): PlannerBlockView[] {
  return occurrences.flatMap(occurrence => {
    if (!occurrence.startAt) return [];
    const start = new Date(occurrence.startAt);
    if (Number.isNaN(start.getTime())) return [];
    const end = occurrence.endAt
      ? new Date(occurrence.endAt)
      : addMinutes(start, Math.round(occurrenceDuration(occurrence) / 60));
    if (Number.isNaN(end.getTime()) || end <= start) return [];
    return [{
      id: occurrence.id,
      title: occurrence.title,
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      description: occurrence.description,
      subjectName: occurrence.subject?.name || occurrence.task.course_name || null,
      subjectColor: occurrence.color,
      color: occurrence.color,
      source: occurrence.task.source || 'Orderly',
      kind: 'task' as const,
      taskId: occurrence.taskId,
      fixed: false,
      locked: false,
      completed: occurrence.task.status === 'completed',
    }];
  });
}

function conflictingBlock(
  blocks: readonly PlannerBlockView[],
  movingBlockId: string,
  start: Date,
  end: Date,
): PlannerBlockView | null {
  return blocks.find(candidate => {
    if (candidate.id === movingBlockId) return false;
    const candidateStart = new Date(candidate.startAt);
    const candidateEnd = new Date(candidate.endAt);
    if (Number.isNaN(candidateStart.getTime()) || Number.isNaN(candidateEnd.getTime())) return false;
    return start.getTime() < candidateEnd.getTime() && end.getTime() > candidateStart.getTime();
  }) || null;
}

function occurrenceInput(entry: ScheduleEntry | undefined, occurrence: ScheduleOccurrence) {
  return {
    scheduledDate: occurrence.date,
    startAt: occurrence.startAt,
    durationSeconds: occurrenceDuration(occurrence),
    recurrence: entry?.recurrence || occurrence.recurrence,
    recurrenceDays: entry?.recurrenceDays || occurrence.task.recurrence_days,
    recurrenceEndDate: entry?.recurrenceEndDate || null,
  };
}

export function ScheduleCalendar() {
  const { user, tasks, subjects } = useAppStore();
  const userId = user?.id || null;
  const hydrated = useHydrated();
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const upsertCommitment = usePlannerStore(state => state.upsertCommitment);
  const waitForPlannerPersistence = usePlannerStore(state => state.waitForPlannerPersistence);
  const waitForSchedulePersistence = useScheduleStore(state => state.waitForSchedulePersistence);
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const upsertTaskSchedule = useScheduleStore(state => state.upsertTaskSchedule);
  const setOccurrenceOverride = useScheduleStore(state => state.setOccurrenceOverride);
  const moveOccurrence = useScheduleStore(state => state.moveOccurrence);
  const resizeOccurrence = useScheduleStore(state => state.resizeOccurrence);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const [legacyRecoveryOpenForUser, setLegacyRecoveryOpenForUser] = useState<string | null>(null);
  const [legacyRecoverySnapshot, setLegacyRecoverySnapshot] = useState<{
    userId: string | null;
    info: LegacyCalendarEventsRecoveryInfo | null;
  }>({ userId: null, info: null });
  const { events: storedEvents, setEvents: setStoredEvents } = useStoredCalendarEvents(userId);
  const initialLegacyRecovery = useMemo(
    () => hydrated && userId ? getLegacyCalendarEventsRecoveryInfo(userId) : null,
    [hydrated, userId],
  );
  const legacyRecovery = legacyRecoverySnapshot.userId === userId
    ? legacyRecoverySnapshot.info
    : initialLegacyRecovery;
  const legacyRecoveryOpen = Boolean(userId && legacyRecoveryOpenForUser === userId);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingCommitment, setEditingCommitment] = useState<RecurringCommitmentInput | null>(null);
  const [editingOccurrenceDate, setEditingOccurrenceDate] = useState<string | null>(null);
  const [creationSlot, setCreationSlot] = useState<{
    date: string;
    startTime: string;
    durationSeconds: number;
  } | null>(null);

  useEffect(() => {
    if (!userId) return;
    setActiveUser(userId, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, userId]);
  const plannerRecord = userId ? plannerUsers[userId] : null;
  const timeZone = plannerRecord?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  useEffect(() => {
    const today = dateCarrierInTimeZone(timeZone);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWeekStart(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }));
      setSelectedDate(today);
    });
    return () => { cancelled = true; };
  }, [timeZone]);
  const entries = useMemo(
    () => selectScheduleEntriesForUser(entriesByUser, userId),
    [entriesByUser, userId],
  );
  const entriesByTaskId = useMemo(
    () => new Map(entries.map(entry => [entry.taskId, entry])),
    [entries],
  );
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);

  const weekDates = useMemo(() => {
    if (!weekStart) return [];
    return Array.from({ length: 7 }, (_, index) => localDate(addDays(weekStart, index)));
  }, [weekStart]);

  const occurrences = useMemo(() => {
    if (weekDates.length !== 7) return { timed: [], untimed: [] };
    return buildVisibleScheduleOccurrences({
      tasks,
      entries,
      subjects,
      startDate: weekDates[0],
      endDate: weekDates[6],
      timeZone,
      schoolHours: plannerRecord ? {
        schoolDays: plannerRecord.settings.schoolDays,
        schoolStartTime: plannerRecord.settings.schoolStartTime,
        schoolHomeTime: plannerRecord.settings.schoolHomeTime,
      } : undefined,
    });
  }, [entries, plannerRecord, subjects, tasks, timeZone, weekDates]);

  const allCommitments = useMemo(() => {
    const schoolCommitments: RecurringCommitmentInput[] = plannerRecord ? [{
      id: 'schedule-school-day',
      title: 'School day',
      kind: 'school',
      daysOfWeek: plannerRecord.settings.schoolDays,
      startTime: plannerRecord.settings.wakeTime,
      endTime: plannerRecord.settings.schoolHomeTime,
      timeZone,
      enabled: true,
      color: '#64748b',
    }] : [];
    return [
      ...schoolCommitments,
      ...(plannerRecord?.commitments || []),
      ...storedEventsToCommitments(storedEvents, timeZone, plannerRecord?.commitments),
    ];
  }, [plannerRecord, storedEvents, timeZone]);
  const commitmentById = useMemo(
    () => new Map(allCommitments.map(commitment => [commitment.id, commitment])),
    [allCommitments],
  );
  const fixedBlocks = useMemo(() => {
    if (weekDates.length !== 7) return [];
    return commitmentBlocks(allCommitments, weekDates, timeZone, plannerRecord?.commitments || []);
  }, [allCommitments, plannerRecord?.commitments, timeZone, weekDates]);

  const timedBlocks = useMemo(
    () => [...fixedBlocks, ...occurrenceBlocks(occurrences.timed)],
    [fixedBlocks, occurrences.timed],
  );
  const occurrenceById = useMemo(
    () => new Map(
      [...occurrences.timed, ...occurrences.untimed]
        .map(occurrence => [occurrence.id, occurrence] as const),
    ),
    [occurrences.timed, occurrences.untimed],
  );
  const detailOccurrence = detailOccurrenceId
    ? occurrenceById.get(detailOccurrenceId) || null
    : null;
  const detailTask = detailOccurrence
    ? taskById.get(detailOccurrence.taskId) || detailOccurrence.task
    : null;

  const openTaskFromOccurrence = useCallback((occurrenceId: string) => {
    const occurrence = occurrenceById.get(occurrenceId);
    if (!occurrence) return;
    const task = taskById.get(occurrence.taskId) || occurrence.task;
    setEditingOccurrenceDate(occurrence.recurrenceSourceDate);
    setDetailOccurrenceId(null);
    setEditingCommitment(null);
    setCreationSlot(null);
    setEditingTask(task);
  }, [occurrenceById, taskById]);

  const handleBlockClick = useCallback((block: PlannerBlockView) => {
    if (block.taskId) {
      openTaskFromOccurrence(block.id);
      return;
    }
    if (!block.commitmentId || block.kind === 'school') return;
    const commitment = commitmentById.get(block.commitmentId);
    if (!commitment) return;
    setDetailOccurrenceId(null);
    setEditingTask(null);
    setCreationSlot(null);
    setEditingCommitment(commitment);
    setEditingOccurrenceDate(block.occurrenceDate || null);
  }, [commitmentById, openTaskFromOccurrence]);
  const untimedItems = useMemo<UntimedScheduleItem[]>(
    () => occurrences.untimed.map(occurrence => ({
      id: occurrence.id,
      taskId: occurrence.taskId,
      title: occurrence.title,
      date: occurrence.date,
      durationSeconds: occurrence.durationSeconds,
      color: occurrence.color,
      completed: occurrence.task.status === 'completed',
    })),
    [occurrences.untimed],
  );

  const confirmTaskChange = useCallback(async (taskId: string, successMessage?: string) => {
    if (!userId) return false;
    const result = await confirmCalendarPersistence(
      () => waitForSchedulePersistence(userId, [taskId]),
      () => useAppStore.getState().user?.id === userId,
    );
    if (result === 'stale') return false;
    if (result === 'pending') toast.error('Schedule change is not saved yet', {
      description: 'It is still pending on this device. Check your connection and retry before relying on it elsewhere.',
    });
    else if (successMessage) toast.success(successMessage);
    return result === 'saved';
  }, [userId, waitForSchedulePersistence]);

  const persistCommitmentOccurrence = useCallback(async (
    block: PlannerBlockView,
    nextStart: Date,
    nextEnd: Date,
  ) => {
    if (!userId || !block.commitmentId || !block.occurrenceDate || block.kind === 'school') return false;
    const commitment = commitmentById.get(block.commitmentId);
    if (!commitment) return false;
    const commitmentTimeZone = commitment.timeZone || timeZone;
    const scheduledDate = localDateFromIso(nextStart.toISOString(), commitmentTimeZone);
    const endDate = localDateFromIso(new Date(nextEnd.getTime() - 1).toISOString(), commitmentTimeZone);
    const startTime = localTimeFromIso(nextStart.toISOString(), commitmentTimeZone);
    const endTime = localTimeFromIso(nextEnd.toISOString(), commitmentTimeZone);
    if (!scheduledDate || !endDate || scheduledDate !== endDate || !startTime || !endTime) {
      toast.error('Calendar blocks must stay within one day');
      return false;
    }
    const updated = withCommitmentOccurrenceOverride(commitment, block.occurrenceDate, {
      scheduledDate,
      startTime,
      endTime,
    });
    if (block.calendarEventId) {
      const nextEvents = storedEvents.map(event => event.id === block.calendarEventId
        ? { ...event, occurrenceOverrides: updated.occurrenceOverrides }
        : event);
      if (!writeStoredCalendarEvents(userId, nextEvents)) {
        toast.error('That calendar event could not be updated');
        return false;
      }
      setStoredEvents(nextEvents);
    } else {
      upsertCommitment(userId, updated);
      const result = await confirmCalendarPersistence(
        () => waitForPlannerPersistence(userId),
        () => useAppStore.getState().user?.id === userId,
      );
      if (result !== 'saved') {
        if (result === 'pending') toast.error('Event change is not saved yet', {
          description: 'It is still pending on this device. Check your connection and retry before relying on it elsewhere.',
        });
        return false;
      }
    }
    return true;
  }, [commitmentById, setStoredEvents, storedEvents, timeZone, upsertCommitment, userId, waitForPlannerPersistence]);

  const handleMove = useCallback(async (block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      const conflict = conflictingBlock(timedBlocks, block.id, nextStart, nextEnd);
      if (conflict) {
        toast.error('That time is already occupied', {
          description: `Move “${block.title}” outside “${conflict.title}”.`,
        });
        return;
      }
      if (await persistCommitmentOccurrence(block, nextStart, nextEnd)) toast.success(`${block.title} moved`);
      return;
    }
    const conflict = conflictingBlock(timedBlocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error('That time is already occupied', {
        description: `Move “${occurrence.title}” outside “${conflict.title}”.`,
      });
      return;
    }
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.warning('Scheduled after the task deadline', {
        description: `“${occurrence.title}” remains due ${format(new Date(deadline), 'MMM d, h:mm a')}.`,
      });
    }
    const entry = entriesByTaskId.get(occurrence.taskId);
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds: Math.max(60, differenceInSeconds(nextEnd, nextStart)),
      });
      await confirmTaskChange(occurrence.taskId);
      return;
    }
    moveOccurrence(
      userId,
      occurrence.taskId,
      occurrence.recurrenceSourceDate,
      nextDate,
      nextStart.toISOString(),
    );
    await confirmTaskChange(occurrence.taskId);
  }, [confirmTaskChange, entriesByTaskId, moveOccurrence, occurrenceById, persistCommitmentOccurrence, timedBlocks, timeZone, upsertTaskSchedule, userId]);

  const handleResize = useCallback(async (block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      const conflict = conflictingBlock(timedBlocks, block.id, nextStart, nextEnd);
      if (conflict) {
        toast.error('That duration overlaps another item', {
          description: `Shorten it so it does not overlap “${conflict.title}”.`,
        });
        return;
      }
      if (await persistCommitmentOccurrence(block, nextStart, nextEnd)) toast.success(`${block.title} updated`);
      return;
    }
    const conflict = conflictingBlock(timedBlocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error('That duration overlaps another item', {
        description: `Shorten it so it does not overlap “${conflict.title}”.`,
      });
      return;
    }
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.warning('This task now runs past its deadline', {
        description: `The due date remains ${format(new Date(deadline), 'MMM d, h:mm a')}.`,
      });
    }
    const durationSeconds = Math.max(60, differenceInSeconds(nextEnd, nextStart));
    const entry = entriesByTaskId.get(occurrence.taskId);
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        durationSeconds,
      });
      await confirmTaskChange(occurrence.taskId);
      return;
    }
    resizeOccurrence(
      userId,
      occurrence.taskId,
      occurrence.recurrenceSourceDate,
      durationSeconds,
    );
    await confirmTaskChange(occurrence.taskId);
  }, [confirmTaskChange, entriesByTaskId, occurrenceById, persistCommitmentOccurrence, resizeOccurrence, timedBlocks, timeZone, upsertTaskSchedule, userId]);

  const handleScheduleUntimed = useCallback(async (
    item: UntimedScheduleItem,
    nextStart: Date,
    nextEnd: Date,
  ) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(item.id);
    if (!occurrence) return;
    const conflict = conflictingBlock(timedBlocks, item.id, nextStart, nextEnd);
    if (conflict) {
      toast.error('That time is already occupied', {
        description: `Choose a free time outside “${conflict.title}”.`,
      });
      return;
    }
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.warning('Scheduled after the task deadline', {
        description: `“${occurrence.title}” remains due ${format(new Date(deadline), 'MMM d, h:mm a')}.`,
      });
    }
    const entry = entriesByTaskId.get(occurrence.taskId);
    const durationSeconds = Math.max(60, differenceInSeconds(nextEnd, nextStart));
    if (occurrence.recurrence !== 'none') {
      if (!entry) {
        upsertTaskSchedule(userId, occurrence.taskId, {
          scheduledDate: taskDeadlineDate(occurrence.task, timeZone) || occurrence.recurrenceSourceDate,
          startAt: null,
          durationSeconds: occurrence.durationSeconds || durationSeconds,
          recurrence: occurrence.recurrence,
          recurrenceDays: occurrence.task.recurrence_days,
          recurrenceEndDate: null,
        });
      }
      setOccurrenceOverride(userId, occurrence.taskId, occurrence.recurrenceSourceDate, {
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds,
      });
    } else {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds,
      });
    }
    await confirmTaskChange(occurrence.taskId, `${occurrence.title} scheduled`);
  }, [confirmTaskChange, entriesByTaskId, occurrenceById, setOccurrenceOverride, timedBlocks, timeZone, upsertTaskSchedule, userId]);

  const handleMoveToUntimed = useCallback(async (block: PlannerBlockView, targetDate?: string) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence?.startAt) return;
    const entry = entriesByTaskId.get(occurrence.taskId);
    const durationSeconds = occurrence.durationSeconds || occurrenceDuration(occurrence);
    const nextDate = targetDate || occurrence.date;
    if (occurrence.recurrence !== 'none') {
      if (!entry) {
        upsertTaskSchedule(userId, occurrence.taskId, {
          scheduledDate: taskDeadlineDate(occurrence.task, timeZone) || occurrence.recurrenceSourceDate,
          startAt: null,
          durationSeconds,
          recurrence: occurrence.recurrence,
          recurrenceDays: occurrence.task.recurrence_days,
          recurrenceEndDate: null,
        });
      }
      setOccurrenceOverride(userId, occurrence.taskId, occurrence.recurrenceSourceDate, {
        scheduledDate: nextDate,
        startAt: null,
        durationSeconds,
      });
    } else {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: null,
        durationSeconds,
      });
    }
    await confirmTaskChange(occurrence.taskId, `${occurrence.title} moved to untimed`);
  }, [confirmTaskChange, entriesByTaskId, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

  const handleEmptySlotClick = useCallback((nextStart: Date, nextEnd: Date) => {
    const date = localDateFromIso(nextStart.toISOString(), timeZone);
    const startTime = localTimeFromIso(nextStart.toISOString(), timeZone);
    if (!date || !startTime) return;
    setDetailOccurrenceId(null);
    setEditingCommitment(null);
    setEditingTask(null);
    setCreationSlot({
      date,
      startTime,
      durationSeconds: Math.max(60, differenceInSeconds(nextEnd, nextStart)),
    });
  }, [timeZone]);

  if (!weekStart) {
    return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">Loading schedule…</div>;
  }

  const goToToday = () => {
    const today = dateCarrierInTimeZone(timeZone);
    setWeekStart(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }));
    setSelectedDate(today);
  };

  const handleLegacyRecovery = () => {
    if (!userId) return;
    const result = recoverLegacyCalendarEvents({
      userId,
      confirmedOwnerUserId: userId,
    });
    if (result.status === 'recovered' || result.status === 'already-imported') {
      setStoredEvents(result.events);
      setLegacyRecoverySnapshot({
        userId,
        info: getLegacyCalendarEventsRecoveryInfo(userId),
      });
      toast.success(
        result.status === 'recovered'
          ? `${result.recoveredCount} older calendar item${result.recoveredCount === 1 ? '' : 's'} imported`
          : 'Those calendar items were already imported',
      );
      return;
    }
    toast.error(
      result.status === 'failed'
        ? 'Calendar import could not be saved. Your older backup was kept.'
        : 'Those calendar items are not available to this account.',
    );
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-1">
        <div className="flex min-w-0 max-w-full items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const next = shiftCalendarWeek(weekStart, selectedDate || weekStart, -1);
              setWeekStart(next.weekStart);
              setSelectedDate(next.selectedDate);
            }}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={goToToday} className="h-9 px-2.5 text-sm">Today</Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const next = shiftCalendarWeek(weekStart, selectedDate || weekStart, 1);
              setWeekStart(next.weekStart);
              setSelectedDate(next.selectedDate);
            }}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <p className="ml-2 min-w-0 text-sm font-semibold leading-snug sm:text-base">
            {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{occurrences.timed.length} timed · {occurrences.untimed.length} untimed</span>
          <details className="group relative">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 text-xs transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
              <CircleHelp className="h-3.5 w-3.5" />
              Schedule tips
            </summary>
            <div className="absolute right-0 top-full z-[60] mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border border-border bg-popover p-4 text-xs leading-relaxed text-popover-foreground shadow-lg">
              <p>Click an empty time to add a task or event.</p>
              <p>Drag items to move them. Use the bottom edge to resize, or move a task back to Untimed.</p>
              <p className="text-muted-foreground">Scheduling work does not change its deadline. School hours are managed in Settings.</p>
            </div>
          </details>
        </div>
      </div>

      {legacyRecovery?.status === 'available' && legacyRecovery.ownerKnown && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <ArchiveRestore className="h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Recover your older calendar items</p>
              <p className="text-xs text-muted-foreground">A previous Orderly version saved items for this account on this browser.</p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (userId) setLegacyRecoveryOpenForUser(userId);
            }}
          >
            Review recovery
          </Button>
        </div>
      )}

      <WeekTimeGrid
        weekStart={weekStart}
        blocks={timedBlocks}
        editable
        variant="fullscreen"
        viewportClassName="h-[calc(100dvh-13.5rem)] min-h-[420px]"
        showSummaryHeader={false}
        showUntimedShelf
        untimedItems={untimedItems}
        selectedDate={selectedDate || weekStart}
        onSelectedDateChange={setSelectedDate}
        onUntimedItemClick={item => item.taskId && openTaskFromOccurrence(item.id)}
        onUntimedItemSchedule={handleScheduleUntimed}
        onBlockClick={handleBlockClick}
        onEmptySlotClick={handleEmptySlotClick}
        onBlockMove={handleMove}
        onBlockResize={handleResize}
        onBlockMoveToUntimed={handleMoveToUntimed}
        timeZone={timeZone}
        timeZoneLabel={timeZone}
        initialScrollHour={6}
      />

      <TaskDetailViewer
        task={detailTask}
        scheduleOccurrence={detailOccurrence}
        open={Boolean(detailTask)}
        onOpenChange={open => !open && setDetailOccurrenceId(null)}
        onEdit={task => {
          setDetailOccurrenceId(null);
          setCreationSlot(null);
          setEditingTask(task);
        }}
      />
      <TaskForm
        isOpen={Boolean(editingTask || editingCommitment || creationSlot)}
        task={editingTask}
        commitment={editingCommitment}
        occurrenceDate={editingCommitment || editingTask ? editingOccurrenceDate : null}
        initialMode="task"
        initialDate={creationSlot?.date || (selectedDate ? format(selectedDate, 'yyyy-MM-dd') : '')}
        initialStartTime={creationSlot?.startTime || ''}
        initialDurationSeconds={creationSlot?.durationSeconds || null}
        onClose={() => {
          setEditingTask(null);
          setEditingCommitment(null);
          setCreationSlot(null);
        }}
        onSaved={() => {
          if (!userId || useAppStore.getState().user?.id !== userId || !editingCommitment?.id.startsWith('calendar-')) return;
          const legacyId = editingCommitment.id.slice('calendar-'.length);
          const nextEvents = storedEvents.filter(event => event.id !== legacyId);
          if (writeStoredCalendarEvents(userId, nextEvents)) setStoredEvents(nextEvents);
          else toast.warning('The event was saved, but its old browser copy could not be removed. The backup has been kept.');
        }}
      />

      <ConfirmDialog
        open={legacyRecoveryOpen}
        onOpenChange={open => setLegacyRecoveryOpenForUser(open ? userId : null)}
        title="Recover older calendar items?"
        description={`Copy ${legacyRecovery?.eventCount || 0} calendar item${legacyRecovery?.eventCount === 1 ? '' : 's'} previously saved for ${user?.email || 'this account'} into its account-scoped calendar. The original browser backup will be kept.`}
        confirmLabel="Recover items"
        cancelLabel="Cancel"
        variant="default"
        onConfirm={handleLegacyRecovery}
      />
    </div>
  );
}
