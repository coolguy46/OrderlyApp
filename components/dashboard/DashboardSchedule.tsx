'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { differenceInMinutes, format } from 'date-fns';
import Link from 'next/link';
import { CalendarClock, ChevronLeft, ChevronRight, Clock3, ListTodo, LockKeyhole } from 'lucide-react';
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import { TaskForm } from '@/components/tasks/TaskForm';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  addLocalDays,
  buildScheduleOccurrences,
  formatIsoTime,
  localDateFromIso,
  localDateToDateCarrier,
  localDateTimeToIso,
  localMinuteOfDayFromIso,
  selectScheduleEntriesForUser,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { LocalDate, ScheduleOccurrence } from '@/lib/schedule/types';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  storedEventsToCommitments,
} from '@/lib/planner/adapters';
import { useStoredCalendarEvents } from '@/lib/planner/use-stored-calendar-events';
import { usePlannerStore } from '@/lib/planner/store';
import type { RecurringCommitmentInput } from '@/lib/planner/types';
import { buildCommitmentOccurrences } from '@/lib/planner/commitments';
import {
  DASHBOARD_SCHEDULE_HOUR_HEIGHT,
  dashboardScheduleCreationSlot,
  type DashboardScheduleCreationSlot,
} from './dashboard-schedule-slot';

const HOUR_HEIGHT = DASHBOARD_SCHEDULE_HOUR_HEIGHT;
const DAY_HEIGHT = 24 * HOUR_HEIGHT;

function durationLabel(seconds: number | null): string | null {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function taskColor(item: ScheduleOccurrence): string {
  return item.color || (item.task.priority === 'high' ? '#ef4444' : item.task.priority === 'low' ? '#22c55e' : '#6366f1');
}

function timeLabel(item: ScheduleOccurrence, timeZone: string): string {
  if (!item.startAt) return '';
  const start = formatIsoTime(item.startAt, timeZone);
  const end = item.endAt ? formatIsoTime(item.endAt, timeZone) : null;
  return `${start || ''}${end ? `–${end}` : ''}`;
}

interface DashboardFixedBlock {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  color: string;
  locked: boolean;
}

function commitmentBlocksForDate(
  commitments: readonly RecurringCommitmentInput[],
  date: string,
  timeZone: string,
): DashboardFixedBlock[] {
  return commitments.flatMap(commitment => {
    return buildCommitmentOccurrences(commitment, date, date).flatMap(occurrence => {
      const commitmentTimeZone = commitment.timeZone || timeZone;
      const startAt = localDateTimeToIso(occurrence.date, occurrence.startTime, commitmentTimeZone);
      const endDate = occurrence.endTime > occurrence.startTime
        ? occurrence.date
        : addLocalDays(occurrence.date, 1);
      const endAt = localDateTimeToIso(endDate, occurrence.endTime, commitmentTimeZone);
      if (!startAt || !endAt) return [];

      return [{
        id: occurrence.id,
        title: commitment.title,
        startAt,
        endAt,
        color: commitment.color || '#64748b',
        locked: commitment.kind === 'school',
      }];
    });
  });
}

export function DashboardSchedule() {
  const { tasks, subjects, user } = useAppStore();
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const userId = user?.id || null;
  const plannerRecord = userId ? plannerUsers[userId] : null;
  const timeZone = plannerRecord?.settings.timeZone
    || Intl.DateTimeFormat().resolvedOptions().timeZone
    || 'UTC';
  const [selectedDateKey, setSelectedDateKey] = useState<LocalDate>(() => (
    localDateFromIso(new Date().toISOString(), timeZone) || '1970-01-01'
  ));
  const [detailOccurrenceId, setDetailOccurrenceId] = useState<string | null>(null);
  const [creationSlot, setCreationSlot] = useState<(
    DashboardScheduleCreationSlot & { userId: string }
  ) | null>(null);
  const { events: storedEvents } = useStoredCalendarEvents(userId);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const selectedDate = localDateToDateCarrier(selectedDateKey) || new Date(1970, 0, 1, 12);
  const dateKey = selectedDateKey;

  useEffect(() => {
    if (!userId) return;
    setActiveUser(userId, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, userId]);

  useEffect(() => {
    const today = localDateFromIso(new Date().toISOString(), timeZone);
    if (!today) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedDateKey(today);
      setDetailOccurrenceId(null);
      setCreationSlot(null);
    });
    return () => { cancelled = true; };
  }, [timeZone, userId]);
  const entries = useMemo(
    () => selectScheduleEntriesForUser(entriesByUser, user?.id),
    [entriesByUser, user?.id],
  );
  const occurrences = useMemo(
    () => buildScheduleOccurrences({
      tasks,
      entries,
      subjects,
      startDate: dateKey,
      endDate: dateKey,
      timeZone,
      schoolHours: plannerRecord ? {
        schoolDays: plannerRecord.settings.schoolDays,
        schoolStartTime: plannerRecord.settings.schoolStartTime,
        schoolHomeTime: plannerRecord.settings.schoolHomeTime,
      } : undefined,
    }),
    [dateKey, entries, plannerRecord, subjects, tasks, timeZone],
  );
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
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
  const fixedBlocks = useMemo(() => {
    const savedCommitments = plannerRecord?.commitments || [];
    const storedCommitments = storedEventsToCommitments(storedEvents, timeZone);
    const schoolCommitments: RecurringCommitmentInput[] = plannerRecord ? [{
      id: 'dashboard-school-day',
      title: 'School day',
      kind: 'school',
      daysOfWeek: plannerRecord.settings.schoolDays,
      startTime: plannerRecord.settings.wakeTime,
      endTime: plannerRecord.settings.schoolHomeTime,
      timeZone,
      enabled: true,
      color: '#64748b',
    }] : [];
    return commitmentBlocksForDate(
      [...schoolCommitments, ...savedCommitments, ...storedCommitments],
      dateKey,
      timeZone,
    );
  }, [dateKey, plannerRecord, storedEvents, timeZone]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    scrollerRef.current.scrollTop = 7 * HOUR_HEIGHT;
  }, []);

  return (
    <Card className="overflow-hidden border-border/50">
      <CardHeader className="border-b border-border/40 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <div className="rounded-lg bg-indigo-500/15 p-1.5">
              <CalendarClock className="h-4 w-4 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <CardTitle className="truncate text-base font-display">{format(selectedDate, 'EEEE, MMM d')}</CardTitle>
              <p className="text-xs text-muted-foreground">
                {occurrences.timed.length} timed · {occurrences.untimed.length} untimed · {fixedBlocks.length} busy
              </p>
              <p className="mt-0.5 text-[10px] text-muted-foreground/75">
                Click an empty time to add a task or event.
              </p>
            </div>
            <div className="ml-1 flex items-center gap-0.5">
              <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7" onClick={() => setSelectedDateKey(current => addLocalDays(current, -1))} aria-label="Previous day">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => {
                  const today = localDateFromIso(new Date().toISOString(), timeZone);
                  if (today) setSelectedDateKey(today);
                }}
              >
                Today
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" className="h-7 w-7" onClick={() => setSelectedDateKey(current => addLocalDays(current, 1))} aria-label="Next day">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="h-8 text-xs">
            <Link href="/calendar?view=schedule">Open full schedule</Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex min-h-12 items-stretch border-b border-border/50 bg-muted/15">
          <div className="flex w-16 shrink-0 items-center justify-center gap-1 border-r border-border/50 px-1 text-[9px] text-muted-foreground">
            <ListTodo className="h-3 w-3" /> Untimed
          </div>
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto p-2">
            {occurrences.untimed.length === 0 ? (
              <p className="self-center text-[11px] text-muted-foreground/60">No untimed tasks for this day</p>
            ) : occurrences.untimed.map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setDetailOccurrenceId(item.id)}
                className="flex max-w-56 shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] transition-colors hover:bg-muted/60"
                style={{ borderColor: `${taskColor(item)}55`, backgroundColor: `${taskColor(item)}14` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: taskColor(item) }} />
                <span className="truncate font-medium">{item.title}</span>
                {durationLabel(item.durationSeconds) && <span className="text-muted-foreground">{durationLabel(item.durationSeconds)}</span>}
              </button>
            ))}
          </div>
        </div>

        <div ref={scrollerRef} className="relative h-[460px] overflow-y-auto overscroll-contain bg-card/20">
          <div className="relative grid grid-cols-[64px_minmax(0,1fr)]" style={{ height: DAY_HEIGHT }}>
            <div className="relative border-r border-border/50 bg-card/45">
              {Array.from({ length: 24 }, (_, hour) => (
                <span key={hour} className="absolute right-2 -translate-y-1/2 text-[9px] text-muted-foreground" style={{ top: hour * HOUR_HEIGHT }}>
                  {format(new Date(2000, 0, 1, hour), 'h a')}
                </span>
              ))}
            </div>
            <div
              className="relative cursor-crosshair"
              aria-label={`Create a task or event on ${format(selectedDate, 'EEEE, MMMM d')}`}
              onClick={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('[data-dashboard-schedule-block]')) return;
                if (!userId) return;
                setDetailOccurrenceId(null);
                const bounds = event.currentTarget.getBoundingClientRect();
                setCreationSlot({
                  ...dashboardScheduleCreationSlot(dateKey, event.clientY, bounds.top),
                  userId,
                });
              }}
            >
              {Array.from({ length: 25 }, (_, hour) => (
                <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-border/40" style={{ top: hour * HOUR_HEIGHT }} />
              ))}
              {occurrences.timed.map(item => {
                if (!item.startAt) return null;
                const start = new Date(item.startAt);
                const end = item.endAt ? new Date(item.endAt) : new Date(start.getTime() + 30 * 60_000);
                const startMinute = localMinuteOfDayFromIso(item.startAt, timeZone);
                if (startMinute === null) return null;
                const duration = Math.max(15, differenceInMinutes(end, start));
                const color = taskColor(item);
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-dashboard-schedule-block
                    onClick={(event) => {
                      event.stopPropagation();
                      setDetailOccurrenceId(item.id);
                    }}
                    className={cn(
                      'absolute left-2 right-2 overflow-hidden rounded-md border border-l-[3px] px-2 py-1 text-left shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-[0.995]',
                      item.task.status === 'completed' && 'opacity-50',
                    )}
                    style={{
                      top: (startMinute / 60) * HOUR_HEIGHT,
                      height: Math.max(24, (duration / 60) * HOUR_HEIGHT),
                      borderColor: `${color}77`,
                      borderLeftColor: color,
                      backgroundColor: `${color}22`,
                      zIndex: 10,
                    }}
                  >
                    <p className="truncate text-[11px] font-semibold">{item.title}</p>
                    <p className="truncate text-[9px] text-muted-foreground">{timeLabel(item, timeZone)}</p>
                  </button>
                );
              })}

              {fixedBlocks.map(item => {
                const start = new Date(item.startAt);
                const end = new Date(item.endAt);
                const startMinute = localMinuteOfDayFromIso(item.startAt, timeZone);
                if (startMinute === null) return null;
                const duration = Math.max(15, differenceInMinutes(end, start));
                const startLabel = formatIsoTime(item.startAt, timeZone) || '';
                const endLabel = formatIsoTime(item.endAt, timeZone) || '';
                return (
                  <div
                    key={item.id}
                    data-dashboard-schedule-block
                    className={cn(
                      'absolute left-2 right-2 overflow-hidden rounded-md border border-l-[3px] px-2 py-1 text-left shadow-sm',
                      item.locked && 'border-dashed',
                    )}
                    style={{
                      top: (startMinute / 60) * HOUR_HEIGHT,
                      height: Math.max(24, (duration / 60) * HOUR_HEIGHT),
                      borderColor: `${item.color}77`,
                      borderLeftColor: item.color,
                      backgroundColor: `${item.color}18`,
                      zIndex: 5,
                    }}
                    aria-label={`${item.title}, ${startLabel}–${endLabel}, busy`}
                  >
                    <p className="flex min-w-0 items-center gap-1 truncate text-[11px] font-semibold">
                      {item.locked && <LockKeyhole className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate">{item.title}</span>
                    </p>
                    <p className="truncate text-[9px] text-muted-foreground">
                      {startLabel}–{endLabel}
                    </p>
                  </div>
                );
              })}

              {occurrences.timed.length === 0 && fixedBlocks.length === 0 && (
                <div className="absolute inset-x-0 top-[38%] flex flex-col items-center justify-center text-center text-muted-foreground/60">
                  <Clock3 className="mb-2 h-6 w-6" />
                  <p className="text-xs">Nothing timed yet</p>
                  <p className="text-[10px]">Click an empty time to add a task or event.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>

      <TaskDetailViewer
        task={detailTask}
        scheduleOccurrence={detailOccurrence}
        open={Boolean(detailTask)}
        onOpenChange={open => !open && setDetailOccurrenceId(null)}
      />
      <TaskForm
        isOpen={Boolean(creationSlot && creationSlot.userId === userId)}
        initialMode="task"
        initialDate={creationSlot?.userId === userId ? creationSlot.date : ''}
        initialStartTime={creationSlot?.userId === userId ? creationSlot.startTime : ''}
        initialDurationSeconds={creationSlot?.userId === userId ? creationSlot.durationSeconds : null}
        onClose={() => setCreationSlot(null)}
      />
    </Card>
  );
}
