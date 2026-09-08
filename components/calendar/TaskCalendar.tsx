'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns';
import {
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  GraduationCap,
  Plus,
} from 'lucide-react';
import { TaskForm } from '@/components/tasks/TaskForm';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { useAppStore } from '@/lib/store';
import type { Exam, Subject, Task } from '@/lib/supabase/types';
import {
  buildScheduleOccurrences,
  addLocalDays,
  localDateFromIso,
  localTimeFromIso,
  selectScheduleEntriesForUser,
  taskDeadlineDate,
  taskUntimedDisplayDate,
  type TaskUntimedDisplayDateOptions,
} from '@/lib/schedule/selectors';
import { civilDateFromStored } from '@/lib/civil-date';
import { useScheduleStore } from '@/lib/schedule/store';
import type { ScheduleEntry } from '@/lib/schedule/types';
import { getDefaultPlannerSettings, type RecurringCommitmentInput } from '@/lib/planner/types';
import { storedEventsToCommitments, writeStoredCalendarEvents } from '@/lib/planner/adapters';
import { useStoredCalendarEvents } from '@/lib/planner/use-stored-calendar-events';
import { usePlannerStore } from '@/lib/planner/store';
import { toast } from 'sonner';
import { visibleCommitmentOccurrences } from '@/lib/schedule/visible-intervals';
import { cn, isExamType } from '@/lib/utils';
import { hasMissingTaskOnDate, isTaskMissing, taskMissingDate } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';
import { useHydrated } from '@/lib/use-hydrated';

export type TaskCalendarMode = 'week' | 'month';

interface TaskCalendarDay {
  tasks: Task[];
  exams: Exam[];
  events: CalendarEventItem[];
}

interface CalendarEventItem {
  ownerId: string;
  commitment: RecurringCommitmentInput;
  sourceDate: string;
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  color: string;
}

const WEEK_STARTS_ON = 1 as const;

function localDateFromKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function taskOccursOn(
  task: Task,
  date: Date,
  scheduleEntry: ScheduleEntry | undefined,
  displayOptions: TaskUntimedDisplayDateOptions,
  currentTime: Date,
): boolean {
  const dateKey = format(date, 'yyyy-MM-dd');
  const recurrence = scheduleEntry?.recurrence || task.recurrence || 'none';
  if (recurrence !== 'none' && task.status !== 'completed') {
    const occurrences = buildScheduleOccurrences({ tasks: [task], entries: scheduleEntry ? [scheduleEntry] : [],
      startDate: dateKey, endDate: dateKey, timeZone: displayOptions.timeZone });
    return occurrences.timed.length + occurrences.untimed.length > 0;
  }
  const missingDateKey = taskMissingDate(task, currentTime, displayOptions.timeZone);
  if (missingDateKey) return missingDateKey === dateKey;
  const dueDateKey = taskUntimedDisplayDate(task, displayOptions) || scheduleEntry?.scheduledDate;
  if (dueDateKey === dateKey) return true;
  return false;
}

function taskTimeLabel(task: Task, timeZone?: string): string | null {
  if (task.due_time && /^\d{2}:\d{2}/.test(task.due_time)) {
    const [hours, minutes] = task.due_time.split(':').map(Number);
    return format(new Date(2000, 0, 1, hours, minutes), 'h:mm a');
  }
  if (task.due_date && task.due_date.includes('T') && task.source !== 'manual') {
    const localTime = localTimeFromIso(task.due_date, timeZone);
    if (localTime) {
      const [hours, minutes] = localTime.split(':').map(Number);
      return format(new Date(2000, 0, 1, hours, minutes), 'h:mm a');
    }
  }
  return null;
}

function taskTimeSortValue(task: Task, timeZone?: string): number {
  if (task.due_time && /^\d{2}:\d{2}/.test(task.due_time)) {
    const [hours, minutes] = task.due_time.split(':').map(Number);
    return hours * 60 + minutes;
  }
  if (task.due_date && task.due_date.includes('T') && task.source !== 'manual') {
    const localTime = localTimeFromIso(task.due_date, timeZone);
    if (localTime) {
      const [hours, minutes] = localTime.split(':').map(Number);
      return hours * 60 + minutes;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

function priorityColor(task: Task): string {
  if (task.priority === 'high') return '#ef4444';
  if (task.priority === 'low') return '#22c55e';
  return '#f59e0b';
}

function TaskDeadlineChip({
  task,
  subject,
  compact = false,
  displayDateKey,
  timeZone,
  currentTime,
  onClick,
}: {
  task: Task;
  subject?: Subject;
  compact?: boolean;
  displayDateKey: string;
  timeZone: string;
  currentTime: Date;
  onClick: () => void;
}) {
  const missing = isTaskMissing(task, currentTime, timeZone);
  const color = missing ? '#ef4444' : subject?.color || priorityColor(task);
  const taskIsExam = isExamType(task.title, task.assignment_type);
  const time = taskTimeLabel(task, timeZone);
  const actualDueDate = taskDeadlineDate(task, timeZone);
  const shifted = Boolean(actualDueDate && actualDueDate !== displayDateKey);
  const dueLabel = missing
    ? 'Overdue'
    : shifted && actualDueDate
      ? `Due ${format(localDateFromKey(actualDueDate), 'EEE')}${time ? ` ${time}` : ''}`
      : time;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      title={[task.title, subject?.name, dueLabel].filter(Boolean).join(' · ')}
      className={cn(
        'group w-full overflow-hidden rounded-md border px-2 py-2 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        task.status === 'completed' && 'opacity-55',
        missing && 'border-red-500/70 bg-red-500/15',
        compact && 'px-1.5 py-1',
      )}
      style={{ borderColor: `${color}55`, backgroundColor: `${color}12` }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        {taskIsExam ? (
          <GraduationCap className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
        ) : (
          <CircleDot className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
        )}
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs font-medium leading-snug', compact ? 'truncate text-[11px]' : 'line-clamp-2 break-words', task.status === 'completed' && 'line-through')}>
            {task.title}
          </p>
          {(!compact || shifted || missing) && (subject || dueLabel) && (
            <p className={cn('mt-1 truncate text-[11px] text-muted-foreground', compact && 'mt-0.5 text-[10px]', missing && 'font-medium text-red-400')}>
              {[subject?.name, dueLabel].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function ExamDeadlineChip({ exam, subject, compact = false }: { exam: Exam; subject?: Subject; compact?: boolean }) {
  const color = subject?.color || '#a855f7';
  return (
    <div
      className={cn('overflow-hidden rounded-md border px-2 py-2', compact && 'px-1.5 py-1')}
      title={[exam.title, subject?.name].filter(Boolean).join(' · ')}
      style={{ borderColor: `${color}55`, backgroundColor: `${color}12` }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <GraduationCap className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs font-medium leading-snug', compact ? 'truncate text-[11px]' : 'line-clamp-2 break-words')}>{exam.title}</p>
          {!compact && subject && <p className="mt-1 truncate text-[11px] text-muted-foreground">{subject.name}</p>}
        </div>
      </div>
    </div>
  );
}

function EventChip({ event, compact = false, onClick }: { event: CalendarEventItem; compact?: boolean; onClick: () => void }) {
  const formatClock = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return format(new Date(2000, 0, 1, hours, minutes), 'h:mm a');
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={event.commitment.kind === 'school' ? `${event.title} — managed in Settings` : `Edit event ${event.title}`}
      title={event.commitment.kind === 'school' ? 'School hours are managed in Settings' : `${event.title} · ${formatClock(event.startTime)}–${formatClock(event.endTime)}`}
      disabled={event.commitment.kind === 'school'}
      className={cn('w-full overflow-hidden rounded-md border px-2 py-2 text-left hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', compact && 'px-1.5 py-1')}
      style={{ borderColor: `${event.color}70`, backgroundColor: `${event.color}18` }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" style={{ color: event.color }} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-xs font-medium leading-snug', compact ? 'truncate text-[11px]' : 'line-clamp-2 break-words')}>{event.title}</p>
          {!compact && (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {formatClock(event.startTime)}–{formatClock(event.endTime)}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

export function TaskCalendar({ date: controlledDate, onDateChange, mode: controlledMode, onModeChange }: {
  date?: Date;
  onDateChange?: (date: Date) => void;
  mode?: TaskCalendarMode;
  onModeChange?: (mode: TaskCalendarMode) => void;
} = {}) {
  const { tasks, exams, subjects, user } = useAppStore();
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const mounted = useHydrated();
  const [internalDate, setInternalDate] = useState<Date | null>(null);
  const currentDate = controlledDate ?? internalDate;
  const setCurrentDate = (date: Date) => {
    setInternalDate(date);
    onDateChange?.(date);
  };
  const [currentDateTimeZone, setCurrentDateTimeZone] = useState<string | null>(null);
  const [internalMode, setInternalMode] = useState<TaskCalendarMode>('month');
  const mode = controlledMode ?? internalMode;
  const setMode = (next: TaskCalendarMode) => {
    setInternalMode(next);
    onModeChange?.(next);
  };
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskDate, setEditingTaskDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(null);
  const { events: storedEvents, setEvents: setStoredEvents } = useStoredCalendarEvents(user?.id || null);
  const now = useCurrentTime();

  useEffect(() => {
    if (!user?.id) return;
    setActiveUser(user.id, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, user?.id]);

  const plannerRecord = user?.id ? plannerUsers[user.id] : null;
  const commitments = useMemo(
    () => [...(plannerRecord?.commitments || []), ...storedEventsToCommitments(storedEvents, plannerRecord?.settings.timeZone || 'UTC', plannerRecord?.commitments)],
    [plannerRecord?.commitments, plannerRecord?.settings.timeZone, storedEvents],
  );
  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const plannerSettings = plannerRecord?.settings || getDefaultPlannerSettings(fallbackTimeZone);
  const timeZone = plannerSettings.timeZone;
  const todayKey = localDateFromIso(now.toISOString(), timeZone);

  if (mounted && todayKey && currentDateTimeZone !== timeZone) {
    setInternalDate(localDateFromKey(todayKey));
    setCurrentDateTimeZone(timeZone);
  }

  const displayOptions = useMemo<TaskUntimedDisplayDateOptions>(() => ({
    timeZone,
    schoolDays: plannerSettings.schoolDays,
    schoolStartTime: plannerSettings.schoolStartTime,
    schoolHomeTime: plannerSettings.schoolHomeTime,
  }), [plannerSettings.schoolDays, plannerSettings.schoolHomeTime, plannerSettings.schoolStartTime, timeZone]);

  const subjectById = useMemo(
    () => new Map(subjects.map(subject => [subject.id, subject])),
    [subjects],
  );
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
  const scheduleEntries = useMemo(
    () => selectScheduleEntriesForUser(entriesByUser, user?.id),
    [entriesByUser, user?.id],
  );
  const scheduleByTaskId = useMemo(
    () => new Map(scheduleEntries.map(entry => [entry.taskId, entry])),
    [scheduleEntries],
  );
  const editingTask = editingTaskId ? taskById.get(editingTaskId) || null : null;

  const visibleDays = useMemo(() => {
    if (!currentDate) return [];
    if (mode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: WEEK_STARTS_ON });
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    const monthStart = startOfMonth(currentDate);
    const start = startOfWeek(monthStart, { weekStartsOn: WEEK_STARTS_ON });
    const end = endOfWeek(endOfMonth(monthStart), { weekStartsOn: WEEK_STARTS_ON });
    const days: Date[] = [];
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) days.push(cursor);
    return days;
  }, [currentDate, mode]);

  const itemsByDate = useMemo(() => {
    const result = new Map<string, TaskCalendarDay>();
    const firstVisibleDate = visibleDays[0] ? format(visibleDays[0], 'yyyy-MM-dd') : null;
    const lastVisibleDate = visibleDays.length > 0 ? format(visibleDays[visibleDays.length - 1], 'yyyy-MM-dd') : null;
    const calendarEvents = new Map<string, CalendarEventItem[]>();
    if (firstVisibleDate && lastVisibleDate) {
      for (const commitment of commitments) {
        for (const occurrence of visibleCommitmentOccurrences(commitment, firstVisibleDate, lastVisibleDate, timeZone)) {
          const firstDay = localDateFromIso(occurrence.startAt, timeZone);
          const lastDay = localDateFromIso(new Date(new Date(occurrence.endAt).getTime() - 1).toISOString(), timeZone);
          if (!firstDay || !lastDay) continue;
          for (let date = firstDay < firstVisibleDate ? firstVisibleDate : firstDay; date <= lastDay && date <= lastVisibleDate; date = addLocalDays(date, 1)) {
            const values = calendarEvents.get(date) || [];
            values.push({
              ownerId: user?.id || '',
              id: occurrence.id,
              commitment,
              sourceDate: occurrence.sourceDate,
              title: occurrence.title,
              startTime: localTimeFromIso(occurrence.startAt, timeZone) || occurrence.startTime,
              endTime: localTimeFromIso(occurrence.endAt, timeZone) || occurrence.endTime,
              color: commitment.color || '#6366f1',
            });
            calendarEvents.set(date, values);
          }
        }
      }
    }
    for (const day of visibleDays) {
      const key = format(day, 'yyyy-MM-dd');
      const dayTasks = tasks
        .filter(task => taskOccursOn(task, day, scheduleByTaskId.get(task.id), displayOptions, now))
        .map(task => {
          const entry = scheduleByTaskId.get(task.id);
          if (!entry || task.recurrence === 'none' || task.status === 'completed') return task;
          const occurrences = buildScheduleOccurrences({ tasks: [task], entries: [entry], startDate: key, endDate: key, timeZone });
          const occurrence = [...occurrences.timed, ...occurrences.untimed][0];
          return occurrence ? { ...task, title: occurrence.title, description: occurrence.description } : task;
        })
        .sort((left, right) => taskTimeSortValue(left, timeZone) - taskTimeSortValue(right, timeZone) || left.title.localeCompare(right.title));
      const dayExams = exams
        .filter(exam => civilDateFromStored(exam.exam_date, timeZone) === key)
        .sort((left, right) => left.exam_date.localeCompare(right.exam_date));
      const dayEvents = (calendarEvents.get(key) || [])
        .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.title.localeCompare(right.title));
      result.set(key, { tasks: dayTasks, exams: dayExams, events: dayEvents });
    }
    return result;
  }, [commitments, displayOptions, exams, now, scheduleByTaskId, tasks, timeZone, visibleDays, user?.id]);

  const navigate = (direction: -1 | 1) => {
    if (!currentDate) return;
    setCurrentDate(mode === 'month'
      ? (direction < 0 ? subMonths(currentDate, 1) : addMonths(currentDate, 1))
      : (direction < 0 ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1)));
  };

  const openNewTaskForm = () => {
    setEditingEvent(null);
    setEditingTaskId(null);
    setTaskFormOpen(true);
  };

  const openTaskEditor = (taskId: string, date: string) => {
    setEditingEvent(null);
    const task = taskById.get(taskId);
    const entry = scheduleByTaskId.get(taskId);
    const occurrences = task ? buildScheduleOccurrences({ tasks: [task], entries: entry ? [entry] : [], startDate: date, endDate: date, timeZone }) : null;
    setEditingTaskDate(occurrences ? [...occurrences.timed, ...occurrences.untimed][0]?.recurrenceSourceDate || date : date);
    setEditingTaskId(taskId);
    setTaskFormOpen(true);
  };

  const closeTaskForm = () => {
    setEditingEvent(null);
    setTaskFormOpen(false);
    setEditingTaskId(null);
  };

  const openEventEditor = (event: CalendarEventItem) => {
    if (event.commitment.kind === 'school') return;
    setEditingTaskId(null);
    setEditingEvent(event);
    setTaskFormOpen(true);
  };

  if (!mounted || !currentDate) {
    return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">Loading calendar…</div>;
  }

  const title = mode === 'month'
    ? format(currentDate, 'MMMM yyyy')
    : `${format(visibleDays[0], 'MMM d')}–${format(visibleDays[6], 'MMM d, yyyy')}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-4">
      <div className="workspace-toolbar flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 max-w-full items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigate(-1)} aria-label={`Previous ${mode}`}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => todayKey && setCurrentDate(localDateFromKey(todayKey))}
            className="h-9 px-2.5 text-sm"
          >
            Today
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigate(1)} aria-label={`Next ${mode}`}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <p className="ml-2 min-w-0 text-sm font-semibold leading-snug sm:text-base">{title}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border/70 bg-muted/30 p-0.5" role="group" aria-label="Task calendar range">
            {(['week', 'month'] as const).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                aria-pressed={mode === value}
                className={cn(
                  'min-h-8 rounded-md px-3 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" onClick={openNewTaskForm} className="h-9 px-3 text-sm" aria-label="New">
            <Plus className="h-3.5 w-3.5" />
            <span>New</span>
          </Button>
        </div>
      </div>

      <Card className="workspace-panel min-h-0 overflow-hidden">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-7 border-b border-border bg-muted/30">
                {visibleDays.slice(0, 7).map(day => (
                  <div key={format(day, 'EEE')} className="border-r border-border/60 px-2 py-3 text-center last:border-r-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{format(day, 'EEE')}</p>
                  </div>
                ))}
              </div>

              {mode === 'month' ? (
                <div className="grid grid-cols-7">
                  {visibleDays.map(day => {
                    const key = format(day, 'yyyy-MM-dd');
                    const items = itemsByDate.get(key) || { tasks: [], exams: [], events: [] };
                    const allCount = items.tasks.length + items.exams.length + items.events.length;
                    const visibleEvents = items.events.slice(0, 2);
                    const visibleTasks = items.tasks.slice(0, Math.max(0, 4 - visibleEvents.length));
                    const visibleExams = items.exams.slice(0, Math.max(0, 4 - visibleEvents.length - visibleTasks.length));
                    const shown = visibleTasks.length + visibleExams.length + visibleEvents.length;
                    const hasMissingTasks = hasMissingTaskOnDate(tasks, key, now, timeZone);
                    const isPlannerToday = key === todayKey;
                    return (
                      <div
                        key={key}
                        className={cn(
                          'min-h-[140px] border-b border-r border-border/60 p-2.5 last:border-r-0',
                          !isSameMonth(day, currentDate) && 'bg-muted/[0.08] text-muted-foreground opacity-55',
                          isPlannerToday && 'bg-primary/[0.035]',
                          hasMissingTasks && 'bg-red-500/[0.07] ring-1 ring-inset ring-red-500/35',
                        )}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <button type="button" onClick={() => setCurrentDate(day)} aria-label={`Select ${format(day, 'EEEE, MMMM d, yyyy')}`} aria-pressed={key === format(currentDate, 'yyyy-MM-dd')} className={cn(
                            'flex h-7 min-w-7 items-center justify-center rounded-full px-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            isPlannerToday && 'bg-primary text-primary-foreground shadow-sm',
                            key === format(currentDate, 'yyyy-MM-dd') && 'ring-2 ring-primary/60',
                          )}>
                            {format(day, 'd')}
                          </button>
                          {allCount > 0 && <span className="text-[10px] text-muted-foreground">{allCount}</span>}
                        </div>
                        <div className="space-y-1">
                          {visibleEvents.map(event => <EventChip key={event.id} event={event} compact onClick={() => openEventEditor(event)} />)}
                          {visibleTasks.map(task => (
                            <TaskDeadlineChip key={task.id} task={task} subject={task.subject_id ? subjectById.get(task.subject_id) : undefined} compact displayDateKey={key} timeZone={timeZone} currentTime={now} onClick={() => openTaskEditor(task.id, key)} />
                          ))}
                          {visibleExams.map(exam => (
                            <ExamDeadlineChip key={exam.id} exam={exam} subject={exam.subject_id ? subjectById.get(exam.subject_id) : undefined} compact />
                          ))}
                          {allCount > shown && (
                            <button
                              type="button"
                              onClick={() => {
                                setCurrentDate(day);
                                setMode('week');
                              }}
                              className="min-h-6 rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              +{allCount - shown} more
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-7">
                  {visibleDays.map(day => {
                    const key = format(day, 'yyyy-MM-dd');
                    const items = itemsByDate.get(key) || { tasks: [], exams: [], events: [] };
                    const hasMissingTasks = hasMissingTaskOnDate(tasks, key, now, timeZone);
                    const isPlannerToday = key === todayKey;
                    return (
                      <div key={key} className={cn(
                        'min-h-[calc(100dvh-19rem)] border-r border-border/60 p-2.5 last:border-r-0',
                        isPlannerToday && 'bg-primary/[0.035]',
                        hasMissingTasks && 'bg-red-500/[0.07] ring-1 ring-inset ring-red-500/35',
                      )}>
                        <div className="mb-2 flex items-center justify-center">
                          <button type="button" onClick={() => setCurrentDate(day)} aria-label={`Select ${format(day, 'EEEE, MMMM d, yyyy')}`} aria-pressed={key === format(currentDate, 'yyyy-MM-dd')} className={cn('flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold', isPlannerToday && 'bg-primary text-primary-foreground shadow-sm', key === format(currentDate, 'yyyy-MM-dd') && 'ring-2 ring-primary/60')}>
                            {format(day, 'd')}
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {items.events.map(event => <EventChip key={event.id} event={event} onClick={() => openEventEditor(event)} />)}
                          {items.tasks.map(task => (
                            <TaskDeadlineChip key={task.id} task={task} subject={task.subject_id ? subjectById.get(task.subject_id) : undefined} displayDateKey={key} timeZone={timeZone} currentTime={now} onClick={() => openTaskEditor(task.id, key)} />
                          ))}
                          {items.exams.map(exam => (
                            <ExamDeadlineChip key={exam.id} exam={exam} subject={exam.subject_id ? subjectById.get(exam.subject_id) : undefined} />
                          ))}
                          {items.tasks.length === 0 && items.exams.length === 0 && items.events.length === 0 && (
                            <div className="flex min-h-24 flex-col items-center justify-center text-center text-[11px] text-muted-foreground/70">
                              <CalendarDays className="mb-1 h-4 w-4" />
                              Nothing to handle
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground" aria-label="Calendar legend">
        <span className="inline-flex items-center gap-1.5"><CircleDot className="h-3 w-3" /> Task deadline</span>
        <span className="inline-flex items-center gap-1.5"><GraduationCap className="h-3 w-3" /> Exam</span>
        <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-3 w-3" /> Event</span>
      </div>

      <TaskForm
        isOpen={taskFormOpen && (!editingEvent || editingEvent.ownerId === user?.id)}
        onClose={closeTaskForm}
        task={editingTask}
        commitment={editingEvent?.ownerId === user?.id ? editingEvent?.commitment : null}
        occurrenceDate={editingEvent?.sourceDate || editingTaskDate}
        initialDate={format(currentDate, 'yyyy-MM-dd')}
        onSaved={() => {
          if (!user?.id || editingEvent?.ownerId !== user.id || useAppStore.getState().user?.id !== user.id || !editingEvent?.commitment.id.startsWith('calendar-')) return;
          const next = storedEvents.filter(event => event.id !== editingEvent.commitment.id.slice('calendar-'.length));
          if (writeStoredCalendarEvents(user.id, next)) setStoredEvents(next);
          else toast.warning('The event was saved, but its old browser copy could not be removed. The backup has been kept.');
        }}
      />
    </div>
  );
}
