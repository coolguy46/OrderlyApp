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
  isToday,
  startOfDay,
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
import { TaskDetailViewer } from '@/components/tasks/TaskDetailViewer';
import { TaskForm } from '@/components/tasks/TaskForm';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { useAppStore } from '@/lib/store';
import type { Exam, Subject, Task } from '@/lib/supabase/types';
import {
  localTimeFromIso,
  selectScheduleEntriesForUser,
  taskDeadlineDate,
  taskUntimedDisplayDate,
  type TaskUntimedDisplayDateOptions,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { ScheduleEntry } from '@/lib/schedule/types';
import { getDefaultPlannerSettings } from '@/lib/planner/types';
import { usePlannerStore } from '@/lib/planner/store';
import { buildCommitmentOccurrences } from '@/lib/planner/commitments';
import { cn, isExamType } from '@/lib/utils';
import { hasMissingTaskOnDate, isTaskMissing, taskMissingDate } from '@/lib/task-status';
import { useCurrentTime } from '@/lib/use-current-time';

type TaskCalendarMode = 'week' | 'month';

interface TaskCalendarDay {
  tasks: Task[];
  exams: Exam[];
  events: CalendarEventItem[];
}

interface CalendarEventItem {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  color: string;
}

const WEEK_STARTS_ON = 1 as const;

function localDateKey(value: string | Date): string | null {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:$|T00:00:00(?:\.000)?Z?$)/.test(value)) {
    return value.slice(0, 10);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : format(parsed, 'yyyy-MM-dd');
}

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
  const missingDateKey = taskMissingDate(task, currentTime, displayOptions.timeZone);
  if (missingDateKey) return missingDateKey === dateKey;
  const dueDateKey = taskUntimedDisplayDate(task, displayOptions);
  if (dueDateKey === dateKey) return true;
  const recurrence = scheduleEntry?.recurrence || task.recurrence || 'none';
  if (recurrence === 'none' || task.status === 'completed') return false;
  if (scheduleEntry?.recurrenceEndDate && dateKey > scheduleEntry.recurrenceEndDate) return false;

  const anchorKey = dueDateKey || scheduleEntry?.scheduledDate || localDateKey(task.created_at);
  if (!anchorKey || startOfDay(date) < startOfDay(localDateFromKey(anchorKey))) return false;
  if (recurrence === 'daily') return true;
  if (recurrence === 'weekly') {
    const configuredDays = scheduleEntry?.recurrenceDays || task.recurrence_days || [];
    return configuredDays.length > 0
      ? configuredDays.includes(date.getDay())
      : date.getDay() === localDateFromKey(anchorKey).getDay();
  }
  return recurrence === 'monthly'
    && date.getDate() === localDateFromKey(anchorKey).getDate();
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
      className={cn(
        'group w-full overflow-hidden rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
          <p className={cn('truncate text-[11px] font-medium leading-tight', task.status === 'completed' && 'line-through')}>
            {task.title}
          </p>
          {(!compact || shifted || missing) && (subject || dueLabel) && (
            <p className={cn('mt-0.5 truncate text-[9px] text-muted-foreground', missing && 'font-medium text-red-400')}>
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
      className={cn('overflow-hidden rounded-md border px-2 py-1.5', compact && 'px-1.5 py-1')}
      style={{ borderColor: `${color}55`, backgroundColor: `${color}12` }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <GraduationCap className="mt-0.5 h-3 w-3 shrink-0" style={{ color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium leading-tight">{exam.title}</p>
          {!compact && subject && <p className="mt-0.5 truncate text-[9px] text-muted-foreground">{subject.name}</p>}
        </div>
      </div>
    </div>
  );
}

function EventChip({ event, compact = false }: { event: CalendarEventItem; compact?: boolean }) {
  const formatClock = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return format(new Date(2000, 0, 1, hours, minutes), 'h:mm a');
  };
  return (
    <div
      className={cn('overflow-hidden rounded-md border px-2 py-1.5', compact && 'px-1.5 py-1')}
      style={{ borderColor: `${event.color}70`, backgroundColor: `${event.color}18` }}
    >
      <div className="flex min-w-0 items-start gap-1.5">
        <CalendarClock className="mt-0.5 h-3 w-3 shrink-0" style={{ color: event.color }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium leading-tight">{event.title}</p>
          {!compact && (
            <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
              {formatClock(event.startTime)}–{formatClock(event.endTime)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function TaskCalendar() {
  const { tasks, exams, subjects, user } = useAppStore();
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const plannerUsers = usePlannerStore(state => state.users);
  const setActiveUser = usePlannerStore(state => state.setActiveUser);
  const [mounted, setMounted] = useState(false);
  const [currentDate, setCurrentDate] = useState<Date | null>(null);
  const [mode, setMode] = useState<TaskCalendarMode>('month');
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const now = useCurrentTime();

  useEffect(() => {
    setCurrentDate(new Date());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    setActiveUser(user.id, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, [setActiveUser, user?.id]);

  const plannerRecord = user?.id ? plannerUsers[user.id] : null;
  const commitments = plannerRecord?.commitments || [];
  const fallbackTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const plannerSettings = plannerRecord?.settings || getDefaultPlannerSettings(fallbackTimeZone);
  const timeZone = plannerSettings.timeZone;
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
  const detailTask = detailTaskId ? taskById.get(detailTaskId) || null : null;

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
        for (const occurrence of buildCommitmentOccurrences(commitment, firstVisibleDate, lastVisibleDate)) {
          const values = calendarEvents.get(occurrence.date) || [];
          values.push({
            id: occurrence.id,
            title: commitment.title,
            startTime: occurrence.startTime,
            endTime: occurrence.endTime,
            color: commitment.color || '#6366f1',
          });
          calendarEvents.set(occurrence.date, values);
        }
      }
    }
    for (const day of visibleDays) {
      const key = format(day, 'yyyy-MM-dd');
      const dayTasks = tasks
        .filter(task => taskOccursOn(task, day, scheduleByTaskId.get(task.id), displayOptions, now))
        .sort((left, right) => taskTimeSortValue(left, timeZone) - taskTimeSortValue(right, timeZone) || left.title.localeCompare(right.title));
      const dayExams = exams
        .filter(exam => localDateKey(exam.exam_date) === key)
        .sort((left, right) => left.exam_date.localeCompare(right.exam_date));
      const dayEvents = (calendarEvents.get(key) || [])
        .sort((left, right) => left.startTime.localeCompare(right.startTime) || left.title.localeCompare(right.title));
      result.set(key, { tasks: dayTasks, exams: dayExams, events: dayEvents });
    }
    return result;
  }, [commitments, displayOptions, exams, now, scheduleByTaskId, tasks, timeZone, visibleDays]);

  const navigate = (direction: -1 | 1) => {
    if (!currentDate) return;
    setCurrentDate(mode === 'month'
      ? (direction < 0 ? subMonths(currentDate, 1) : addMonths(currentDate, 1))
      : (direction < 0 ? subWeeks(currentDate, 1) : addWeeks(currentDate, 1)));
  };

  if (!mounted || !currentDate) {
    return <div className="flex min-h-[520px] items-center justify-center text-sm text-muted-foreground">Loading calendar…</div>;
  }

  const title = mode === 'month'
    ? format(currentDate, 'MMMM yyyy')
    : `${format(visibleDays[0], 'MMM d')}–${format(visibleDays[6], 'MMM d, yyyy')}`;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/50 bg-card/55 px-3 py-2 shadow-sm backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigate(-1)} aria-label={`Previous ${mode}`}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setCurrentDate(new Date())} className="h-8 px-2.5 text-xs">
            Today
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => navigate(1)} aria-label={`Next ${mode}`}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <p className="ml-1 truncate text-sm font-semibold sm:text-base">{title}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg bg-muted/50 p-0.5" role="group" aria-label="Task calendar range">
            {(['week', 'month'] as const).map(value => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                  mode === value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <Button type="button" size="sm" onClick={() => setTaskFormOpen(true)} className="h-8 px-2.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </Button>
        </div>
      </div>

      <Card className="min-h-0 overflow-hidden border-border/55 bg-card/40">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-7 border-b border-border/60 bg-card/80">
                {visibleDays.slice(0, 7).map(day => (
                  <div key={format(day, 'EEE')} className="border-r border-border/45 px-2 py-2 text-center last:border-r-0">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{format(day, 'EEE')}</p>
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
                    return (
                      <div
                        key={key}
                        className={cn(
                          'min-h-[128px] border-b border-r border-border/40 p-1.5 last:border-r-0',
                          !isSameMonth(day, currentDate) && 'bg-muted/[0.08] text-muted-foreground opacity-55',
                          isToday(day) && 'bg-primary/[0.035]',
                          hasMissingTasks && 'bg-red-500/[0.07] ring-1 ring-inset ring-red-500/35',
                        )}
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className={cn(
                            'flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                            isToday(day) && 'bg-primary text-primary-foreground shadow-sm',
                          )}>
                            {format(day, 'd')}
                          </span>
                          {allCount > 0 && <span className="text-[9px] text-muted-foreground">{allCount}</span>}
                        </div>
                        <div className="space-y-1">
                          {visibleEvents.map(event => <EventChip key={event.id} event={event} compact />)}
                          {visibleTasks.map(task => (
                            <TaskDeadlineChip key={task.id} task={task} subject={task.subject_id ? subjectById.get(task.subject_id) : undefined} compact displayDateKey={key} timeZone={timeZone} currentTime={now} onClick={() => setDetailTaskId(task.id)} />
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
                              className="rounded px-1 text-[9px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                    return (
                      <div key={key} className={cn(
                        'min-h-[calc(100dvh-15.5rem)] border-r border-border/45 p-2 last:border-r-0',
                        isToday(day) && 'bg-primary/[0.035]',
                        hasMissingTasks && 'bg-red-500/[0.07] ring-1 ring-inset ring-red-500/35',
                      )}>
                        <div className="mb-2 flex items-center justify-center">
                          <span className={cn('flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-sm font-semibold', isToday(day) && 'bg-primary text-primary-foreground shadow-sm')}>
                            {format(day, 'd')}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {items.events.map(event => <EventChip key={event.id} event={event} />)}
                          {items.tasks.map(task => (
                            <TaskDeadlineChip key={task.id} task={task} subject={task.subject_id ? subjectById.get(task.subject_id) : undefined} displayDateKey={key} timeZone={timeZone} currentTime={now} onClick={() => setDetailTaskId(task.id)} />
                          ))}
                          {items.exams.map(exam => (
                            <ExamDeadlineChip key={exam.id} exam={exam} subject={exam.subject_id ? subjectById.get(exam.subject_id) : undefined} />
                          ))}
                          {items.tasks.length === 0 && items.exams.length === 0 && items.events.length === 0 && (
                            <div className="flex min-h-24 flex-col items-center justify-center text-center text-[10px] text-muted-foreground/60">
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

      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="gap-1 text-[10px]"><CircleDot className="h-2.5 w-2.5" /> Task deadline</Badge>
        <Badge variant="outline" className="gap-1 text-[10px]"><GraduationCap className="h-2.5 w-2.5" /> Exam</Badge>
        <Badge variant="outline" className="gap-1 text-[10px]"><CalendarClock className="h-2.5 w-2.5" /> Event</Badge>
      </div>

      <TaskForm isOpen={taskFormOpen} onClose={() => setTaskFormOpen(false)} />
      <TaskDetailViewer task={detailTask} open={Boolean(detailTask)} onOpenChange={open => !open && setDetailTaskId(null)} />
    </div>
  );
}
