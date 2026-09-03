'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  differenceInSeconds,
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
import { useStoredCalendarEvents } from '@/lib/planner/use-stored-calendar-events';
import {
  buildCommitmentOccurrences,
  withCommitmentOccurrenceOverride,
} from '@/lib/planner/commitments';
import { usePlannerStore } from '@/lib/planner/store';
import { getDefaultPlannerSettings, type PlannerSettings, type RecurringCommitmentInput } from '@/lib/planner/types';
import {
  buildAssistantTaskPlan,
  type AssistantTaskPlanRequest,
} from '@/lib/planner/assistant-planner';
import {
  inferPlannerChatPlanRequest,
  plannerChatNormalizedCommandsPreserveIntent,
  plannerChatPlanRequestPreservesIntent,
  sanitizePlannerChatPlanRequest,
  type PlannerCommandAIContext,
  type PlannerChatPlanRequest,
} from '@/lib/planner/deepseek-command';
import {
  resolveAssistantTaskQuery,
} from '@/lib/planner/assistant-task-query';
import {
  deleteCreatedTasks,
  plannerMutationIsCurrent,
} from '@/lib/planner/assistant-mutation';
import {
  describeScheduleCommandDraft,
  interpretDirectScheduleRequest,
  interpretScheduleCommand,
  interpretScheduleCommands,
  scheduleEventActionToCommitment,
  type ScheduleCommandBusyInterval,
  type ScheduleCommandContext,
  type ScheduleCommandPreview,
} from '@/lib/schedule/commands';
import {
  isUnverifiedCalendarOutcome,
  recoverExplicitRangeFromFalseSchoolConflict,
} from '@/lib/schedule/assistant-command-fallback';
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
import { restoreScheduleSnapshotPreservingChanges } from '@/lib/schedule/undo';
import type { LocalDate, ScheduleEntry, ScheduleOccurrence } from '@/lib/schedule/types';
import type { Task } from '@/lib/supabase/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { WeekTimeGrid, type PlannerBlockView } from '@/components/planner';
import { AssistantChat } from '@/components/planner/assistant/AssistantChat';
import { TaskForm } from '@/components/tasks/TaskForm';
import type { UntimedScheduleItem } from '@/components/schedule/UntimedTaskShelf';

interface ConversationMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
}

interface AssistantChatResponse {
  reply: string;
  normalizedCommands: string[];
  planRequest: PlannerChatPlanRequest | null;
  usage: {
    remainingDaily: number;
    remainingMonthly: number;
  } | null;
  aiUsed: boolean;
}

interface UndoState {
  userId: string;
  entries: ScheduleEntry[];
  appliedEntries?: ScheduleEntry[];
  createdTaskIds: string[];
  createdCommitmentIds?: string[];
  commitmentSnapshots?: RecurringCommitmentInput[];
  storedEventSnapshots?: StoredCalendarEvent[];
  label: string;
  recoveryOnly?: boolean;
}

interface CalendarRenderData {
  blocks: PlannerBlockView[];
  busy: ScheduleCommandBusyInterval[];
}

function cloneCommitment(commitment: RecurringCommitmentInput): RecurringCommitmentInput {
  return {
    ...commitment,
    daysOfWeek: [...commitment.daysOfWeek],
    occurrenceOverrides: commitment.occurrenceOverrides
      ? Object.fromEntries(Object.entries(commitment.occurrenceOverrides).map(([date, override]) => [
          date,
          { ...override },
        ]))
      : undefined,
  };
}

function cloneStoredEvent(event: StoredCalendarEvent): StoredCalendarEvent {
  return {
    ...event,
    occurrenceOverrides: event.occurrenceOverrides
      ? Object.fromEntries(Object.entries(event.occurrenceOverrides).map(([date, override]) => [
          date,
          { ...override },
        ]))
      : undefined,
  };
}

function restoreStoredEventSnapshots(
  current: readonly StoredCalendarEvent[],
  snapshots: readonly StoredCalendarEvent[],
): StoredCalendarEvent[] {
  const restored = new Map(current.map(event => [event.id, cloneStoredEvent(event)]));
  for (const snapshot of snapshots) restored.set(snapshot.id, cloneStoredEvent(snapshot));
  return [...restored.values()];
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

type StoredAssistantDraft =
  | {
      kind: 'commands';
      commands: string[];
      validatedLocalDate: LocalDate;
      plannedAt: string;
      anchorDate: LocalDate;
    }
  | {
      kind: 'task_plan';
      request: AssistantTaskPlanRequest;
      validatedLocalDate: LocalDate;
      plannedAt: string;
    };

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
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.validatedLocalDate !== 'string' || !isLocalDate(candidate.validatedLocalDate)) return null;
    const plannedAt = typeof candidate.plannedAt === 'string'
      && Number.isFinite(new Date(candidate.plannedAt).getTime())
      ? new Date(candidate.plannedAt).toISOString()
      : new Date().toISOString();
    const commands = Array.isArray(candidate.commands)
      && candidate.commands.length > 0
      && candidate.commands.length <= 8
      && candidate.commands.every(command => typeof command === 'string' && command.trim().length > 0)
      ? candidate.commands.map(command => (command as string).trim())
      : null;
    if ((candidate.kind === 'commands' || candidate.kind === undefined) && commands) {
      const anchorDate = typeof candidate.anchorDate === 'string' && isLocalDate(candidate.anchorDate)
        ? candidate.anchorDate
        : candidate.validatedLocalDate;
      return {
        kind: 'commands',
        commands,
        validatedLocalDate: candidate.validatedLocalDate,
        plannedAt,
        anchorDate,
      };
    }
    // Drafts written by the first v2 planner schema predate request-specific
    // availability and additional chat-created work. Supply only the neutral
    // defaults for absent fields so an in-progress draft survives a deploy;
    // malformed or unexpected saved values still go through strict validation.
    const storedRequest = candidate.request && typeof candidate.request === 'object' && !Array.isArray(candidate.request)
      ? candidate.request as Record<string, unknown>
      : null;
    const migratedRequest = storedRequest
      ? {
          ...storedRequest,
          availableAfter: Object.hasOwn(storedRequest, 'availableAfter') ? storedRequest.availableAfter : null,
          availableBefore: Object.hasOwn(storedRequest, 'availableBefore') ? storedRequest.availableBefore : null,
          additionalTasks: Object.hasOwn(storedRequest, 'additionalTasks') ? storedRequest.additionalTasks : [],
        }
      : candidate.request;
    const request = sanitizePlannerChatPlanRequest(migratedRequest);
    if (candidate.kind === 'task_plan' && request) {
      return {
        kind: 'task_plan',
        request,
        validatedLocalDate: candidate.validatedLocalDate,
        plannedAt,
      };
    }
    return null;
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
    && (candidate.planRequest === null || sanitizePlannerChatPlanRequest(candidate.planRequest) !== null)
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

function currentScheduleEntries(userId: string): ScheduleEntry[] {
  return cloneEntries(selectScheduleEntriesForUser(
    useScheduleStore.getState().entriesByUser,
    userId,
  ));
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
      busy.push({
        id,
        title: commitment.title,
        startAt,
        endAt,
        commitmentId: school ? null : commitment.id,
        occurrenceDate: school ? null : occurrence.sourceDate,
      });
      blocks.push({
        id,
        title: commitment.title,
        description: [commitment.description, commitment.location ? `Location: ${commitment.location}` : null]
          .filter(Boolean)
          .join('\n') || null,
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

function scheduledPlacementStarts(preview: ScheduleCommandPreview): string[] {
  return preview.actions.flatMap(action => {
    if (action.type === 'create_task' || action.type === 'create_event' || action.type === 'update_event') {
      return action.schedule.startAt ? [action.schedule.startAt] : [];
    }
    if (action.type === 'remove_event') return [];
    return action.operations.flatMap(operation => {
      if (operation.type === 'upsert') return operation.input.startAt ? [operation.input.startAt] : [];
      if (operation.type === 'override') return operation.override.startAt ? [operation.override.startAt] : [];
      return [];
    });
  });
}

function previewContainsPastPlacement(preview: ScheduleCommandPreview, now: string): boolean {
  if (preview.kind === 'resize' || preview.kind === 'repeat' || preview.kind === 'delete') return false;
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(nowTime)) return true;
  return scheduledPlacementStarts(preview).some(startAt => {
    const startTime = new Date(startAt).getTime();
    return !Number.isFinite(startTime) || startTime < nowTime;
  });
}

function withoutPastPlacements(
  preview: ScheduleCommandPreview,
  now: string,
): ScheduleCommandPreview {
  if (!previewContainsPastPlacement(preview, now)) return preview;
  return {
    ...preview,
    status: 'clarification',
    summary: 'One or more times in that draft have already passed, so I did not apply it. Ask me again and I will place the work in current free time.',
    actions: [],
    occurrences: [],
  };
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
  const {
    user,
    tasks,
    subjects,
    exams,
    addTask,
    deleteTask,
    finalizeTaskCreations,
    dataLoaded,
  } = useAppStore();
  const plannerUsers = usePlannerStore(state => state.users);
  const upsertCommitment = usePlannerStore(state => state.upsertCommitment);
  const removeCommitment = usePlannerStore(state => state.removeCommitment);
  const waitForPlannerPersistence = usePlannerStore(state => state.waitForPlannerPersistence);
  const entriesByUser = useScheduleStore(state => state.entriesByUser);
  const applyScheduleBatch = useScheduleStore(state => state.applyScheduleBatch);
  const replaceUserSchedules = useScheduleStore(state => state.replaceUserSchedules);
  const moveOccurrence = useScheduleStore(state => state.moveOccurrence);
  const resizeOccurrence = useScheduleStore(state => state.resizeOccurrence);
  const upsertTaskSchedule = useScheduleStore(state => state.upsertTaskSchedule);
  const setOccurrenceOverride = useScheduleStore(state => state.setOccurrenceOverride);
  const waitForSchedulePersistence = useScheduleStore(state => state.waitForSchedulePersistence);

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
  const { events: storedEvents, setEvents: setStoredEvents } = useStoredCalendarEvents(userId);
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<ScheduleCommandPreview | null>(null);
  const [previewPlanRequest, setPreviewPlanRequest] = useState<AssistantTaskPlanRequest | null>(null);
  const [previewPlanNow, setPreviewPlanNow] = useState<string | null>(null);
  const [previewAnchorDate, setPreviewAnchorDate] = useState<LocalDate | null>(null);
  const [previewValidatedLocalDate, setPreviewValidatedLocalDate] = useState<LocalDate | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [undoState, setUndoState] = useState<UndoState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [chatOwnerUserId, setChatOwnerUserId] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [usage, setUsage] = useState<AssistantChatResponse['usage']>(null);
  const [calendarOpen, setCalendarOpen] = useState(true);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingCommitment, setEditingCommitment] = useState<RecurringCommitmentInput | null>(null);
  const [creationSlot, setCreationSlot] = useState<{
    date: string;
    startTime: string;
    durationSeconds: number;
  } | null>(null);
  const commandInputRef = useRef<HTMLTextAreaElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatRequestIdRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const activeUndoRef = useRef<UndoState | null>(null);
  const inFlightUndoRef = useRef<UndoState | null>(null);
  const activeUserIdRef = useRef<string | null>(userId);
  const chatHydratedUserRef = useRef<string | null>(null);
  const draftHydratedUserRef = useRef<string | null>(null);

  const installUndoState = useCallback((next: UndoState) => {
    const previous = activeUndoRef.current;
    if (previous && previous !== inFlightUndoRef.current) {
      // A single-level Undo must never retain deletion authority after a newer
      // calendar change replaces it.
      finalizeTaskCreations(previous.createdTaskIds);
    }
    const installed = {
      ...next,
      appliedEntries: next.appliedEntries || cloneEntries(selectScheduleEntriesForUser(
        useScheduleStore.getState().entriesByUser,
        next.userId,
      )),
    };
    activeUndoRef.current = installed;
    setUndoState(installed);
  }, [finalizeTaskCreations]);

  useEffect(() => {
    const today = dateCarrierInTimeZone(timeZone);
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setWeekStart(startOfWeek(today, { weekStartsOn: 1 }));
      setSelectedDate(today);
    });
    return () => { cancelled = true; };
  }, [timeZone]);

  useEffect(() => () => {
    chatRequestIdRef.current += 1;
    mutationGenerationRef.current += 1;
    activeUserIdRef.current = null;
    chatAbortRef.current?.abort();
    const previousUndo = activeUndoRef.current;
    if (previousUndo && previousUndo !== inFlightUndoRef.current) {
      finalizeTaskCreations(previousUndo.createdTaskIds);
    }
    activeUndoRef.current = null;
  }, [finalizeTaskCreations]);

  useEffect(() => {
    let cancelled = false;
    activeUserIdRef.current = userId;
    chatRequestIdRef.current += 1;
    mutationGenerationRef.current += 1;
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    chatHydratedUserRef.current = null;
    draftHydratedUserRef.current = null;
    if (userId) clearLegacyAssistantChatStorage(userId);
    const restored = userId ? readStoredAssistantMessages(userId) : [];
    const previousUndo = activeUndoRef.current;
    if (previousUndo && previousUndo !== inFlightUndoRef.current) {
      finalizeTaskCreations(previousUndo.createdTaskIds);
    }
    activeUndoRef.current = null;
    queueMicrotask(() => {
      if (cancelled) return;
      setUndoState(null);
      setUsage(null);
      setIsThinking(false);
      setApplying(false);
      setPreview(null);
      setPreviewPlanRequest(null);
      setPreviewPlanNow(null);
      setPreviewAnchorDate(null);
      setPreviewValidatedLocalDate(null);
      setSelectedTaskId(null);
      setSelectedEventId(null);
      setEditingTask(null);
      setEditingCommitment(null);
      setCreationSlot(null);
      setCommand('');
      setMessages(restored);
      setChatOwnerUserId(userId);
      chatHydratedUserRef.current = userId;
    });
    return () => { cancelled = true; };
  }, [finalizeTaskCreations, userId]);

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
  const taskById = useMemo(() => new Map(tasks.map(task => [task.id, task])), [tasks]);
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
    selectedEventId,
    selectedDate: localDate(selectedDate),
    availableStartTime: plannerSettings.weekendAvailableStart,
    availableEndTime: plannerSettings.bedtime,
  }), [commandCommitments.busy, commandEvents.busy, commandOccurrences.timed, commandOccurrences.untimed, entries, pendingTasks, plannerSettings.bedtime, plannerSettings.weekendAvailableStart, selectedDate, selectedEventId, selectedTaskId, timeZone]);

  // Keep the provider payload intentionally small, but make truncation
  // relevance-aware so selected, overdue, and imminent work cannot be hidden
  // behind older low-priority rows. The deterministic planner below still
  // receives the complete local task collection.
  const assistantContextTasks = useMemo(() => [...pendingTasks].sort((left, right) => {
    if (left.id === selectedTaskId) return -1;
    if (right.id === selectedTaskId) return 1;
    const leftDeadline = plannerTaskDeadline(left, timeZone);
    const rightDeadline = plannerTaskDeadline(right, timeZone);
    const leftTime = leftDeadline ? new Date(leftDeadline).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = rightDeadline ? new Date(rightDeadline).getTime() : Number.POSITIVE_INFINITY;
    return leftTime - rightTime
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id);
  }), [pendingTasks, selectedTaskId, timeZone]);

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
    const restored = storedDraft.kind === 'task_plan'
      ? buildAssistantTaskPlan({
          request: storedDraft.request,
          now: storedDraft.plannedAt,
          timeZone,
          tasks,
          entries,
          occurrences: context.occurrences,
          busy: context.busy,
          settings: plannerSettings,
          estimateCache: plannerRecord?.estimateCache || {},
          feedbackMultipliers: plannerRecord?.feedbackMultipliers || {},
        })
      : interpretScheduleCommands(storedDraft.commands, {
          ...context,
          now: storedDraft.plannedAt,
          selectedDate: storedDraft.anchorDate,
        });
    if (restored.status === 'ready' && restored.actions.length > 0) {
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setPreview(restored);
        setPreviewPlanRequest(storedDraft.kind === 'task_plan' ? storedDraft.request : null);
        setPreviewPlanNow(storedDraft.plannedAt);
        setPreviewAnchorDate(storedDraft.kind === 'commands' ? storedDraft.anchorDate : null);
        setPreviewValidatedLocalDate(storedDraft.validatedLocalDate);
        setCalendarOpen(true);
      });
      return () => { cancelled = true; };
    }
    try {
      window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
    } catch {
      // An invalid stored draft can be ignored when storage is unavailable.
    }
  }, [chatOwnerUserId, context, dataLoaded, entries, plannerRecord?.estimateCache, plannerRecord?.feedbackMultipliers, plannerSettings, tasks, timeZone, userId]);

  useEffect(() => {
    if (!userId || draftHydratedUserRef.current !== userId) return;
    try {
      if (preview?.status === 'ready' && previewValidatedLocalDate && previewPlanNow) {
        const storedDraft: StoredAssistantDraft | null = previewPlanRequest
          ? {
              kind: 'task_plan',
              request: previewPlanRequest,
              validatedLocalDate: previewValidatedLocalDate,
              plannedAt: previewPlanNow,
            }
          : preview.commands.length > 0
            ? {
                kind: 'commands',
                commands: preview.commands.slice(0, 8),
                validatedLocalDate: previewValidatedLocalDate,
                plannedAt: previewPlanNow,
                anchorDate: previewAnchorDate || previewValidatedLocalDate,
              }
            : null;
        if (!storedDraft) {
          window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
          return;
        }
        window.sessionStorage.setItem(
          assistantDraftStorageKey(userId),
          JSON.stringify(storedDraft),
        );
      } else {
        window.sessionStorage.removeItem(assistantDraftStorageKey(userId));
      }
    } catch {
      // The active in-memory draft remains usable when storage is unavailable.
    }
  }, [preview, previewAnchorDate, previewPlanNow, previewPlanRequest, previewValidatedLocalDate, userId]);

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

  const handleEmptySlotClick = useCallback((nextStart: Date, nextEnd: Date) => {
    const date = localDateFromIso(nextStart.toISOString(), timeZone);
    const startTime = localTimeFromIso(nextStart.toISOString(), timeZone);
    if (!date || !startTime) return;
    setEditingTask(null);
    setEditingCommitment(null);
    setCreationSlot({
      date,
      startTime,
      durationSeconds: Math.max(60, differenceInSeconds(nextEnd, nextStart)),
    });
    setSelectedDate(localDateCarrier(date));
  }, [timeZone]);

  const handleBlockClick = useCallback((block: PlannerBlockView) => {
    if (block.taskId) {
      const occurrence = occurrenceById.get(block.id);
      const task = occurrence
        ? taskById.get(occurrence.taskId) || occurrence.task
        : taskById.get(block.taskId);
      if (!task) return;
      setEditingCommitment(null);
      setCreationSlot(null);
      setEditingTask(task);
      return;
    }

    if (!block.commitmentId || block.kind === 'school') return;
    const commitment = commitmentById.get(block.commitmentId);
    if (!commitment) return;
    setEditingTask(null);
    setCreationSlot(null);
    setEditingCommitment(commitment);
  }, [commitmentById, occurrenceById, taskById]);

  const closeTaskForm = useCallback(() => {
    setEditingTask(null);
    setEditingCommitment(null);
    setCreationSlot(null);
  }, []);

  const prepareCommand = useCallback((value: string, taskId: string | null = null) => {
    setSelectedTaskId(taskId);
    setSelectedEventId(null);
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

  const presentCommandPreview = useCallback((
    nextPreview: ScheduleCommandPreview,
    plannedAt = new Date().toISOString(),
  ): string => {
    if (nextPreview.status === 'ready' && nextPreview.actions.length > 0) {
      setPreviewPlanRequest(null);
      setPreviewPlanNow(plannedAt);
      setPreviewAnchorDate(nextPreview.occurrences[0]?.date || localDate(selectedDate));
      setPreview(nextPreview);
      setPreviewValidatedLocalDate(localDate(dateCarrierInTimeZone(timeZone)));
      const firstOccurrence = nextPreview.occurrences[0];
      if (firstOccurrence) {
        const nextDate = localDateCarrier(firstOccurrence.date);
        setSelectedDate(nextDate);
        setWeekStart(startOfWeek(nextDate, { weekStartsOn: 1 }));
      }
      setCalendarOpen(true);
      return `${describeScheduleCommandDraft(nextPreview, timeZone)}\n\nReview it on the calendar, then select **Save changes** to apply it.`;
    }

    // A question or clarification must not erase a different unsaved draft.
    // Only a new, fully validated mutation replaces the active draft; users
    // can explicitly discard it with the calendar control.
    return previewReply(nextPreview);
  }, [selectedDate, timeZone]);

  const presentTaskPlanPreview = useCallback((
    request: AssistantTaskPlanRequest,
    nextPreview: ScheduleCommandPreview,
    plannedAt: string,
  ): string => {
    if (nextPreview.status !== 'ready' || nextPreview.actions.length === 0) {
      // A failed follow-up must not erase a different draft the user has not
      // saved yet. The existing draft remains visible until it is replaced by
      // a fully validated plan or explicitly discarded.
      return previewReply(nextPreview);
    }
    setPreviewPlanRequest(request);
    setPreviewPlanNow(plannedAt);
    setPreviewAnchorDate(null);
    setPreview(nextPreview);
    setPreviewValidatedLocalDate(localDate(dateCarrierInTimeZone(timeZone)));
    const firstOccurrence = nextPreview.occurrences[0];
    if (firstOccurrence) {
      const nextDate = localDateCarrier(firstOccurrence.date);
      setSelectedDate(nextDate);
      setWeekStart(startOfWeek(nextDate, { weekStartsOn: 1 }));
    }
    setCalendarOpen(true);
    return [
      nextPreview.summary,
      ...nextPreview.assumptions,
      'I placed this plan on your calendar as one draft. Select **Save changes** to apply it.',
    ].filter(Boolean).join('\n\n');
  }, [timeZone]);

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

    // Exact user-authored calendar operations go through the deterministic
    // scheduler before any model request. The model must never decide whether
    // 10 PM means 10 AM, whether two ISO intervals overlap, or whether a
    // calendar change happened. This also avoids charging for requests the
    // local scheduler can answer completely.
    const commandContext = {
      ...context,
      now: new Date().toISOString(),
      selectedTaskId: taskId,
      selectedEventId,
    };

    const queryTerms = normalized.toLocaleLowerCase().match(/[a-z0-9]{3,}/g) || [];
    const providerTasks = [...assistantContextTasks].sort((left, right) => {
      const leftText = `${left.title} ${left.course_name || ''}`.toLocaleLowerCase();
      const rightText = `${right.title} ${right.course_name || ''}`.toLocaleLowerCase();
      const leftMatches = queryTerms.reduce((count, term) => count + (leftText.includes(term) ? 1 : 0), 0);
      const rightMatches = queryTerms.reduce((count, term) => count + (rightText.includes(term) ? 1 : 0), 0);
      return rightMatches - leftMatches;
    });
    const commandNow = new Date(commandContext.now).getTime();
    const scheduledTaskIds = new Set(entries
      .filter(entry => Boolean(entry.scheduledDate && entry.startAt))
      .map(entry => entry.taskId));
    const taskSummary = {
      pendingTotal: pendingTasks.length,
      overdueTotal: pendingTasks.filter(task => {
        const deadline = plannerTaskDeadline(task, timeZone);
        return deadline !== null && new Date(deadline).getTime() < commandNow;
      }).length,
      scheduledTotal: pendingTasks.filter(task => scheduledTaskIds.has(task.id)).length,
      includedTotal: Math.min(30, providerTasks.length),
    };
    // Send only the currently visible exact draft for conversational
    // corrections/confirmations. Broad plans carry richer constraints in
    // previewPlanRequest and must not be flattened into this smaller shape.
    const activeExactDraft = preview?.status === 'ready'
      && preview.actions.length > 0
      && previewPlanRequest === null
      ? {
          kind: 'exact_commands' as const,
          summary: preview.summary,
          taskScope: null,
          taskIds: [],
          normalizedCommands: preview.commands,
          createdAt: previewPlanNow,
        }
      : null;
    // This local context lets the deterministic intent resolver understand
    // relative clocks and named work before either the read-only query path or
    // the external provider can reinterpret the request.
    const browserIntentContext: PlannerCommandAIContext = {
      now: commandContext.now,
      timeZone,
      selectedTaskId: taskId,
      selectedDate: localDate(selectedDate),
      availableStartTime: plannerSettings.weekendAvailableStart,
      availableEndTime: plannerSettings.bedtime,
      tasks: providerTasks.slice(0, 30).map(task => ({
        id: task.id,
        title: cleanAssistantText(task.title, 180),
        description: null,
        dueDate: task.due_date,
        dueTime: task.due_time,
      })),
      taskSummary,
      exams: [],
      occurrences: [],
      busy: [],
      activeDraft: activeExactDraft,
    };

    // Mutations take precedence over factual keyword matching. This matters
    // for natural requests such as “schedule my overdue work, which will take
    // four hours”: the relative word “which” must not turn the request into a
    // read-only overdue query.
    const localPlanRequest = inferPlannerChatPlanRequest(
      conversation.map(message => ({ role: message.role, content: message.content })),
      browserIntentContext,
    );
    if (localPlanRequest) {
      const nextPreview = buildAssistantTaskPlan({
        request: localPlanRequest,
        now: commandContext.now,
        timeZone,
        tasks,
        entries,
        occurrences: context.occurrences,
        busy: context.busy,
        settings: plannerSettings,
        estimateCache: plannerRecord?.estimateCache || {},
        feedbackMultipliers: plannerRecord?.feedbackMultipliers || {},
      });
      const assistantReply = presentTaskPlanPreview(localPlanRequest, nextPreview, commandContext.now);
      setMessages(previous => [...previous, {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: assistantReply,
      }].slice(-CHAT_DISPLAY_LIMIT));
      return;
    }

    const factualResult = resolveAssistantTaskQuery({
      message: normalized,
      now: commandContext.now,
      timeZone,
      tasks,
    });
    if (factualResult) {
      setMessages(previous => [...previous, {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: factualResult.reply,
      }].slice(-CHAT_DISPLAY_LIMIT));
      return;
    }

    // Resolve "schedule them/those" from the immediately preceding factual
    // task answer using stable local task IDs. This cannot revive an older
    // request because both the last assistant reply and its preceding user
    // question must match the freshly derived local result.
    const lastAssistantMessage = messages.at(-1);
    const priorUserMessage = [...messages].reverse().find(message => message.role === 'user');
    const priorTaskResult = priorUserMessage
      ? resolveAssistantTaskQuery({
          message: priorUserMessage.content,
          now: commandContext.now,
          timeZone,
          tasks,
        })
      : null;
    const schedulesReferencedTasks = /\b(?:fit|move|plan|rebalance|replan|reschedule|schedule|spread)\b[\s\S]*\b(?:them|those|these)\b/i.test(normalized);
    if (
      schedulesReferencedTasks
      && priorTaskResult
      && priorTaskResult.taskIds.length > 0
      && lastAssistantMessage?.role === 'assistant'
      && lastAssistantMessage.content === priorTaskResult.reply
    ) {
      const referencedRequest: AssistantTaskPlanRequest = {
        taskScope: 'task_ids',
        taskIds: priorTaskResult.taskIds,
        startDate: null,
        horizonDays: 7,
        todayLoad: /\b(?:skip|avoid) today\b|\bnot today\b/i.test(normalized)
          ? 'skip'
          : /\b(?:busy today|keep today light|do not overload today|don't overload today)\b/i.test(normalized)
            ? 'light'
            : 'normal',
        includeAlreadyScheduled: /\b(?:rebalance|replan|reschedule|move)\b/i.test(normalized),
        availableAfter: null,
        availableBefore: null,
        additionalTasks: [],
      };
      const referencedPreview = buildAssistantTaskPlan({
        request: referencedRequest,
        now: commandContext.now,
        timeZone,
        tasks,
        entries,
        occurrences: context.occurrences,
        busy: context.busy,
        settings: plannerSettings,
        estimateCache: plannerRecord?.estimateCache || {},
        feedbackMultipliers: plannerRecord?.feedbackMultipliers || {},
      });
      const assistantReply = presentTaskPlanPreview(
        referencedRequest,
        referencedPreview,
        commandContext.now,
      );
      setMessages(previous => [...previous, {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: assistantReply,
      }].slice(-CHAT_DISPLAY_LIMIT));
      return;
    }

    const directPreview = interpretDirectScheduleRequest(normalized, commandContext);
    if (directPreview) {
      const assistantReply = presentCommandPreview(directPreview, commandContext.now);
      setMessages(previous => [...previous, {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: assistantReply,
      }].slice(-CHAT_DISPLAY_LIMIT));
      return;
    }

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
            tasks: providerTasks.slice(0, 30).map(task => ({
              id: task.id,
              title: cleanAssistantText(task.title, 180),
              description: cleanAssistantText(task.description),
              dueDate: task.due_date,
              dueTime: task.due_time,
            })),
            taskSummary,
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
            activeDraft: browserIntentContext.activeDraft,
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
      if (payload.planRequest) {
        const planRequest = sanitizePlannerChatPlanRequest(payload.planRequest);
        if (!planRequest) throw new Error('The Assistant returned an invalid planning request. Please try again.');
        if (!plannerChatPlanRequestPreservesIntent(
          conversation.map(message => ({ role: message.role, content: message.content })),
          planRequest,
          browserIntentContext,
        )) {
          assistantReply = 'I understood the main planning request, but I could not preserve every constraint safely, so I did not make a looser plan. Rephrase it as separate changes or give me the exact tasks and times.';
          setMessages(previous => [...previous, {
            id: assistantMessageId,
            role: 'assistant' as const,
            content: assistantReply,
          }].slice(-CHAT_DISPLAY_LIMIT));
          return;
        }
        const nextPreview = buildAssistantTaskPlan({
          request: planRequest,
          now: commandContext.now,
          timeZone,
          tasks,
          entries,
          occurrences: context.occurrences,
          busy: context.busy,
          settings: plannerSettings,
          estimateCache: plannerRecord?.estimateCache || {},
          feedbackMultipliers: plannerRecord?.feedbackMultipliers || {},
        });
        assistantReply = presentTaskPlanPreview(planRequest, nextPreview, commandContext.now);
      } else if (payload.normalizedCommands.length > 0) {
        // Treat even our own API response as untrusted input. The server
        // performs the same check, but this second boundary prevents a stale,
        // cached, or tampered response from staging a different operation,
        // clock, duration, date, or target in the browser.
        if (!plannerChatNormalizedCommandsPreserveIntent(
          conversation.map(message => ({ role: message.role, content: message.content })),
          payload.normalizedCommands,
          browserIntentContext,
        )) {
          assistantReply = 'I could not preserve every exact detail in that request, so I made no calendar changes. Rephrase it or give me the exact item, date, time, and duration.';
          setMessages(previous => [...previous, {
            id: assistantMessageId,
            role: 'assistant' as const,
            content: assistantReply,
          }].slice(-CHAT_DISPLAY_LIMIT));
          return;
        }
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
        assistantReply = presentCommandPreview(nextPreview, commandContext.now);
      } else if (isUnverifiedCalendarOutcome(assistantReply)) {
        // A prose-only model response has no validated action or collision
        // result behind it. Never present such a claim as calendar truth.
        assistantReply = 'I could not verify that calendar claim, so I did not use it. Tell me the item, date, start time, and either an end time or duration, and Orderly will check the real calendar directly.';
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
  }, [assistantContextTasks, chatOwnerUserId, command, context, entries, exams, isThinking, messages, pendingTasks, plannerRecord, plannerSettings, presentCommandPreview, presentTaskPlanPreview, preview, previewPlanNow, previewPlanRequest, selectedDate, selectedEventId, selectedTaskId, subjects, tasks, timeZone, userId]);

  const applyPreview = useCallback(async () => {
    if (!userId || !preview || preview.status !== 'ready' || preview.actions.length === 0) return;
    const currentLocalDate = localDate(dateCarrierInTimeZone(timeZone));
    if (!previewValidatedLocalDate || previewValidatedLocalDate !== currentLocalDate) {
      setPreview(null);
      setPreviewPlanRequest(null);
      setPreviewPlanNow(null);
      setPreviewAnchorDate(null);
      setPreviewValidatedLocalDate(null);
      setMessages(previous => [...previous, {
        id: `assistant-expired-${Date.now()}`,
        role: 'assistant' as const,
        content: 'That calendar draft expired at midnight, so I did not apply it. Ask me again and I will make a fresh draft for today.',
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.info('Calendar draft expired');
      return;
    }
    const saveNow = new Date().toISOString();
    const refreshedPreview = previewPlanRequest
      ? buildAssistantTaskPlan({
          request: previewPlanRequest,
          now: saveNow,
          timeZone,
          tasks,
          entries,
          occurrences: context.occurrences,
          busy: context.busy,
          settings: plannerSettings,
          estimateCache: plannerRecord?.estimateCache || {},
          feedbackMultipliers: plannerRecord?.feedbackMultipliers || {},
        })
      : interpretScheduleCommands(preview.commands, {
          ...context,
          // Midnight expiry guarantees that relative date words still resolve
          // to the same local day. The stored anchor keeps commands without an
          // explicit date on their original absolute calendar date.
          now: saveNow,
          selectedTaskId,
          selectedDate: previewAnchorDate || context.selectedDate,
        });
    const freshPreview = withoutPastPlacements(refreshedPreview, saveNow);
    if (
      freshPreview.status !== 'ready'
      || JSON.stringify(freshPreview.actions) !== JSON.stringify(preview.actions)
    ) {
      setPreview(freshPreview);
      setPreviewPlanNow(saveNow);
      setPreviewAnchorDate(
        freshPreview.status === 'ready'
          ? freshPreview.occurrences[0]?.date || previewAnchorDate
          : null,
      );
      setPreviewValidatedLocalDate(freshPreview.status === 'ready' ? currentLocalDate : null);
      setMessages(previous => [...previous, {
        id: `assistant-recheck-${Date.now()}`,
        role: 'assistant' as const,
        content: 'Your schedule changed while we were chatting, so I refreshed the draft on the calendar. Check it and save again.',
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.info('Calendar draft refreshed');
      return;
    }
    const before = currentScheduleEntries(userId);
    const createdTaskIds: string[] = [];
    const createdCommitmentIds: string[] = [];
    const affectedScheduleTaskIds = new Set<string>();
    const commitmentSnapshots = new Map<string, RecurringCommitmentInput>();
    const operationUserId = userId;
    const operationGeneration = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = operationGeneration;
    const operationIsCurrent = () => plannerMutationIsCurrent({
      operationUserId,
      operationGeneration,
      currentUserId: activeUserIdRef.current,
      currentGeneration: mutationGenerationRef.current,
    });
    const rollbackCreatedResources = async () => {
      const appliedEntries = cloneEntries(selectScheduleEntriesForUser(
        useScheduleStore.getState().entriesByUser,
        operationUserId,
      ));
      const cleanup = await deleteCreatedTasks(
        createdTaskIds,
        id => deleteTask(id, { silent: true }),
      );
      finalizeTaskCreations(cleanup.deletedTaskIds);
      for (const id of createdCommitmentIds) removeCommitment(operationUserId, id);
      for (const commitment of commitmentSnapshots.values()) {
        upsertCommitment(operationUserId, cloneCommitment(commitment));
      }
      const currentEntries = selectScheduleEntriesForUser(
        useScheduleStore.getState().entriesByUser,
        operationUserId,
      );
      const scheduleRestore = restoreScheduleSnapshotPreservingChanges(
        before,
        appliedEntries,
        currentEntries,
      );
      if (scheduleRestore.restoredTaskIds.length > 0) {
        replaceUserSchedules(operationUserId, cloneEntries(scheduleRestore.entries));
      }
      return cleanup;
    };
    setApplying(true);
    try {
      for (const action of freshPreview.actions) {
        if (!operationIsCurrent()) {
          await rollbackCreatedResources();
          return;
        }
        if (action.type === 'schedule_batch') {
          applyScheduleBatch(operationUserId, action.operations);
          for (const operation of action.operations) affectedScheduleTaskIds.add(operation.taskId);
          continue;
        }
        if (action.type === 'create_event') {
          const commitmentId = `event-${crypto.randomUUID()}`;
          const commitment = scheduleEventActionToCommitment(action, {
            id: commitmentId,
            timeZone,
            updatedAt: new Date().toISOString(),
            color: '#3b82f6',
          });
          if (!commitment) throw new Error('The event could not be created.');
          upsertCommitment(operationUserId, commitment);
          createdCommitmentIds.push(commitmentId);
          setSelectedEventId(commitmentId);
          continue;
        }
        if (action.type === 'update_event') {
          const commitment = commitmentById.get(action.commitmentId);
          const startAt = action.schedule.startAt;
          const durationSeconds = action.schedule.durationSeconds;
          if (!commitment || commitment.kind === 'school' || !startAt || !durationSeconds) {
            throw new Error('That event could not be updated.');
          }
          const endAt = new Date(new Date(startAt).getTime() + durationSeconds * 1_000);
          const eventTimeZone = commitment.timeZone || timeZone;
          const scheduledDate = localDateFromIso(startAt, eventTimeZone);
          const startTime = localTimeFromIso(startAt, eventTimeZone);
          const endTime = localTimeFromIso(endAt.toISOString(), eventTimeZone);
          if (!scheduledDate || !startTime || !endTime) throw new Error('That event time is invalid.');
          if (!commitmentSnapshots.has(commitment.id)) {
            commitmentSnapshots.set(commitment.id, cloneCommitment(commitment));
          }
          upsertCommitment(operationUserId, withCommitmentOccurrenceOverride(
            commitment,
            action.occurrenceDate,
            { scheduledDate, startTime, endTime },
          ));
          setSelectedEventId(commitment.id);
          continue;
        }
        if (action.type === 'remove_event') {
          const commitment = commitmentById.get(action.commitmentId);
          if (!commitment || commitment.kind === 'school') throw new Error('That event could not be removed.');
          if (!commitmentSnapshots.has(commitment.id)) {
            commitmentSnapshots.set(commitment.id, cloneCommitment(commitment));
          }
          if (action.wholeSeries) removeCommitment(operationUserId, commitment.id);
          else upsertCommitment(operationUserId, withCommitmentOccurrenceOverride(
            commitment,
            action.occurrenceDate,
            { skipped: true },
          ));
          setSelectedEventId(action.wholeSeries ? null : commitment.id);
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
        }, { reversible: true });
        if (!created) throw new Error('The task could not be created.');
        createdTaskIds.push(created.id);
        affectedScheduleTaskIds.add(created.id);
        if (!operationIsCurrent()) {
          await rollbackCreatedResources();
          return;
        }
        applyScheduleBatch(operationUserId, [{ type: 'upsert', taskId: created.id, input: action.schedule }]);
      }
      if (!operationIsCurrent()) {
        await rollbackCreatedResources();
        return;
      }
      const [schedulePersisted, plannerPersisted] = await Promise.all([
        affectedScheduleTaskIds.size > 0
          ? waitForSchedulePersistence(operationUserId, [...affectedScheduleTaskIds])
          : Promise.resolve(true),
        createdCommitmentIds.length > 0 || commitmentSnapshots.size > 0
          ? waitForPlannerPersistence(operationUserId)
          : Promise.resolve(true),
      ]);
      if (!operationIsCurrent()) {
        await rollbackCreatedResources();
        return;
      }
      if (!schedulePersisted || !plannerPersisted) {
        throw new Error('Orderly could not confirm that every calendar change reached the database. Nothing was reported as saved.');
      }
      installUndoState({
        userId: operationUserId,
        entries: before,
        createdTaskIds,
        createdCommitmentIds,
        commitmentSnapshots: [...commitmentSnapshots.values()].map(cloneCommitment),
        label: freshPreview.summary,
      });
      setMessages(previous => [...previous, {
        id: `applied-${Date.now()}`,
        role: 'assistant' as const,
        content: `Done — ${freshPreview.summary}`,
      }].slice(-CHAT_DISPLAY_LIMIT));
      toast.success('Schedule updated');
      setPreview(null);
      setPreviewPlanRequest(null);
      setPreviewPlanNow(null);
      setPreviewAnchorDate(null);
      setPreviewValidatedLocalDate(null);
      setCommand('');
      setSelectedTaskId(null);
    } catch (error) {
      if (!operationIsCurrent()) {
        await rollbackCreatedResources();
        return;
      }
      const cleanup = await rollbackCreatedResources();
      if (!operationIsCurrent()) return;
      const errorMessage = error instanceof Error ? error.message : 'Could not update the schedule';
      if (cleanup.failedTaskIds.length > 0) {
        const recoveredEntries = cloneEntries(selectScheduleEntriesForUser(
          useScheduleStore.getState().entriesByUser,
          operationUserId,
        ));
        installUndoState({
          userId: operationUserId,
          entries: recoveredEntries,
          appliedEntries: recoveredEntries,
          createdTaskIds: cleanup.failedTaskIds,
          createdCommitmentIds: [],
          label: 'incomplete Assistant change',
          recoveryOnly: true,
        });
        setMessages(previous => [...previous, {
          id: `assistant-cleanup-${Date.now()}`,
          role: 'assistant' as const,
          content: `${errorMessage} I restored the calendar, but ${cleanup.failedTaskIds.length} created task${cleanup.failedTaskIds.length === 1 ? '' : 's'} could not be removed yet. Use Retry cleanup to finish safely.`,
        }].slice(-CHAT_DISPLAY_LIMIT));
        toast.error('Update failed; task cleanup still needs to be retried');
      } else {
        setMessages(previous => [...previous, {
          id: `assistant-save-error-${Date.now()}`,
          role: 'assistant' as const,
          content: `${errorMessage} I did not mark the change as saved; you can retry it from the calendar draft.`,
        }].slice(-CHAT_DISPLAY_LIMIT));
        toast.error(errorMessage);
      }
    } finally {
      if (operationIsCurrent()) setApplying(false);
    }
  }, [addTask, applyScheduleBatch, commitmentById, context, deleteTask, entries, finalizeTaskCreations, installUndoState, plannerRecord?.estimateCache, plannerRecord?.feedbackMultipliers, plannerSettings, preview, previewAnchorDate, previewPlanRequest, previewValidatedLocalDate, removeCommitment, replaceUserSchedules, selectedTaskId, tasks, timeZone, upsertCommitment, userId, waitForPlannerPersistence, waitForSchedulePersistence]);

  const undo = useCallback(async () => {
    if (!userId || !undoState || undoState.userId !== userId) return;
    const snapshot = undoState;
    const operationUserId = snapshot.userId;
    const operationGeneration = mutationGenerationRef.current + 1;
    mutationGenerationRef.current = operationGeneration;
    inFlightUndoRef.current = snapshot;
    const operationIsCurrent = () => plannerMutationIsCurrent({
      operationUserId,
      operationGeneration,
      currentUserId: activeUserIdRef.current,
      currentGeneration: mutationGenerationRef.current,
    });
    setApplying(true);
    try {
      const cleanup = await deleteCreatedTasks(
        snapshot.createdTaskIds,
        id => deleteTask(id, { silent: true }),
      );
      finalizeTaskCreations(cleanup.deletedTaskIds);

      // Local calendar rollback is account-keyed and must finish even if the
      // active account changes while the remote task deletions are pending.
      for (const commitmentId of snapshot.createdCommitmentIds || []) {
        removeCommitment(operationUserId, commitmentId);
      }
      for (const commitment of snapshot.commitmentSnapshots || []) {
        upsertCommitment(operationUserId, cloneCommitment(commitment));
      }

      let storedEventRestoreFailed = false;
      if ((snapshot.storedEventSnapshots || []).length > 0) {
        try {
          const restoredEvents = restoreStoredEventSnapshots(
            readStoredCalendarEvents(operationUserId),
            snapshot.storedEventSnapshots || [],
          );
          writeStoredCalendarEvents(operationUserId, restoredEvents);
          if (operationIsCurrent()) setStoredEvents(restoredEvents);
        } catch {
          storedEventRestoreFailed = true;
        }
      }
      const currentEntries = selectScheduleEntriesForUser(
        useScheduleStore.getState().entriesByUser,
        operationUserId,
      );
      const scheduleRestore = restoreScheduleSnapshotPreservingChanges(
        snapshot.entries,
        snapshot.appliedEntries || snapshot.entries,
        currentEntries,
      );
      if (scheduleRestore.restoredTaskIds.length > 0) {
        replaceUserSchedules(operationUserId, cloneEntries(scheduleRestore.entries));
      }

      if (!operationIsCurrent()) return;
      if (cleanup.failedTaskIds.length > 0 || storedEventRestoreFailed) {
        const recoveredEntries = cloneEntries(selectScheduleEntriesForUser(
          useScheduleStore.getState().entriesByUser,
          operationUserId,
        ));
        const recoverySnapshot: UndoState = {
          ...snapshot,
          entries: recoveredEntries,
          appliedEntries: recoveredEntries,
          createdTaskIds: cleanup.failedTaskIds,
          createdCommitmentIds: [],
          commitmentSnapshots: [],
          storedEventSnapshots: storedEventRestoreFailed ? snapshot.storedEventSnapshots : [],
          recoveryOnly: true,
        };
        activeUndoRef.current = recoverySnapshot;
        setUndoState(recoverySnapshot);
        setMessages(previous => [...previous, {
          id: `undo-failed-${Date.now()}`,
          role: 'assistant' as const,
          content: storedEventRestoreFailed
            ? 'I restored the account schedule, but the browser calendar event could not be restored yet. Retry cleanup when browser storage is available.'
            : `I restored the calendar, but I could not remove ${cleanup.failedTaskIds.length} created task${cleanup.failedTaskIds.length === 1 ? '' : 's'}. Retry cleanup when the connection is stable.`,
        }].slice(-CHAT_DISPLAY_LIMIT));
        toast.error('Undo incomplete; retry cleanup');
        return;
      }
      finalizeTaskCreations(snapshot.createdTaskIds);
      setMessages(previous => [...previous, {
        id: `undo-${Date.now()}`,
        role: 'assistant' as const,
        content: snapshot.recoveryOnly
          ? 'Cleanup completed.'
          : scheduleRestore.skippedTaskIds.length > 0
            ? `Undid: ${snapshot.label}. I kept ${scheduleRestore.skippedTaskIds.length} newer schedule change${scheduleRestore.skippedTaskIds.length === 1 ? '' : 's'} made while Undo was running.`
            : `Undid: ${snapshot.label}`,
      }].slice(-CHAT_DISPLAY_LIMIT));
      activeUndoRef.current = null;
      setUndoState(null);
      toast.success(snapshot.recoveryOnly ? 'Cleanup completed' : 'Last schedule change undone');
    } finally {
      if (inFlightUndoRef.current === snapshot) inFlightUndoRef.current = null;
      if (operationIsCurrent()) setApplying(false);
    }
  }, [deleteTask, finalizeTaskCreations, removeCommitment, replaceUserSchedules, setStoredEvents, undoState, upsertCommitment, userId]);

  const persistCommitmentOccurrence = useCallback((
    block: PlannerBlockView,
    nextStart: Date,
    nextEnd: Date,
    undoLabel: string,
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
      const previousEvent = storedEvents.find(event => event.id === block.calendarEventId);
      if (!previousEvent) return false;
      const nextEvents = storedEvents.map(event => event.id === block.calendarEventId
        ? { ...event, occurrenceOverrides: updated.occurrenceOverrides }
        : event);
      try {
        writeStoredCalendarEvents(userId, nextEvents);
        setStoredEvents(nextEvents);
      } catch {
        toast.error('That calendar event could not be updated');
        return false;
      }
      installUndoState({
        userId,
        entries: currentScheduleEntries(userId),
        createdTaskIds: [],
        storedEventSnapshots: [cloneStoredEvent(previousEvent)],
        label: undoLabel,
      });
    } else {
      upsertCommitment(userId, updated);
      installUndoState({
        userId,
        entries: currentScheduleEntries(userId),
        createdTaskIds: [],
        commitmentSnapshots: [cloneCommitment(commitment)],
        label: undoLabel,
      });
    }
    return true;
  }, [commitmentById, installUndoState, setStoredEvents, storedEvents, timeZone, upsertCommitment, userId]);

  const handleMove = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId || applying) return;
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That time overlaps “${conflict.title}”.`);
      return;
    }
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      if (persistCommitmentOccurrence(block, nextStart, nextEnd, `Move “${block.title}”`)) {
        toast.success(`${block.title} moved`);
      }
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
    const previousEntries = currentScheduleEntries(userId);
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
    installUndoState({ userId, entries: previousEntries, createdTaskIds: [], label: `Move “${task.title}”` });
  }, [applying, blocks, entries, installUndoState, moveOccurrence, occurrenceById, persistCommitmentOccurrence, timeZone, upsertTaskSchedule, userId]);

  const handleResize = useCallback((block: PlannerBlockView, nextStart: Date, nextEnd: Date) => {
    if (!userId || applying) return;
    const conflict = conflictingBlock(blocks, block.id, nextStart, nextEnd);
    if (conflict) {
      toast.error(`That duration overlaps “${conflict.title}”.`);
      return;
    }
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence) {
      if (persistCommitmentOccurrence(block, nextStart, nextEnd, `Resize “${block.title}”`)) {
        toast.success(`${block.title} updated`);
      }
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
    const previousEntries = currentScheduleEntries(userId);
    if (!entry || occurrence.recurrence === 'none') {
      upsertTaskSchedule(userId, task.id, {
        ...occurrenceScheduleInput(entry, occurrence),
        durationSeconds,
      });
    } else {
      resizeOccurrence(userId, task.id, occurrence.recurrenceSourceDate, durationSeconds);
    }
    installUndoState({ userId, entries: previousEntries, createdTaskIds: [], label: `Resize “${task.title}”` });
  }, [applying, blocks, entries, installUndoState, occurrenceById, persistCommitmentOccurrence, resizeOccurrence, timeZone, upsertTaskSchedule, userId]);

  const handleScheduleUntimed = useCallback((
    item: UntimedScheduleItem,
    nextStart: Date,
    nextEnd: Date,
  ) => {
    if (!userId || applying) return;
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
    const previousEntries = currentScheduleEntries(userId);
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
    installUndoState({ userId, entries: previousEntries, createdTaskIds: [], label: `Schedule “${occurrence.title}”` });
    toast.success(`${occurrence.title} scheduled`);
  }, [applying, blocks, entries, installUndoState, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

  const handleMoveToUntimed = useCallback((block: PlannerBlockView, targetDate?: string) => {
    if (!userId || applying) return;
    const occurrence = occurrenceById.get(block.id);
    if (!occurrence?.startAt) return;
    const entry = entries.find(candidate => candidate.taskId === occurrence.taskId);
    const durationSeconds = occurrence.durationSeconds || 30 * 60;
    const nextDate = targetDate || occurrence.date;
    const previousEntries = currentScheduleEntries(userId);
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
    installUndoState({ userId, entries: previousEntries, createdTaskIds: [], label: `Move “${occurrence.title}” to untimed` });
    toast.success(`${occurrence.title} moved to untimed`);
  }, [applying, entries, installUndoState, occurrenceById, setOccurrenceOverride, timeZone, upsertTaskSchedule, userId]);

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
    setPreviewPlanRequest(null);
    setPreviewPlanNow(null);
    setPreviewAnchorDate(null);
    setPreviewValidatedLocalDate(null);
    setSelectedTaskId(null);
    setSelectedEventId(null);
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
            <Button type="button" variant="outline" size="sm" disabled={applying} onClick={() => void undo()}>
              <Undo2 className="h-4 w-4" /> {undoState.recoveryOnly ? 'Retry cleanup' : 'Undo'}
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
                        setPreviewPlanRequest(null);
                        setPreviewPlanNow(null);
                        setPreviewAnchorDate(null);
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
                onEmptySlotClick={handleEmptySlotClick}
                onBlockClick={handleBlockClick}
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

      <TaskForm
        isOpen={Boolean(editingTask || editingCommitment || creationSlot)}
        task={editingTask}
        commitment={editingCommitment}
        initialMode="task"
        initialDate={creationSlot?.date || ''}
        initialStartTime={creationSlot?.startTime || ''}
        initialDurationSeconds={creationSlot?.durationSeconds || null}
        onClose={closeTaskForm}
        onSaved={() => {
          if (!editingCommitment?.id.startsWith('calendar-')) return;
          const legacyId = editingCommitment.id.slice('calendar-'.length);
          const nextEvents = storedEvents.filter(event => event.id !== legacyId);
          try {
            writeStoredCalendarEvents(userId, nextEvents);
            setStoredEvents(nextEvents);
          } catch {
            toast.error('The calendar event was saved, but its old copy could not be removed');
          }
        }}
      />
    </div>
  );
}
