'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
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
import {
  readStoredCalendarEvents,
  plannerTaskDeadline,
  storedEventsToCommitments,
  type StoredCalendarEvent,
  writeStoredCalendarEvents,
} from '@/lib/planner/adapters';
import {
  buildCommitmentOccurrences,
  withCommitmentOccurrenceOverride,
} from '@/lib/planner/commitments';
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
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
  selectScheduleEntriesForUser,
  taskDeadlineDate,
} from '@/lib/schedule/selectors';
import { useScheduleStore } from '@/lib/schedule/store';
import type { LocalDate, ScheduleEntry, ScheduleOccurrence } from '@/lib/schedule/types';
import type { Task } from '@/lib/supabase/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';
import type { UntimedScheduleItem } from '@/components/schedule/UntimedTaskShelf';

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
  'Find a 45-minute gap for chemistry tomorrow',
];

function localDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd');
}

function dateCarrierInTimeZone(timeZone: string, instant = new Date()): Date {
  const date = localDateFromIso(instant.toISOString(), timeZone);
  if (!date) return startOfDay(instant);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
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

function calendarRenderData(
  events: readonly StoredCalendarEvent[],
  startDate: LocalDate,
  endDate: LocalDate,
  timeZone: string,
): CalendarRenderData {
  const blocks: PlannerBlockView[] = [];
  const busy: ScheduleCommandBusyInterval[] = [];
  const eventById = new Map(events.map(event => [event.id, event]));
  for (const commitment of storedEventsToCommitments(events, timeZone)) {
    const eventId = commitment.id.slice('calendar-'.length);
    const event = eventById.get(eventId);
    if (!event) continue;
    for (const occurrence of buildCommitmentOccurrences(commitment, startDate, endDate)) {
      const startAt = localDateTimeToIso(occurrence.date, `${occurrence.startTime}:00`, timeZone);
      const intervalEndDate = occurrence.endTime > occurrence.startTime
        ? occurrence.date
        : addLocalDays(occurrence.date, 1);
      const endAt = localDateTimeToIso(intervalEndDate, `${occurrence.endTime}:00`, timeZone);
      if (!endAt) continue;
      if (!startAt) continue;
      const id = occurrence.id;
      busy.push({ id, title: event.title, startAt, endAt });
      blocks.push({
        id,
        title: event.title,
        description: event.description || null,
        startAt,
        endAt,
        color: event.color || '#0ea5e9',
        kind: 'event',
        commitmentId: commitment.id,
        calendarEventId: event.id,
        occurrenceDate: occurrence.sourceDate,
        fixed: false,
        locked: false,
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
    const commitmentTimeZone = commitment.timeZone || timeZone;
    for (const occurrence of buildCommitmentOccurrences(commitment, startDate, endDate)) {
      const startAt = localDateTimeToIso(occurrence.date, `${occurrence.startTime}:00`, commitmentTimeZone);
      const endDateForInterval = occurrence.endTime > occurrence.startTime
        ? occurrence.date
        : addLocalDays(occurrence.date, 1);
      const endAt = localDateTimeToIso(endDateForInterval, `${occurrence.endTime}:00`, commitmentTimeZone);
      if (!startAt || !endAt) continue;
      const id = occurrence.id;
      const school = commitment.kind === 'school';
      busy.push({ id, title: commitment.title, startAt, endAt });
      blocks.push({
        id,
        title: commitment.title,
        startAt,
        endAt,
        color: commitment.color || '#64748b',
        kind: school ? 'school' : 'commitment',
        commitmentId: commitment.id,
        occurrenceDate: occurrence.sourceDate,
        fixed: school,
        locked: school,
        source: school ? 'School availability' : 'Commitment',
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

function occurrenceScheduleInput(entry: ScheduleEntry | undefined, occurrence: ScheduleOccurrence) {
  return {
    scheduledDate: occurrence.date,
    startAt: occurrence.startAt,
    durationSeconds: occurrence.durationSeconds || 30 * 60,
    recurrence: entry?.recurrence || occurrence.recurrence,
    recurrenceDays: entry?.recurrenceDays || occurrence.task.recurrence_days,
    recurrenceEndDate: entry?.recurrenceEndDate || null,
  };
}

export function Planner() {
  const { user, tasks, subjects, addTask, deleteTask } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const upsertCommitment = usePlannerStore(state => state.upsertCommitment);
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const applyScheduleBatch = useScheduleStore(state => state.applyScheduleBatch);
  const replaceUserSchedules = useScheduleStore(state => state.replaceUserSchedules);
  const moveOccurrence = useScheduleStore(state => state.moveOccurrence);
  const resizeOccurrence = useScheduleStore(state => state.resizeOccurrence);
  const upsertTaskSchedule = useScheduleStore(state => state.upsertTaskSchedule);
  const setOccurrenceOverride = useScheduleStore(state => state.setOccurrenceOverride);

  const userId = user?.id || null;
  const browserTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const plannerRecord = userId ? plannerUsers[userId] : null;
  const plannerSettings = plannerRecord?.settings || getDefaultPlannerSettings(browserTimeZone);
  const timeZone = plannerSettings.timeZone;
  const commitments = useMemo(
    () => [schoolCommitment(plannerSettings), ...(plannerRecord?.commitments || [])],
    [plannerRecord?.commitments, plannerSettings],
  );
  const [weekStart, setWeekStart] = useState(() => startOfWeek(dateCarrierInTimeZone(timeZone), { weekStartsOn: 1 }));
  const [selectedDate, setSelectedDate] = useState(() => dateCarrierInTimeZone(timeZone));
  const [storedEvents, setStoredEvents] = useState<StoredCalendarEvent[]>([]);
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<ScheduleCommandPreview | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const commandInputRef = useRef<HTMLTextAreaElement>(null);

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

  useEffect(() => {
    const today = dateCarrierInTimeZone(timeZone);
    setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
    setSelectedDate(today);
  }, [timeZone]);

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
    schoolHours: {
      schoolDays: plannerSettings.schoolDays,
      schoolStartTime: plannerSettings.schoolStartTime,
      schoolHomeTime: plannerSettings.schoolHomeTime,
    },
  }), [entries, plannerSettings.schoolDays, plannerSettings.schoolHomeTime, plannerSettings.schoolStartTime, subjects, tasks, timeZone, weekEndDate, weekStartDate]);
  const plannerToday = dateCarrierInTimeZone(timeZone);
  const commandStartDate = localDate(addDays(plannerToday, -7));
  const commandEndDate = localDate(addDays(plannerToday, 60));
  const commandOccurrences = useMemo(() => buildScheduleOccurrences({
    tasks,
    entries,
    subjects,
    startDate: commandStartDate,
    endDate: commandEndDate,
    timeZone,
    schoolHours: {
      schoolDays: plannerSettings.schoolDays,
      schoolStartTime: plannerSettings.schoolStartTime,
      schoolHomeTime: plannerSettings.schoolHomeTime,
    },
  }), [commandEndDate, commandStartDate, entries, plannerSettings.schoolDays, plannerSettings.schoolHomeTime, plannerSettings.schoolStartTime, subjects, tasks, timeZone]);
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
  const commitmentById = useMemo(() => new Map([
    ...commitments,
    ...storedEventsToCommitments(storedEvents, timeZone),
  ].map(commitment => [commitment.id, commitment])), [commitments, storedEvents, timeZone]);
  const occurrenceById = useMemo(() => new Map(
    [...occurrences.timed, ...occurrences.untimed]
      .map(occurrence => [occurrence.id, occurrence] as const),
  ), [occurrences.timed, occurrences.untimed]);
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

  const prepareCommand = useCallback((value: string, taskId: string | null = null) => {
    setSelectedTaskId(taskId);
    setCommand(value);
    setPreview(null);
    window.requestAnimationFrame(() => {
      commandInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      commandInputRef.current?.focus();
    });
  }, []);

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

  const persistCommitmentOccurrence = useCallback((
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
      setStoredEvents(nextEvents);
      writeStoredCalendarEvents(nextEvents);
    } else {
      upsertCommitment(userId, updated);
    }
    return true;
  }, [commitmentById, storedEvents, timeZone, upsertCommitment, userId]);

  const handleMove = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That time overlaps “${conflict.title}”.`);
      return;
    }
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      if (persistCommitmentOccurrence(block, nextStart, nextEnd)) toast.success(`${block.title} moved`);
      return;
    }
    const task = occurrence.task;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error(`That would put “${task.title}” after its deadline.`);
      return;
    }
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const entry = entries.find(item => item.taskId === task.id);
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Move “${task.title}”` });
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, task.id, {
        ...occurrenceScheduleInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds: Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000)),
      });
    } else {
      moveOccurrence(userId, task.id, occurrence.recurrenceSourceDate, nextDate, nextStart.toISOString());
    }
  }, [blocks, entries, moveOccurrence, occurrenceById, persistCommitmentOccurrence, timeZone, upsertTaskSchedule, userId]);

  const handleResize = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId) return;
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That duration overlaps “${conflict.title}”.`);
      return;
    }
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      if (persistCommitmentOccurrence(block, nextStart, nextEnd)) toast.success(`${block.title} updated`);
      return;
    }
    const task = occurrence.task;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error(`That duration would run past “${task.title}”’s deadline.`);
      return;
    }
    const durationSeconds = Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000));
    const entry = entries.find(item => item.taskId === task.id);
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Resize “${task.title}”` });
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, task.id, {
        ...occurrenceScheduleInput(entry, occurrence),
        durationSeconds,
      });
    } else {
      resizeOccurrence(userId, task.id, occurrence.recurrenceSourceDate, durationSeconds);
    }
  }, [blocks, entries, occurrenceById, persistCommitmentOccurrence, resizeOccurrence, timeZone, upsertTaskSchedule, userId]);

  const handleScheduleUntimed = useCallback((
    item: UntimedScheduleItem,
    nextStart: Date,
    nextEnd: Date,
  ) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(item.id);
    if (!occurrence) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.error(`That would put “${occurrence.title}” after its deadline.`);
      return;
    }
    const conflict = conflictingBlock(blocks, item.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That time overlaps “${conflict.title}”. Choose a free slot.`);
      return;
    }
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const entry = entries.find(candidate => candidate.taskId === occurrence.taskId);
    const durationSeconds = Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000));
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Schedule “${occurrence.title}”` });
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
        ...occurrenceScheduleInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: nextStart.toISOString(),
        durationSeconds,
      });
    }
    toast.success(`${occurrence.title} scheduled`);
  }, [blocks, entries, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

  const handleMoveToUntimed = useCallback((block: PlannerBlockView) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence?.startAt) return;
    const entry = entries.find(candidate => candidate.taskId === occurrence.taskId);
    const durationSeconds = occurrence.durationSeconds || 30 * 60;
    setUndoState({ entries: cloneEntries(entries), createdTaskIds: [], label: `Move “${occurrence.title}” to untimed` });
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
        scheduledDate: occurrence.date,
        startAt: null,
        durationSeconds,
      });
    } else {
      upsertTaskSchedule(userId, occurrence.taskId, {
        ...occurrenceScheduleInput(entry, occurrence),
        scheduledDate: occurrence.date,
        startAt: null,
        durationSeconds,
      });
    }
    toast.success(`${occurrence.title} moved to untimed`);
  }, [entries, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

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
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Assistant</h1>
            <p className="text-sm text-muted-foreground">Describe a change, review it, then fine-tune it on the calendar.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {undoState && (
            <Button type="button" variant="outline" size="sm" onClick={() => void undo()}>
              <Undo2 className="h-4 w-4" /> Undo
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const today = dateCarrierInTimeZone(timeZone);
              setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
              setSelectedDate(today);
            }}
          >
            Today
          </Button>
        </div>
      </header>

      <Card className="overflow-hidden border-primary/20">
        <CardHeader className="border-b border-border/40 px-5 pb-4 pt-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle>What would you like to change?</CardTitle>
          </div>
          <p className="text-xs text-muted-foreground">Ask Orderly to add, move, repeat, resize, or find time. Nothing changes until you approve the preview.</p>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5 pt-4">
          {messages.length > 0 && (
            <div aria-live="polite" className="max-h-36 space-y-2 overflow-y-auto rounded-xl bg-muted/30 p-3">
              {messages.slice(-4).map(message => (
                <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  <p className={cn(
                    'max-w-[88%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                    message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-background/80 text-foreground',
                  )}>
                    {message.text}
                  </p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea
              ref={commandInputRef}
              value={command}
              onChange={event => {
                setCommand(event.target.value);
                setPreview(null);
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submitCommand();
                }
              }}
              placeholder="Example: Move chemistry to tomorrow at 4 pm"
              className="min-h-16 resize-none"
              aria-label="Schedule request"
            />
            <Button type="button" onClick={() => submitCommand()} disabled={!command.trim()} className="sm:h-16 sm:px-6">
              <Send className="h-4 w-4" /> Preview
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-medium text-muted-foreground">Try:</span>
            {EXAMPLES.map(example => (
              <button
                key={example}
                type="button"
                onClick={() => prepareCommand(example)}
                className="rounded-full border border-border/60 bg-background/40 px-2.5 py-1 text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>

          {preview && (
            <div
              aria-live="polite"
              className={cn(
                'rounded-xl border p-4',
                preview.status === 'ready' ? 'border-primary/40 bg-primary/5' : 'border-amber-500/30 bg-amber-500/5',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Review before applying</p>
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
                <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
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
                    Apply changes
                  </Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0">
          <Card>
            <CardHeader className="flex-row items-center justify-between px-4 pb-3 pt-4">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <CardTitle>{format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}</CardTitle>
                  <p className="mt-1 truncate text-xs text-muted-foreground">Drag tasks onto the calendar, then move or resize anything except school.</p>
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
                viewportClassName="h-[680px]"
                showSummaryHeader={false}
                timeZone={timeZone}
                timeZoneLabel={timeZone.split('/').pop()?.replace('_', ' ') || 'Local'}
                selectedDate={selectedDate}
                onSelectedDateChange={selectDay}
                onBlockMove={handleMove}
                onBlockResize={handleResize}
                onBlockMoveToUntimed={handleMoveToUntimed}
                untimedItems={untimedItems}
                showUntimedShelf
                onUntimedItemClick={item => prepareCommand(`Schedule ${item.title} `, item.taskId || null)}
                onUntimedItemSchedule={handleScheduleUntimed}
              />
            </CardContent>
          </Card>
        </main>

        <aside className="min-w-0 self-start xl:sticky xl:top-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between px-4 pb-3 pt-4">
              <div>
                <CardTitle>{format(selectedDate, 'EEEE, MMM d')}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">{selectedDayOccurrences.length} item{selectedDayOccurrences.length === 1 ? '' : 's'} on this day</p>
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
            <CardContent className="px-4 pb-4">
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {selectedDayOccurrences.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Nothing scheduled for this day.</p>
                ) : selectedDayOccurrences.map(occurrence => (
                  <button
                    key={occurrence.id}
                    type="button"
                    onClick={() => prepareCommand(`Move ${occurrence.title} to `, occurrence.taskId)}
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
              </div>

              <div className="my-4 border-t border-border/50" />

              <div className="mb-3">
                <p className="text-sm font-semibold">Tasks to schedule</p>
                <p className="mt-1 text-xs text-muted-foreground">{unscheduledTasks.length} task{unscheduledTasks.length === 1 ? '' : 's'} without a time</p>
              </div>
              <div className="max-h-[340px] space-y-2 overflow-y-auto">
                {unscheduledTasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">Every pending task has schedule details.</p>
                ) : unscheduledTasks.map(task => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => prepareCommand(`Schedule ${task.title} `, task.id)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-accent/40',
                      selectedTaskId === task.id ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-background/30',
                    )}
                  >
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="mt-1 truncate text-[11px] text-muted-foreground">{taskSubtitle(task, timeZone)}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
