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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Maximize2,
  Minimize2,
  Sparkles,
  Undo2,
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
  interpretScheduleCommands,
  type ScheduleCommandBusyInterval,
  type ScheduleCommandContext,
  type ScheduleCommandPreview,
} from '@/lib/schedule/commands';
import { recoverExplicitRangeFromFalseSchoolConflict } from '@/lib/schedule/assistant-command-fallback';
import {
  addLocalDays,
  buildScheduleOccurrences,
  isLocalDate,
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
import { cn } from '@/lib/utils';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';
import { AssistantChat } from '@/components/planner/assistant/AssistantChat';
import type { UntimedScheduleItem } from '@/components/schedule/UntimedTaskShelf';

interface ConversationMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

interface AssistantChatResponse {
  reply: string;
  normalizedCommands: string[];
  usage: {
    remainingDaily: number;
    remainingMonthly: number;
  } | null;
  aiUsed: boolean;
}

interface UndoState {
  userId: string;
  entries: ScheduleEntry[];
  createdTaskIds: string[];
  label: string;
}

interface CalendarRenderData {
  blocks: PlannerBlockView[];
  busy: ScheduleCommandBusyInterval[];
}

const EXAMPLES = [
  'How does my week look?',
  'When am I busiest this week?',
  'Find a 45-minute gap for chemistry tomorrow',
];

const CHAT_CONTEXT_LIMIT = 14;
const CHAT_DISPLAY_LIMIT = 50;
const CHAT_STORAGE_LIMIT = 20;
const CHAT_STORAGE_CHARACTER_LIMIT = 20_000;
const CHAT_TIMEOUT_MS = 25_000;
const CHAT_STORAGE_PREFIX = 'orderly:assistant-chat:v2:';
const LEGACY_CHAT_STORAGE_PREFIX = 'orderly:assistant-chat:v1:';
const DRAFT_STORAGE_PREFIX = 'orderly:assistant-calendar-draft:v2:';
const LEGACY_DRAFT_STORAGE_PREFIX = 'orderly:assistant-calendar-draft:v1:';

interface StoredAssistantDraft {
  commands: string[];
  validatedLocalDate: LocalDate;
}

function assistantChatStorageKey(userId: string): string {
  return `${CHAT_STORAGE_PREFIX}${userId}`;
}

function assistantDraftStorageKey(userId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${userId}`;
}

function readStoredAssistantDraft(userId: string): StoredAssistantDraft | null {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(assistantDraftStorageKey(userId)) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<StoredAssistantDraft>;
    if (
      !Array.isArray(candidate.commands)
      || candidate.commands.length === 0
      || candidate.commands.length > 8
      || !candidate.commands.every(command => typeof command === 'string' && command.trim().length > 0)
      || !isLocalDate(candidate.validatedLocalDate)
    ) return null;
    return {
      commands: candidate.commands.map(command => command.trim()),
      validatedLocalDate: candidate.validatedLocalDate,
    };
  } catch {
    return null;
  }
}

function boundedStoredMessages(messages: readonly ConversationMessage[]): ConversationMessage[] {
  const result: ConversationMessage[] = [];
  let characters = 0;
  for (const message of [...messages].reverse()) {
    if (result.length >= CHAT_STORAGE_LIMIT) break;
    const content = message.content.slice(0, 4_000);
    if (!content || characters + content.length > CHAT_STORAGE_CHARACTER_LIMIT) break;
    characters += content.length;
    result.push({
      id: message.id.slice(0, 160) || `${message.role}-${result.length}`,
      role: message.role,
      content,
    });
  }
  return result.reverse();
}

function readStoredAssistantMessages(userId: string): ConversationMessage[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(assistantChatStorageKey(userId)) || '[]');
    if (!Array.isArray(parsed)) return [];
    return boundedStoredMessages(parsed.flatMap((value): ConversationMessage[] => {
      if (!value || typeof value !== 'object') return [];
      const candidate = value as Partial<ConversationMessage>;
      if ((candidate.role !== 'assistant' && candidate.role !== 'user') || typeof candidate.content !== 'string') return [];
      return [{
        id: typeof candidate.id === 'string' ? candidate.id : `${candidate.role}-${Date.now()}`,
        role: candidate.role,
        content: candidate.content,
      }];
    }));
  } catch {
    return [];
  }
}

function clearLegacyAssistantChatStorage(userId: string): void {
  try {
    window.sessionStorage.removeItem(`${LEGACY_CHAT_STORAGE_PREFIX}${userId}`);
    window.localStorage.removeItem(assistantChatStorageKey(userId));
    window.localStorage.removeItem(`${LEGACY_CHAT_STORAGE_PREFIX}${userId}`);
  } catch {
    // This account's older plaintext history is best-effort cleanup when storage is unavailable.
  }
}

function nextAssistantQuotaReset(usage: NonNullable<AssistantChatResponse['usage']>, now = new Date()): number | null {
  if (usage.remainingMonthly <= 0) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  }
  if (usage.remainingDaily <= 0) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  }
  return null;
}

function cleanAssistantText(value: string | null | undefined, limit = 700): string {
  return (value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function isAssistantChatResponse(value: unknown): value is AssistantChatResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<AssistantChatResponse>;
  return typeof candidate.reply === 'string'
    && Array.isArray(candidate.normalizedCommands)
    && candidate.normalizedCommands.length <= 8
    && candidate.normalizedCommands.every(command => typeof command === 'string' && command.trim().length > 0)
    && (candidate.usage === null || (
      typeof candidate.usage === 'object'
      && candidate.usage !== null
      && typeof candidate.usage.remainingDaily === 'number'
      && typeof candidate.usage.remainingMonthly === 'number'
    ))
    && typeof candidate.aiUsed === 'boolean';
}

function localDate(value: Date): LocalDate {
  return format(value, 'yyyy-MM-dd');
}

function dateCarrierInTimeZone(timeZone: string, instant = new Date()): Date {
  const date = localDateFromIso(instant.toISOString(), timeZone);
  if (!date) return startOfDay(instant);
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function localDateCarrier(value: LocalDate): Date {
  const [year, month, day] = value.split('-').map(Number);
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

function scheduleDraftBlocks(
  preview: ScheduleCommandPreview | null,
  tasks: readonly Task[],
  subjects: ReturnType<typeof useAppStore.getState>['subjects'],
): PlannerBlockView[] {
  if (!preview || preview.status !== 'ready') return [];
  return preview.occurrences.flatMap((occurrence, index) => {
    if (!occurrence.startAt || !occurrence.durationSeconds) return [];
    const start = new Date(occurrence.startAt);
    if (Number.isNaN(start.getTime())) return [];
    const task = occurrence.taskId ? tasks.find(candidate => candidate.id === occurrence.taskId) : null;
    const subject = task?.subject_id ? subjects.find(candidate => candidate.id === task.subject_id) : null;
    return [{
      id: `assistant-draft-${preview.id}-${index}`,
      title: occurrence.title,
      description: task?.description || null,
      startAt: occurrence.startAt,
      endAt: new Date(start.getTime() + occurrence.durationSeconds * 1_000).toISOString(),
      subjectName: subject?.name || task?.course_name || null,
      subjectColor: subject?.color || '#8b5cf6',
      color: '#8b5cf6',
      source: 'Assistant draft',
      kind: 'task' as const,
      taskId: occurrence.taskId,
      fixed: true,
      locked: true,
      draft: true,
      reason: 'Unsaved Assistant change',
    }];
  });
}

function previewReply(preview: ScheduleCommandPreview): string {
  const details: string[] = [preview.summary];
  if (preview.candidates.length > 1) {
    details.push(`Which task did you mean?\n${preview.candidates.map(candidate => `- ${candidate.title}`).join('\n')}`);
  }
  if (preview.assumptions.length > 0) {
    details.push(preview.assumptions.map(assumption => `- ${assumption}`).join('\n'));
  }
  return details.join('\n\n');
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
  const { user, tasks, subjects, exams, addTask, deleteTask, dataLoaded } = useAppStore();
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
  const [previewValidatedLocalDate, setPreviewValidatedLocalDate] = useState<LocalDate | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [chatOwnerUserId, setChatOwnerUserId] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [usage, setUsage] = useState<AssistantChatResponse['usage']>(null);
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRequestIdRef = useRef(0);
  const chatHydratedUserRef = useRef<string | null>(null);
  const draftHydratedUserRef = useRef<string | null>(null);

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

  useEffect(() => () => {
    chatRequestIdRef.current += 1;
    chatAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    chatRequestIdRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatHydratedUserRef.current = null;
    draftHydratedUserRef.current = null;
    if (userId) clearLegacyAssistantChatStorage(userId);
    const restored = userId ? readStoredAssistantMessages(userId) : [];
    setUndoState(null);
    setUsage(null);
    setIsThinking(false);
    setPreview(null);
    setPreviewValidatedLocalDate(null);
    setSelectedTaskId(null);
    setCommand('');
    setMessages(restored);
    setChatOwnerUserId(userId);
    chatHydratedUserRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (!userId || chatOwnerUserId !== userId || chatHydratedUserRef.current !== userId) return;
    try {
      window.sessionStorage.setItem(
        assistantChatStorageKey(userId),
        JSON.stringify(boundedStoredMessages(messages)),
      );
    } catch {
      // Chat history is optional. The live conversation still works if storage is unavailable.
    }
  }, [chatOwnerUserId, messages, userId]);

  useEffect(() => {
    if (!usage) return;
    const resetAt = nextAssistantQuotaReset(usage);
    if (!resetAt) return;
    let timer: number | null = null;
    const armReset = () => {
      const remaining = resetAt - Date.now();
      if (remaining <= 0) {
        setUsage(null);
        return;
      }
      timer = window.setTimeout(armReset, Math.min(remaining + 1_000, 60 * 60 * 1_000));
    };
    armReset();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [usage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [isThinking, messages, preview]);

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
  const previewTaskIds = useMemo(() => new Set(
    preview?.actions.flatMap(action => action.type === 'schedule_batch'
      ? action.operations.map(operation => operation.taskId)
      : []) || [],
  ), [preview]);
  const previewBlocks = useMemo(
    () => scheduleDraftBlocks(preview, tasks, subjects),
    [preview, subjects, tasks],
  );
  const blocks = useMemo(() => [
    ...visibleCommitments.blocks,
    ...visibleEvents.blocks,
    ...occurrenceBlocks(occurrences.timed).filter(block => !block.taskId || !previewTaskIds.has(block.taskId)),
    ...previewBlocks,
  ], [occurrences.timed, previewBlocks, previewTaskIds, visibleCommitments.blocks, visibleEvents.blocks]);
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

  useEffect(() => {
    if (!userId || !dataLoaded || chatOwnerUserId !== userId || draftHydratedUserRef.current === userId) return;
    draftHydratedUserRef.current = userId;
    try {
      window.sessionStorage.removeItem(`${LEGACY_DRAFT_STORAGE_PREFIX}${userId}`);
    } catch {
      // Legacy draft cleanup waits until current app data is ready.
    }
    const storedDraft = readStoredAssistantDraft(userId);
    if (!storedDraft) return;
    const currentLocalDate = localDate(dateCarrierInTimeZone(timeZone));
    if (storedDraft.validatedLocalDate !== currentLocalDate) {
      try {
        window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
      } catch {
        // An expired stored draft can be ignored when storage is unavailable.
      }
      return;
    }
    const restored = interpretScheduleCommands(storedDraft.commands, {
      ...context,
      now: new Date().toISOString(),
    });
    if (restored.status === 'ready' && restored.actions.length > 0) {
      setPreview(restored);
      setPreviewValidatedLocalDate(storedDraft.validatedLocalDate);
      setCalendarOpen(true);
      return;
    }
    try {
      window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
    } catch {
      // An invalid stored draft can be ignored when storage is unavailable.
    }
  }, [chatOwnerUserId, context, dataLoaded, timeZone, userId]);

  useEffect(() => {
    if (!userId || draftHydratedUserRef.current !== userId) return;
    try {
      if (preview?.status === 'ready' && preview.commands.length > 0 && previewValidatedLocalDate) {
        window.sessionStorage.setItem(
          assistantDraftStorageKey(userId),
          JSON.stringify({
            commands: preview.commands.slice(0, 8),
            validatedLocalDate: previewValidatedLocalDate,
          } satisfies StoredAssistantDraft),
        );
      } else {
        window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
      }
    } catch {
      // The active in-memory draft remains usable when storage is unavailable.
    }
  }, [preview, previewValidatedLocalDate, userId]);

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
    window.requestAnimationFrame(() => {
      commandInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      commandInputRef.current?.focus();
    });
  }, []);

  const stopThinking = useCallback(() => {
    chatRequestIdRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setIsThinking(false);
  }, []);

  const submitCommand = useCallback(async (value = command, taskId = selectedTaskId) => {
    const normalized = value.trim();
    if (!normalized || isThinking || chatOwnerUserId !== userId) return;

    const userMessage: ConversationMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: normalized,
    };
    const conversation = [...messages, userMessage].slice(-CHAT_CONTEXT_LIMIT);
    setMessages(previous => [...previous, userMessage].slice(-CHAT_DISPLAY_LIMIT));
    setCommand('');
    setIsThinking(true);

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const requestId = chatRequestIdRef.current + 1;
    chatRequestIdRef.current = requestId;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHAT_TIMEOUT_MS);

    try {
      const response = await fetch('/api/planner/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
        body: JSON.stringify({
          messages: conversation.map(message => ({ role: message.role, content: message.content })),
          context: {
            now: new Date().toISOString(),
            timeZone,
            selectedTaskId: taskId,
            selectedDate: localDate(selectedDate),
            availableStartTime: plannerSettings.weekendAvailableStart,
            availableEndTime: plannerSettings.bedtime,
            tasks: pendingTasks.slice(0, 30).map(task => ({
              id: task.id,
              title: cleanAssistantText(task.title, 180),
              description: cleanAssistantText(task.description),
              dueDate: task.due_date,
              dueTime: task.due_time,
            })),
            exams: [...exams]
              .sort((left, right) => left.exam_date.localeCompare(right.exam_date))
              .slice(0, 20)
              .map(exam => ({
                id: exam.id,
                title: cleanAssistantText(exam.title, 180),
                description: cleanAssistantText(exam.description),
                examDate: exam.exam_date,
                subject: cleanAssistantText(
                  subjects.find(subject => subject.id === exam.subject_id)?.name,
                  120,
                ) || null,
              })),
            occurrences: context.occurrences.slice(0, 80).map(occurrence => ({
              id: occurrence.id,
              taskId: occurrence.taskId,
              title: cleanAssistantText(occurrence.title, 180),
              date: occurrence.date,
              startAt: occurrence.startAt,
              endAt: occurrence.endAt,
              durationSeconds: occurrence.durationSeconds,
              recurrence: occurrence.recurrence,
            })),
            busy: (context.busy || []).slice(0, 80).map(interval => ({
              id: interval.id,
              title: cleanAssistantText(interval.title, 180),
              startAt: interval.startAt,
              endAt: interval.endAt,
            })),
          },
        }),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (requestId !== chatRequestIdRef.current) return;
      const validPayload = isAssistantChatResponse(payload);
      if (!response.ok || !validPayload) {
        if (validPayload) setUsage(payload.usage);
        const errorReply = payload && typeof payload === 'object' && 'reply' in payload
          && typeof (payload as { reply?: unknown }).reply === 'string'
          ? (payload as { reply: string }).reply
          : response.status === 429
            ? 'You have reached your Assistant limit for now. Try again when your allowance resets.'
            : 'I could not answer that right now. Please try again.';
        throw new Error(errorReply);
      }

      setUsage(payload.usage);

      const assistantMessageId = `assistant-${Date.now()}`;
      let assistantReply = payload.reply.trim() || 'Here is what I found.';
      if (payload.normalizedCommands.length > 0) {
        const commandContext = {
          ...context,
          now: new Date().toISOString(),
          selectedTaskId: taskId,
        };
        let nextPreview = interpretScheduleCommands(payload.normalizedCommands, commandContext);
        if (payload.normalizedCommands.length === 1) {
          const normalizedCommand = payload.normalizedCommands[0];
          const recovery = recoverExplicitRangeFromFalseSchoolConflict({
            messages: conversation,
            normalizedCommand,
            normalizedPreview: interpretScheduleCommand(normalizedCommand, commandContext),
            interpret: candidate => interpretScheduleCommand(candidate, commandContext),
          });
          if (recovery.recovered) {
            nextPreview = interpretScheduleCommands([recovery.command], commandContext);
          }
        }
        if (nextPreview.status === 'ready' && nextPreview.actions.length > 0) {
          setPreview(nextPreview);
          setPreviewValidatedLocalDate(localDate(dateCarrierInTimeZone(timeZone)));
          assistantReply = `I placed ${nextPreview.actions.length === 1 ? 'the change' : `${nextPreview.actions.length} changes`} on your calendar as one draft.\n\n${nextPreview.summary}\n\nSelect **Save changes** above the calendar to confirm everything.`;
          const firstOccurrence = nextPreview.occurrences[0];
          if (firstOccurrence) {
            const nextDate = localDateCarrier(firstOccurrence.date);
            setSelectedDate(nextDate);
            setWeekStart(startOfWeek(nextDate, { weekStartsOn: 1 }));
          }
          setCalendarOpen(true);
        } else {
          setPreview(null);
          setPreviewValidatedLocalDate(null);
          assistantReply = previewReply(nextPreview);
        }
      }
      setMessages(previous => [...previous, {
        id: assistantMessageId,
        role: 'assistant' as const,
        content: assistantReply,
      }].slice(-CHAT_DISPLAY_LIMIT));
    } catch (error) {
      if (requestId !== chatRequestIdRef.current) return;
      if (controller.signal.aborted && !timedOut) return;
      const content = timedOut
        ? 'That took too long, so I stopped the request. Please try again.'
        : error instanceof Error
          ? error.message
          : 'I could not answer that right now. Please try again.';
      setMessages(previous => [...previous, {
        id: `assistant-error-${Date.now()}`,
        role: 'assistant' as const,
        content,
      }].slice(-CHAT_DISPLAY_LIMIT));
      setCommand(current => current.trim() ? current : normalized);
    } finally {
      window.clearTimeout(timeout);
      if (requestId === chatRequestIdRef.current) {
        chatAbortRef.current = null;
        setIsThinking(false);
      }
    }
  }, [chatOwnerUserId, command, context, exams, isThinking, messages, pendingTasks, plannerSettings.bedtime, plannerSettings.weekendAvailableStart, selectedDate, selectedTaskId, subjects, timeZone, userId]);

  const applyPreview = useCallback(async () => {
    if (!userId || !preview || preview.status !== 'ready' || preview.actions.length === 0) return;
    const currentLocalDate = localDate(dateCarrierInTimeZone(timeZone));
    if (!previewValidatedLocalDate || previewValidatedLocalDate !== currentLocalDate) {
      setPreview(null);
      setPreviewValidatedLocalDate(null);
      setMessages(previous => [...previous, {
        id: `assistant-expired-${Date.now()}`,
        role: 'assistant' as const,
        content: 'That calendar draft expired at midnight, so I did not apply it. Ask me again and I will make a fresh draft for today.',
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.info('Calendar draft expired');
      return;
    }
    const freshPreview = interpretScheduleCommands(preview.commands, {
      ...context,
      now: new Date().toISOString(),
      selectedTaskId,
    });
    if (
      freshPreview.status !== 'ready'
      || JSON.stringify(freshPreview.actions) !== JSON.stringify(preview.actions)
    ) {
      setPreview(freshPreview);
      setPreviewValidatedLocalDate(freshPreview.status === 'ready' ? currentLocalDate : null);
      setMessages(previous => [...previous, {
        id: `assistant-recheck-${Date.now()}`,
        role: 'assistant' as const,
        content: 'Your schedule changed while we were chatting, so I refreshed the draft on the calendar. Check it and save again.',
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.info('Calendar draft refreshed');
      return;
    }
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
      setUndoState({ userId, entries: before, createdTaskIds, label: preview.summary });
      setMessages(previous => [...previous, {
        id: `applied-${Date.now()}`,
        role: 'assistant' as const,
        content: `Done — ${preview.summary}`,
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.success('Schedule updated');
      setPreview(null);
      setPreviewValidatedLocalDate(null);
      setCommand('');
      setSelectedTaskId(null);
    } catch (error) {
      for (const id of createdTaskIds) await deleteTask(id);
      replaceUserSchedules(userId, before);
      toast.error(error instanceof Error ? error.message : 'Could not update the schedule');
    } finally {
      setApplying(false);
    }
  }, [addTask, applyScheduleBatch, context, deleteTask, entries, preview, previewValidatedLocalDate, replaceUserSchedules, selectedTaskId, timeZone, userId]);

  const undo = useCallback(async () => {
    if (!userId || !undoState || undoState.userId !== userId) return;
    for (const taskId of undoState.createdTaskIds) await deleteTask(taskId);
    replaceUserSchedules(userId, cloneEntries(undoState.entries));
    setMessages(previous => [...previous, {
      id: `undo-${Date.now()}`,
      role: 'assistant' as const,
      content: `Undid: ${undoState.label}`,
    }].slice(-CHAT_DISPLAY_LIMIT));
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
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.warning(`“${task.title}” is scheduled after its deadline.`, {
        description: 'The due date stays unchanged.',
      });
    }
    const entry = entries.find(item => item.taskId === task.id);
    setUndoState({ userId, entries: cloneEntries(entries), createdTaskIds: [], label: `Move “${task.title}”` });
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
      toast.warning(`“${task.title}” now runs past its deadline.`, {
        description: 'The due date stays unchanged.',
      });
    }
    const durationSeconds = Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000));
    const entry = entries.find(item => item.taskId === task.id);
    setUndoState({ userId, entries: cloneEntries(entries), createdTaskIds: [], label: `Resize “${task.title}”` });
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
    const conflict = conflictingBlock(blocks, item.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That time overlaps “${conflict.title}”. Choose a free slot.`);
      return;
    }
    const nextDate = localDateFromIso(nextStart.toISOString(), timeZone);
    if (!nextDate) return;
    const deadline = occurrenceDeadline(occurrence, timeZone);
    if (deadline && nextEnd.getTime() > new Date(deadline).getTime()) {
      toast.warning(`“${occurrence.title}” is scheduled after its deadline.`, {
        description: 'The due date stays unchanged.',
      });
    }
    const entry = entries.find(candidate => candidate.taskId === occurrence.taskId);
    const durationSeconds = Math.max(15 * 60, Math.round((nextEnd.getTime() - nextStart.getTime()) / 1000));
    setUndoState({ userId, entries: cloneEntries(entries), createdTaskIds: [], label: `Schedule “${occurrence.title}”` });
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

  const handleMoveToUntimed = useCallback((block: PlannerBlockView, targetDate?: string) => {
    if (!userId) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence?.startAt) return;
    const entry = entries.find(candidate => candidate.taskId === occurrence.taskId);
    const durationSeconds = occurrence.durationSeconds || 30 * 60;
    const nextDate = targetDate || occurrence.date;
    setUndoState({ userId, entries: cloneEntries(entries), createdTaskIds: [], label: `Move “${occurrence.title}” to untimed` });
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
        ...occurrenceScheduleInput(entry, occurrence),
        scheduledDate: nextDate,
        startAt: null,
        durationSeconds,
      });
    }
    toast.success(`${occurrence.title} moved to untimed`);
  }, [entries, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

  const startNewChat = useCallback(() => {
    stopThinking();
    if (userId) {
      try {
        window.sessionStorage.removeItem(assistantChatStorageKey(userId));
      } catch {
        // The in-memory conversation can still be cleared when storage is unavailable.
      }
    }
    setMessages([]);
    setCommand('');
    setPreview(null);
    setPreviewValidatedLocalDate(null);
    setSelectedTaskId(null);
    window.requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [stopThinking, userId]);

  const chatReady = chatOwnerUserId === userId;
  const activeMessages = chatReady ? messages : [];
  const activeCommand = chatReady ? command : '';
  const activeUsage = chatReady ? usage : null;
  const activeIsThinking = chatReady && isThinking;
  const quotaExhausted = Boolean(activeUsage && (activeUsage.remainingDaily <= 0 || activeUsage.remainingMonthly <= 0));
  const showQuota = Boolean(activeUsage && (
    activeUsage.remainingDaily <= 5
    || activeUsage.remainingMonthly <= 20
    || quotaExhausted
  ));

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
            <p className="text-sm text-muted-foreground">Draft changes directly on your calendar, then save them.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {undoState?.userId === userId && (
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

      <AssistantChat
        messages={activeMessages}
        command={activeCommand}
        onCommandChange={setCommand}
        onSubmit={() => void submitCommand()}
        onStop={stopThinking}
        onNewChat={startNewChat}
        isThinking={activeIsThinking}
        examples={EXAMPLES}
        onExampleClick={example => void submitCommand(example, null)}
        usage={activeUsage}
        showQuota={showQuota}
        quotaExhausted={quotaExhausted}
        inputRef={commandInputRef}
        endRef={chatEndRef}
      />

      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => setCalendarOpen(open => !open)}
            className="flex min-w-0 items-center gap-3 text-left"
            aria-expanded={calendarOpen}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarDays className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Week calendar</span>
              <span className="block truncate text-xs text-muted-foreground">
                {format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}
              </span>
            </span>
            {calendarOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {calendarOpen && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant={taskDetailsOpen ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setTaskDetailsOpen(open => !open)}
              >
                Tasks
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setCalendarExpanded(expanded => !expanded)}
                aria-label={calendarExpanded ? 'Use compact calendar' : 'Expand calendar'}
              >
                {calendarExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </Button>
            </div>
          )}
        </CardHeader>
      </Card>

      {calendarOpen && (
        <div className={cn(
          'grid min-w-0 gap-5',
          taskDetailsOpen && 'xl:grid-cols-[minmax(0,1fr)_320px]',
        )}>
        <main className="min-w-0">
          <Card>
            <CardHeader className="flex-row items-center justify-between px-4 pb-3 pt-4">
              <div className="flex min-w-0 items-center gap-2">
                <CalendarDays className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <CardTitle>{format(weekStart, 'MMM d')}–{format(addDays(weekStart, 6), 'MMM d, yyyy')}</CardTitle>
                  <p className="mt-1 truncate text-xs text-muted-foreground">Drag tasks onto the calendar or back to Untimed, then move or resize anything except school.</p>
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
              {preview?.status === 'ready' && preview.actions.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/40 bg-primary/[0.07] p-3" aria-live="polite">
                  <div className="flex min-w-0 items-start gap-2">
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">Assistant draft on calendar</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{preview.summary}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setPreview(null);
                        setPreviewValidatedLocalDate(null);
                      }}
                      disabled={applying}
                    >
                      Discard
                    </Button>
                    <Button type="button" size="sm" onClick={() => void applyPreview()} disabled={applying}>
                      {applying ? 'Saving…' : 'Save changes'}
                    </Button>
                  </div>
                </div>
              )}
              <WeekTimeGrid
                weekStart={weekStart}
                blocks={blocks}
                editable
                viewportClassName={calendarExpanded ? 'h-[760px]' : 'h-[420px]'}
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

        {taskDetailsOpen && (
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
        )}
        </div>
      )}
    </div>
  );
}
