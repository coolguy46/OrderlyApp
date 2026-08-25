'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMinutes,
  format,
  isSameDay,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Send,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { readStoredCalendarEvents, plannerTaskDeadline, type StoredCalendarEvent } from '@/lib/planner/adapters';
import { usePlannerStore } from '@/lib/planner/store';
import { getDefaultPlannerSettings, type PlannerSettings, type RecurringCommitmentInput } from '@/lib/planner/types';
import {
  interpretScheduleCommand,
  type ScheduleCommandBusyInterval,
  type ScheduleCommandContext,
  type ScheduleCommandPreview,
} from '@/lib/schedule/commands';
import {
  addLocalDays,
  buildScheduleOccurrences,
  localDateTimeToIso,
  localTimeFromIso,
  selectScheduleEntriesForUser,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { LocalDate, ScheduleEntry, ScheduleOccurrence } from '@/lib/schedule/types';
import type { Task } from '@/lib/supabase/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';

interface ConversationMessage {
  id: string;
  role: 'assistant' | 'user';
  text: string;
}

interface UndoState {
  entries: ScheduleEntry[];
  createdTaskIds: string[];
  label: string;
}

interface CalendarRenderData {
  blocks: PlannerBlockView[];
  busy: ScheduleCommandBusyInterval[];
}

const EXAMPLES = [
  'Schedule chemistry tomorrow at 4 pm for 45 minutes',
  'Study for SAT for 2 hours every day for a week',
  'Move chemistry to next next Saturday at 10 am',
  'Find the best time for chemistry tomorrow for 45 minutes',
];

function localDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd');
}

function dateFromLocal(value: LocalDate): Date {
  return new Date(`${value}T12:00:00`);
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return 'No duration';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function timeLabel(value: string | null, timeZone: string): string {
  if (!value) return 'Untimed';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Untimed';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function cloneEntries(entries: readonly ScheduleEntry[]): ScheduleEntry[] {
  return entries.map(entry => ({
    ...entry,
    recurrenceDays: entry.recurrenceDays ? [...entry.recurrenceDays] : null,
    occurrenceOverrides: Object.fromEntries(Object.entries(entry.occurrenceOverrides).map(([date, override]) => [
      date,
      { ...override },
    ])),
  }));
}

function eventDates(event: StoredCalendarEvent, startDate: LocalDate, endDate: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
    if (date < event.date) continue;
    const day = dateFromLocal(date).getDay();
    const anchorDay = dateFromLocal(event.date).getDay();
    const occurs = !event.recurrence || event.recurrence === 'none'
      ? date === event.date
      : event.recurrence === 'daily'
        ? true
        : event.recurrence === 'weekdays'
          ? day >= 1 && day <= 5
          : day === anchorDay;
    if (occurs) dates.push(date);
  }
  return dates;
}

function calendarRenderData(
  events: readonly StoredCalendarEvent[],
  startDate: LocalDate,
  endDate: LocalDate,
  timeZone: string,
): CalendarRenderData {
  const blocks: PlannerBlockView[] = [];
  const busy: ScheduleCommandBusyInterval[] = [];
  for (const event of events) {
    if (!event.id || !event.title || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) continue;
    const startTime = /^\d{2}:\d{2}$/.test(event.time || '') ? event.time! : '09:00';
    const defaultEnd = format(addMinutes(new Date(`2000-01-01T${startTime}:00`), 60), 'HH:mm');
    const endTime = /^\d{2}:\d{2}$/.test(event.endTime || '') && event.endTime !== startTime
      ? event.endTime!
      : defaultEnd;
    for (const date of eventDates(event, startDate, endDate)) {
      const startAt = localDateTimeToIso(date, `${startTime}:00`, timeZone);
      let endAt = localDateTimeToIso(date, `${endTime}:00`, timeZone);
      if (!startAt || !endAt) continue;
      if (new Date(endAt) <= new Date(startAt)) {
        endAt = localDateTimeToIso(addLocalDays(date, 1), `${endTime}:00`, timeZone);
      }
      if (!endAt) continue;
      const id = `calendar:${event.id}@${date}`;
      busy.push({ id, title: event.title, startAt, endAt });
      blocks.push({
        id,
        title: event.title,
        description: event.description || null,
        startAt,
        endAt,
        color: event.color || '#0ea5e9',
        kind: 'event',
        fixed: true,
        locked: true,
        source: 'Calendar',
      });
    }
  }
  return { blocks, busy };
}

function commitmentRenderData(
  commitments: readonly RecurringCommitmentInput[],
  startDate: LocalDate,
  endDate: LocalDate,
  timeZone: string,
): CalendarRenderData {
  const blocks: PlannerBlockView[] = [];
  const busy: ScheduleCommandBusyInterval[] = [];
  for (const commitment of commitments) {
    if (commitment.enabled === false) continue;
    for (let date = startDate; date <= endDate; date = addLocalDays(date, 1)) {
      const day = dateFromLocal(date).getDay();
      if (!commitment.daysOfWeek.includes(day)) continue;
      if (commitment.startDate && date < commitment.startDate) continue;
      if (commitment.endDate && date > commitment.endDate) continue;
      const startAt = localDateTimeToIso(date, `${commitment.startTime}:00`, timeZone);
      const endDateForInterval = commitment.endTime > commitment.startTime ? date : addLocalDays(date, 1);
      const endAt = localDateTimeToIso(endDateForInterval, `${commitment.endTime}:00`, timeZone);
      if (!startAt || !endAt) continue;
      const id = `commitment:${commitment.id}@${date}`;
      busy.push({ id, title: commitment.title, startAt, endAt });
      blocks.push({
        id,
        title: commitment.title,
        startAt,
        endAt,
        color: commitment.color || '#64748b',
        kind: commitment.kind === 'school' ? 'school' : 'commitment',
        fixed: true,
        locked: true,
        source: commitment.kind === 'school' ? 'School availability' : 'Commitment',
      });
    }
  }
  return { blocks, busy };
}

function schoolCommitment(settings: PlannerSettings): RecurringCommitmentInput {
  return {
    id: 'assistant-school-day',
    title: `School day (starts ${settings.schoolStartTime})`,
    kind: 'school',
    daysOfWeek: settings.schoolDays,
    startTime: settings.wakeTime,
    endTime: settings.schoolHomeTime,
    timeZone: settings.timeZone,
    enabled: true,
    color: '#64748b',
  };
}

function occurrenceBlocks(occurrences: readonly ScheduleOccurrence[]): PlannerBlockView[] {
  return occurrences.flatMap(occurrence => {
    if (!occurrence.startAt || !occurrence.endAt) return [];
    return [{
      id: occurrence.id,
      title: occurrence.title,
      description: occurrence.description,
      startAt: occurrence.startAt,
      endAt: occurrence.endAt,
      subjectName: occurrence.subject?.name || occurrence.task.course_name || null,
      subjectColor: occurrence.color || '#6366f1',
      source: occurrence.task.source || 'manual',
      kind: 'task' as const,
      taskId: occurrence.taskId,
      completed: occurrence.task.status === 'completed',
      reason: occurrence.recurrence === 'none' ? 'Scheduled task' : `Repeats ${occurrence.recurrence}`,
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

function taskSubtitle(task: Task, timeZone: string): string {
  const deadline = plannerTaskDeadline(task, timeZone);
  if (!deadline) return task.course_name || 'No due date';
  return `Due ${new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(deadline))}`;
}

function occurrenceDeadline(occurrence: ScheduleOccurrence, timeZone: string): string | null {
  if (occurrence.recurrence === 'none') return plannerTaskDeadline(occurrence.task, timeZone);
  let dueTime = occurrence.task.due_time || '23:59';
  if (!occurrence.task.due_time && occurrence.task.due_date && occurrence.task.source && occurrence.task.source !== 'manual') {
    dueTime = localTimeFromIso(occurrence.task.due_date, timeZone) || dueTime;
  }
  return localDateTimeToIso(occurrence.recurrenceSourceDate, `${dueTime}:00`, timeZone);
}

export function Planner() {
  const { user, tasks, subjects, addTask, deleteTask } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const applyScheduleBatch = useScheduleStore(state => state.applyScheduleBatch);
  const replaceUserSchedules = useScheduleStore(state => state.replaceUserSchedules);
  const moveOccurrence = useScheduleStore(state => state.moveOccurrence);
  const resizeOccurrence = useScheduleStore(state => state.resizeOccurrence);

  const userId = user?.id || null;
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const plannerRecord = userId ? plannerUsers[userId] : null;
  const plannerSettings = plannerRecord?.settings || getDefaultPlannerSettings(timeZone);
  const commitments = useMemo(
    () => [schoolCommitment(plannerSettings), ...(plannerRecord?.commitments || [])],
    [plannerRecord?.commitments, plannerSettings],
  );
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [storedEvents, setStoredEvents] = useState<StoredCalendarEvent[]>([]);
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<ScheduleCommandPreview | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([{
    id: 'welcome',
    role: 'assistant',
    text: 'Tell me what to add, move, repeat, resize, unschedule, or when you need a free gap. I will always show a preview before changing your calendar.',
  }]);

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

  const entries = useMemo(
    () => selectScheduleEntriesForUser(entriesByUser, userId),
    [entriesByUser, userId],
  );
  const pendingTasks = useMemo(() => tasks.filter(task => task.status !== 'completed'), [tasks]);
  const weekStartDate = localDate(weekStart);
  const weekEndDate = localDate(addDays(weekStart, 6));
  const occurrences = useMemo(() => buildScheduleOccurrences({
    tasks,
    entries,
    subjects,
    startDate: weekStartDate,
    endDate: weekEndDate,
    timeZone,
  }), [entries, subjects, tasks, timeZone, weekEndDate, weekStartDate]);
  const commandStartDate = localDate(addDays(startOfDay(new Date()), -7));
  const commandEndDate = localDate(addDays(startOfDay(new Date()), 60));
  const commandOccurrences = useMemo(() => buildScheduleOccurrences({
    tasks,
    entries,
    subjects,
    startDate: commandStartDate,
    endDate: commandEndDate,
    timeZone,
  }), [commandEndDate, commandStartDate, entries, subjects, tasks, timeZone]);
  const visibleEvents = useMemo(
    () => calendarRenderData(storedEvents, weekStartDate, weekEndDate, timeZone),
    [storedEvents, timeZone, weekEndDate, weekStartDate],
  );
  const commandEvents = useMemo(
    () => calendarRenderData(storedEvents, commandStartDate, commandEndDate, timeZone),
    [commandEndDate, commandStartDate, storedEvents, timeZone],
  );
  const visibleCommitments = useMemo(
    () => commitmentRenderData(commitments, weekStartDate, weekEndDate, timeZone),
    [commitments, timeZone, weekEndDate, weekStartDate],
  );
  const commandCommitments = useMemo(
    () => commitmentRenderData(commitments, commandStartDate, commandEndDate, timeZone),
    [commandEndDate, commandStartDate, commitments, timeZone],
  );
  const blocks = useMemo(
    () => [...visibleCommitments.blocks, ...visibleEvents.blocks, ...occurrenceBlocks(occurrences.timed)],
    [occurrences.timed, visibleCommitments.blocks, visibleEvents.blocks],
  );
  const untimedItems = useMemo(() => occurrences.untimed.map(occurrence => ({
    id: occurrence.id,
    taskId: occurrence.taskId,
    title: occurrence.title,
    date: occurrence.date,
    durationSeconds: occurrence.durationSeconds,
    color: occurrence.color || '#6366f1',
    completed: occurrence.task.status === 'completed',
  })), [occurrences.untimed]);

  const context = useMemo<ScheduleCommandContext>(() => ({
    now: new Date().toISOString(),
    timeZone,
    tasks: pendingTasks,
    entries,
    occurrences: [...commandOccurrences.timed, ...commandOccurrences.untimed],
    busy: [...commandCommitments.busy, ...commandEvents.busy],
    selectedTaskId,
    selectedDate: localDate(selectedDate),
    availableStartTime: plannerSettings.weekendAvailableStart,
    availableEndTime: plannerSettings.bedtime,
  }), [commandCommitments.busy, commandEvents.busy, commandOccurrences.timed, commandOccurrences.untimed, entries, pendingTasks, plannerSettings.bedtime, plannerSettings.weekendAvailableStart, selectedDate, selectedTaskId, timeZone]);

  const selectedDayOccurrences = useMemo(
    () => [...occurrences.timed, ...occurrences.untimed]
      .filter(occurrence => occurrence.date === localDate(selectedDate))
      .sort((left, right) => (left.startAt || '').localeCompare(right.startAt || '') || left.title.localeCompare(right.title)),
    [occurrences.timed, occurrences.untimed, selectedDate],
  );
  const unscheduledTasks = useMemo(() => {
    const scheduled = new Set(entries.map(entry => entry.taskId));
    return pendingTasks.filter(task => !scheduled.has(task.id)).slice(0, 10);
  }, [entries, pendingTasks]);

  const selectDay = useCallback((next: Date) => {
    const normalized = startOfDay(next);
    setSelectedDate(normalized);
    const start = startOfWeek(normalized, { weekStartsOn: 1 });
    if (!isSameDay(start, weekStart)) setWeekStart(start);
  }, [weekStart]);

  const submitCommand = useCallback((value = command, taskId = selectedTaskId) => {
    const normalized = value.trim();
    if (!normalized) return;
    const nextPreview = interpretScheduleCommand(normalized, { ...context, selectedTaskId: taskId });
    setPreview(nextPreview);
    setCommand(normalized);
    setMessages(previous => [
      ...previous,
      { id: `user-${Date.now()}`, role: 'user', text: normalized },
      { id: `assistant-${Date.now() + 1}`, role: 'assistant', text: nextPreview.summary },
    ].slice(-8) as ConversationMessage[]);
  }, [command, context, selectedTaskId]);

  const applyPreview = useCallback(async () => {
    if (!userId || !preview || preview.status !== 'ready' || preview.actions.length === 0) return;
    const before = cloneEntries(entries);
    const createdTaskIds: string[] = [];
    setApplying(true);
    try {
      for (const action of preview.actions) {
        if (action.type === 'schedule_batch') {
          applyScheduleBatch(userId, action.operations);
          continue;
        }
        const created = await addTask({
          user_id: userId,
          subject_id: null,
          title: action.title,
          description: action.description,
          priority: 'medium',
          status: 'pending',
          due_date: null,
          due_time: null,
          recurrence: action.schedule.recurrence || 'none',
          recurrence_days: action.schedule.recurrence === 'weekly'
            ? action.schedule.recurrenceDays || null
            : null,
          completed_at: null,
          source: 'manual',
        });
        if (!created) throw new Error('The task could not be created.');
        createdTaskIds.push(created.id);
        applyScheduleBatch(userId, [{ type: 'upsert', taskId: created.id, input: action.schedule }]);
      }
      setUndoState({ entries: before, createdTaskIds, label: preview.summary });
      setMessages(previous => [...previous, {
        id: `applied-${Date.now()}`,
        role: 'assistant',
        text: `Applied: ${preview.summary}`,
      }].slice(-8) as ConversationMessage[]);
      toast.success('Schedule updated');
      setPreview(null);
      setCommand('');
      setSelectedTaskId(null);
    } catch (error) {
      for (const id of createdTaskIds) await deleteTask(id);
      replaceUserSchedules(userId, before);
      toast.error(error instanceof Error ? error.message : 'Could not update the schedule');
    } finally {
      setApplying(false);
    }
  }, [addTask, applyScheduleBatch, deleteTask, entries, preview, replaceUserSchedules, userId]);

  const undo = useCallback(async () => {
    if (!userId || !undoState) return;
    for (const taskId of undoState.createdTaskIds) await deleteTask(taskId);
    replaceUserSchedules(userId, cloneEntries(undoState.entries));
    setMessages(previous => [...previous, {
      id: `undo-${Date.now()}`,
      role: 'assistant',
      text: `Undid: ${undoState.label}`,
    }].slice(-8) as ConversationMessage[]);
    setUndoState(null);
    toast.success('Last schedule change undone');
  }, [deleteTask, replaceUserSchedules, undoState, userId]);

  const handleMove = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId || !block.taskId) return;
    const occurrence = occurrences.timed.find(item => item.id === block.id);
    const task = tasks.find(item => item.id === block.taskId);
    if (!occurrence || !task) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error(`That would put “${task.title}” after its deadline.`);
      return;
    }
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That time overlaps “${conflict.title}”.`);
      return;
    }
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Move “${task.title}”` });
    moveOccurrence(userId, task.id, occurrence.recurrenceSourceDate, localDate(nextStart), nextStart.toISOString());
  }, [blocks, entries, moveOccurrence, occurrences.timed, tasks, timeZone, userId]);

  const handleResize = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId || !block.taskId) return;
    const occurrence = occurrences.timed.find(item => item.id === block.id);
    const task = tasks.find(item => item.id === block.taskId);
    if (!occurrence || !task) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error(`That duration would run past “${task.title}”’s deadline.`);
      return;
    }
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That duration overlaps “${conflict.title}”.`);
      return;
    }
    const durationSeconds = Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000));
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Resize “${task.title}”` });
    resizeOccurrence(userId, task.id, occurrence.recurrenceSourceDate, durationSeconds);
  }, [blocks, entries, occurrences.timed, resizeOccurrence, tasks, timeZone, userId]);

  if (!userId) {
    return (
      <Card className="mx-auto mt-16 max-w-xl">
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Sign in to use the Schedule Assistant.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Schedule Assistant</h1>
              <p className="text-sm text-muted-foreground">Deterministic commands. Every change is previewed first.</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {undoState && (
            <Button type="button" variant="outline" size="sm" onClick={() => void undo()}>
              <Undo2 className="h-4 w-4" /> Undo last change
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const today = startOfDay(new Date());
              setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
              setSelectedDate(today);
            }}
          >
            Today
          </Button>
        </div>
      </header>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between px-4 pb-3 pt-4">
              <div>
                <CardTitle>{format(selectedDate, 'EEEE, MMM d')}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{selectedDayOccurrences.length} scheduled item{selectedDayOccurrences.length === 1 ? '' : 's'}</p>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => selectDay(addDays(selectedDate, -1))} aria-label="Previous day">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => selectDay(addDays(selectedDate, 1))} aria-label="Next day">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 px-4 pb-4">
              {selectedDayOccurrences.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Nothing scheduled for this day.</p>
              ) : selectedDayOccurrences.map(occurrence => (
                <button
                  key={occurrence.id}
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(occurrence.taskId);
                    setCommand(`Move ${occurrence.title} to `);
                  }}
                  className="w-full rounded-lg border border-border/60 bg-background/40 p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: occurrence.color || '#6366f1' }} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{occurrence.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {timeLabel(occurrence.startAt, timeZone)} · {formatDuration(occurrence.durationSeconds)}
                      </p>
                      {occurrence.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">{occurrence.description.replace(/<[^>]*>/g, ' ')}</p>}
                    </div>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pb-3 pt-4">
              <CardTitle>Tasks to schedule</CardTitle>
              <p className="text-xs text-muted-foreground">Canvas and Orderly tasks without a saved schedule</p>
            </CardHeader>
            <CardContent className="max-h-[420px] space-y-2 overflow-y-auto px-4 pb-4">
              {unscheduledTasks.length === 0 ? (
                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Every pending task has schedule details.</p>
              ) : unscheduledTasks.map(task => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    setSelectedTaskId(task.id);
                    setCommand(`Schedule ${task.title} `);
                  }}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40',
                    selectedTaskId === task.id ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-background/30',
                  )}
                >
                  <p className="truncate text-sm font-medium">{task.title}</p>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{taskSubtitle(task, timeZone)}</p>
                </button>
              ))}
            </CardContent>
          </Card>
        </aside>

        <main className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between px-4 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" />
                <div>
                  <CardTitle>{format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Drag a task to move it. Drag its bottom edge to change duration.</p>
                </div>
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setWeekStart(previous => addDays(previous, -7))} aria-label="Previous week">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setWeekStart(previous => addDays(previous, 7))} aria-label="Next week">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <WeekTimeGrid
                weekStart={weekStart}
                blocks={blocks}
                editable
                viewportClassName="h-[620px]"
                showSummaryHeader={false}
                timeZoneLabel={timeZone.split('/').pop()?.replace('_', ' ') || 'Local'}
                selectedDate={selectedDate}
                onSelectedDateChange={selectDay}
                onBlockMove={handleMove}
                onBlockResize={handleResize}
                untimedItems={untimedItems}
                showUntimedShelf
                onUntimedItemClick={item => {
                  if (item.taskId) setSelectedTaskId(item.taskId);
                  setCommand(`Schedule ${item.title} `);
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="px-4 pb-3 pt-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle>Tell Orderly what to change</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4">
              <div className="max-h-52 space-y-2 overflow-y-auto rounded-xl border border-border/50 bg-background/30 p-3">
                {messages.map(message => (
                  <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <p className={cn(
                      'max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                      message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                    )}>
                      {message.text}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {EXAMPLES.map(example => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setCommand(example)}
                    className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {example}
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-2">
                <Textarea
                  value={command}
                  onChange={event => setCommand(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      submitCommand();
                    }
                  }}
                  placeholder="Try: Study for SAT for 2 hours every day for a week"
                  className="min-h-20 resize-none"
                />
                <Button type="button" size="icon" onClick={() => submitCommand()} disabled={!command.trim()} aria-label="Preview command">
                  <Send className="h-4 w-4" />
                </Button>
              </div>

              {preview && (
                <div className={cn(
                  'rounded-xl border p-4',
                  preview.status === 'ready' ? 'border-primary/40 bg-primary/5' : 'border-amber-500/30 bg-amber-500/5',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview · {preview.kind || 'command'}</p>
                      <p className="mt-1 text-sm font-medium">{preview.summary}</p>
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setPreview(null)} aria-label="Close preview">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {preview.assumptions.length > 0 && (
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {preview.assumptions.map(assumption => <li key={assumption}>• {assumption}</li>)}
                    </ul>
                  )}

                  {preview.candidates.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {preview.candidates.map(candidate => (
                        <Button
                          key={candidate.taskId}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedTaskId(candidate.taskId);
                            submitCommand(preview.command, candidate.taskId);
                          }}
                        >
                          {candidate.title}
                        </Button>
                      ))}
                    </div>
                  )}

                  {preview.gaps.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {preview.gaps.map(gap => (
                        <span key={gap.startAt} className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-1.5">
                          {gap.date} · {gap.label}
                        </span>
                      ))}
                    </div>
                  )}

                  {preview.occurrences.length > 0 && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {preview.occurrences.map((occurrence, index) => (
                        <div key={`${occurrence.date}-${index}`} className="rounded-lg border border-border/50 bg-background/50 p-2.5 text-xs">
                          <p className="truncate font-medium">{occurrence.title}</p>
                          <p className="mt-1 text-muted-foreground">
                            {occurrence.date} · {timeLabel(occurrence.startAt, timeZone)} · {formatDuration(occurrence.durationSeconds)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setPreview(null)}>
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                    {preview.status === 'ready' && preview.actions.length > 0 && (
                      <Button type="button" size="sm" onClick={() => void applyPreview()} disabled={applying}>
                        {applying ? <RotateCcw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Apply
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  );
}
