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
import { ChevronLeft, ChevronRight, Clock3 } from 'lucide-react';
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import { Button } from '@/components/ui/Button';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';
import type { UntimedScheduleItem } from '@/components/schedule/UntimedTaskShelf';
import { usePlannerStore } from '@/lib/planner/store';
import {
  readStoredCalendarEvents,
  storedEventsToCommitments,
  type StoredCalendarEvent,
} from '@/lib/planner/adapters';
import {
  addLocalDays,
  buildScheduleOccurrences,
  DEFAULT_SCHEDULE_DURATION_SECONDS,
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
  selectScheduleEntriesForUser,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { LocalDate, ScheduleEntry, ScheduleOccurrence } from '@/lib/schedule/types';
import { useAppStore } from '@/lib/store';
import type { RecurringCommitmentInput } from '@/lib/planner/types';
import { plannerTaskDeadline } from '@/lib/planner/adapters';
import { toast } from 'sonner';

const WEEK_STARTS_ON = 1 as const;

function localDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd');
}

function intervalDates(
  date: LocalDate,
  startTime: string,
  endTime: string,
  timeZone: string,
): { startAt: string; endAt: string } | null {
  const startAt = localDateTimeToIso(date, startTime, timeZone);
  const endDate = endTime > startTime ? date : addLocalDays(date, 1);
  const endAt = localDateTimeToIso(endDate, endTime, timeZone);
  return startAt && endAt ? { startAt, endAt } : null;
}

function commitmentBlocks(
  commitments: readonly RecurringCommitmentInput[],
  dates: LocalDate[],
  timeZone: string,
): PlannerBlockView[] {
  return commitments.flatMap(commitment => {
    if (commitment.enabled === false) return [];
    return dates.flatMap(date => {
      const day = new Date(`${date}T12:00:00`).getDay();
      if (!commitment.daysOfWeek.includes(day)) return [];
      if (commitment.startDate && date < commitment.startDate) return [];
      if (commitment.endDate && date > commitment.endDate) return [];
      const interval = intervalDates(date, commitment.startTime, commitment.endTime, timeZone);
      if (!interval) return [];
      return [{
        id: `commitment:${commitment.id}@${date}`,
        title: commitment.title,
        startAt: interval.startAt,
        endAt: interval.endAt,
        color: commitment.color || '#0ea5e9',
        source: 'Calendar commitment',
        kind: commitment.kind === 'school' ? 'school' as const : 'commitment' as const,
        fixed: true,
        locked: true,
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
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const upsertTaskSchedule = useScheduleStore(state => state.upsertTaskSchedule);
  const moveOccurrence = useScheduleStore(state => state.moveOccurrence);
  const resizeOccurrence = useScheduleStore(state => state.resizeOccurrence);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const [storedEvents, setStoredEvents] = useState<StoredCalendarEvent[]>([]);

  useEffect(() => {
    const today = startOfDay(new Date());
    setWeekStart(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }));
    setSelectedDate(today);
  }, []);

  useEffect(() => {
    if (!userId) return;
    setActiveUser(userId, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, userId]);

  useEffect(() => {
    const refresh = () => setStoredEvents(readStoredCalendarEvents());
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('orderly-calendar-events-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('orderly-calendar-events-changed', refresh);
    };
  }, []);

  const plannerRecord = userId ? plannerUsers[userId] : null;
  const timeZone = plannerRecord?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
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
    return buildScheduleOccurrences({
      tasks,
      entries,
      subjects,
      startDate: weekDates[0],
      endDate: weekDates[6],
      timeZone,
    });
  }, [entries, subjects, tasks, timeZone, weekDates]);

  const fixedBlocks = useMemo(() => {
    if (weekDates.length !== 7) return [];
    const storedCommitments = storedEventsToCommitments(storedEvents, timeZone);
    const savedCommitments = plannerRecord?.commitments || [];
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
    return commitmentBlocks(
      [...schoolCommitments, ...savedCommitments, ...storedCommitments],
      weekDates,
      timeZone,
    );
  }, [plannerRecord, storedEvents, timeZone, weekDates]);

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

  const handleMove = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error('That would end after the task deadline', {
        description: `“${occurrence.title}” must be finished by ${format(new Date(deadline), 'MMM d, h:mm a')}.`,
      });
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
    const entry = entriesByTaskId.get(occurrence.taskId);
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds: Math.max(60, differenceInSeconds(nextEnd, nextStart)),
      });
      return;
    }
    moveOccurrence(
      userId,
      occurrence.taskId,
      occurrence.recurrenceSourceDate,
      nextDate,
      nextStart.toISOString(),
    );
  }, [entriesByTaskId, moveOccurrence, occurrenceById, timedBlocks, timeZone, upsertTaskSchedule, userId]);

  const handleResize = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error('That duration would run past the deadline');
      return;
    }
    const conflict = conflictingBlock(timedBlocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error('That duration overlaps another item', {
        description: `Shorten it so it does not overlap “${conflict.title}”.`,
      });
      return;
    }
    const durationSeconds = Math.max(60, differenceInSeconds(nextEnd, nextStart));
    const entry = entriesByTaskId.get(occurrence.taskId);
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceInput(entry, occurrence),
        durationSeconds,
      });
      return;
    }
    resizeOccurrence(
      userId,
      occurrence.taskId,
      occurrence.recurrenceSourceDate,
      durationSeconds,
    );
  }, [entriesByTaskId, occurrenceById, resizeOccurrence, timedBlocks, timeZone, upsertTaskSchedule, userId]);

  if (!weekStart) {
    return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">Loading schedule…</div>;
  }

  const goToToday = () => {
    const today = startOfDay(new Date());
    setWeekStart(startOfWeek(today, { weekStartsOn: WEEK_STARTS_ON }));
    setSelectedDate(today);
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-card/55 px-3 py-2 shadow-sm backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const next = addDays(weekStart, -7);
              setWeekStart(next);
              setSelectedDate(next);
            }}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={goToToday} className="h-8 px-2.5 text-xs">Today</Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              const next = addDays(weekStart, 7);
              setWeekStart(next);
              setSelectedDate(next);
            }}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="ml-1 min-w-0">
            <p className="truncate text-sm font-semibold sm:text-base">
              {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}
            </p>
            <p className="hidden text-[10px] text-muted-foreground sm:block">Drag timed tasks to move them · pull the bottom edge to resize</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />
          {occurrences.timed.length} timed · {occurrences.untimed.length} untimed
        </div>
      </div>

      <WeekTimeGrid
        weekStart={weekStart}
        blocks={timedBlocks}
        editable
        variant="fullscreen"
        viewportClassName="h-[calc(100dvh-13.5rem)] min-h-[560px]"
        showSummaryHeader={false}
        showUntimedShelf
        untimedItems={untimedItems}
        selectedDate={selectedDate || weekStart}
        onSelectedDateChange={setSelectedDate}
        onUntimedItemClick={item => item.taskId && setDetailOccurrenceId(item.id)}
        onBlockClick={block => block.taskId && setDetailOccurrenceId(block.id)}
        onBlockMove={handleMove}
        onBlockResize={handleResize}
        timeZoneLabel={timeZone}
        initialScrollHour={6}
      />

      <TaskDetailViewer
        task={detailTask}
        scheduleOccurrence={detailOccurrence}
        open={Boolean(detailTask)}
        onOpenChange={open => !open && setDetailOccurrenceId(null)}
      />
    </div>
  );
}
