import type { Task } from '@/lib/supabase/types';
import { plannerTaskDeadline, taskToPlannerInput } from './adapters';
import { estimatePlannerTask, normalizePlannerSettings, plannerHash } from './engine';
import type {
  PlannerEstimateCacheEntry,
  PlannerFeedbackMultiplier,
  PlannerSettings,
} from './types';
import {
  addLocalDays,
  localDateFromIso,
  localDateTimeToIso,
} from '@/lib/schedule/selectors';
import type {
  LocalDate,
  ScheduleBatchOperation,
  ScheduleEntry,
  ScheduleOccurrence,
} from '@/lib/schedule/types';
import type {
  ScheduleCommandBusyInterval,
  ScheduleCommandPreview,
} from '@/lib/schedule/commands';

const MINUTE_MS = 60_000;

export type AssistantTaskPlanScope =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'this_week'
  | 'all_pending'
  | 'task_ids';

/**
 * High-level intent produced by the language model. Clock arithmetic and task
 * selection remain deterministic and local to Orderly.
 */
export interface AssistantTaskPlanRequest {
  taskScope: AssistantTaskPlanScope;
  taskIds: string[];
  startDate: LocalDate | null;
  horizonDays: number;
  todayLoad: 'normal' | 'light' | 'skip';
  includeAlreadyScheduled: boolean;
}

export interface AssistantTaskPlanInput {
  request: AssistantTaskPlanRequest;
  now: string;
  timeZone: string;
  tasks: readonly Task[];
  entries: readonly ScheduleEntry[];
  occurrences: readonly ScheduleOccurrence[];
  busy?: readonly ScheduleCommandBusyInterval[];
  settings: PlannerSettings;
  estimateCache?: Readonly<Record<string, PlannerEstimateCacheEntry>>;
  feedbackMultipliers?: Readonly<Record<string, PlannerFeedbackMultiplier>>;
}

interface Interval {
  start: number;
  end: number;
}

interface PlannedTask {
  task: Task;
  deadline: number | null;
  minutes: number;
  estimateReasons: string[];
}

interface Placement {
  task: Task;
  date: LocalDate;
  start: number;
  end: number;
  minutes: number;
  deadline: number | null;
}

function isTimedScheduleEntry(entry: ScheduleEntry): boolean {
  return Boolean(entry.scheduledDate && validTimestamp(entry.startAt) !== null);
}

function localDayOfWeek(date: LocalDate): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function roundMinutesToSlot(minutes: number, slotMinutes: number): number {
  return Math.max(slotMinutes, Math.round(minutes / slotMinutes) * slotMinutes);
}

function ceilToSlot(timestamp: number, slotMinutes: number): number {
  const slotMs = slotMinutes * MINUTE_MS;
  return Math.ceil(timestamp / slotMs) * slotMs;
}

function validTimestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function priorityRank(task: Task): number {
  if (task.priority === 'high') return 0;
  if (task.priority === 'medium') return 1;
  return 2;
}

function scheduledTaskIds(
  entries: readonly ScheduleEntry[],
  occurrences: readonly ScheduleOccurrence[],
  now: number,
  today: LocalDate,
): Set<string> {
  const scheduled = new Set<string>();

  // Concrete occurrences are authoritative when available. A schedule that
  // already ended is historical evidence, not a reason to hide unfinished
  // work from a new planning request.
  for (const occurrence of occurrences) {
    if (!occurrence.timed) continue;
    const start = validTimestamp(occurrence.startAt);
    const end = validTimestamp(occurrence.endAt);
    if (start !== null && (end ?? start) > now) scheduled.add(occurrence.taskId);
  }

  // Keep a fallback for callers that have not materialized occurrences yet.
  // Recurring rows remain active until their configured end date, while a
  // one-off row is active only until its actual duration has elapsed.
  for (const entry of entries) {
    if (!isTimedScheduleEntry(entry)) continue;
    if (entry.recurrence !== 'none') {
      if (!entry.recurrenceEndDate || entry.recurrenceEndDate >= today) {
        scheduled.add(entry.taskId);
      }
      continue;
    }
    const start = validTimestamp(entry.startAt);
    if (start === null) continue;
    const durationMs = Math.max(0, entry.durationSeconds ?? 0) * 1_000;
    if (start + durationMs > now) scheduled.add(entry.taskId);
  }

  return scheduled;
}

function selectTasks(
  request: AssistantTaskPlanRequest,
  tasks: readonly Task[],
  entries: readonly ScheduleEntry[],
  occurrences: readonly ScheduleOccurrence[],
  now: number,
  timeZone: string,
  today: LocalDate,
): Task[] {
  const tomorrow = addLocalDays(today, 1);
  const todayUtc = new Date(`${today}T12:00:00.000Z`);
  const daysUntilSunday = (7 - todayUtc.getUTCDay()) % 7;
  const weekEnd = addLocalDays(today, daysUntilSunday);
  // A duration can be saved before a task is placed on the calendar. Treating
  // that metadata-only row as scheduled would make the task disappear from
  // broad planning even though it is still on the untimed shelf. Likewise, a
  // one-off block that already ended must not suppress unfinished overdue work.
  const scheduled = scheduledTaskIds(entries, occurrences, now, today);
  const requestedIds = new Set(request.taskIds);

  return tasks.filter(task => {
    if (task.status === 'completed') return false;
    if (!request.includeAlreadyScheduled && scheduled.has(task.id)) return false;
    const deadlineIso = plannerTaskDeadline(task, timeZone);
    const deadline = validTimestamp(deadlineIso);
    const deadlineDate = deadlineIso ? localDateFromIso(deadlineIso, timeZone) : null;

    switch (request.taskScope) {
      case 'overdue':
        return deadline !== null && deadline < now;
      case 'today':
        return deadlineDate === today;
      case 'tomorrow':
        return deadlineDate === tomorrow;
      case 'this_week':
        return deadlineDate !== null && deadlineDate >= today && deadlineDate <= weekEnd;
      case 'task_ids':
        return requestedIds.has(task.id);
      case 'all_pending':
        return true;
    }
  });
}

function availabilityForDate(
  date: LocalDate,
  settings: PlannerSettings,
  today: LocalDate,
  now: number,
): Interval | null {
  const schoolDay = settings.schoolDays.includes(localDayOfWeek(date));
  const startTime = schoolDay ? settings.schoolHomeTime : settings.weekendAvailableStart;
  const endTime = schoolDay ? settings.bedtime : settings.weekendAvailableEnd;
  const startIso = localDateTimeToIso(date, `${startTime}:00`, settings.timeZone);
  const endDate = endTime <= startTime ? addLocalDays(date, 1) : date;
  const endIso = localDateTimeToIso(endDate, `${endTime}:00`, settings.timeZone);
  const start = validTimestamp(startIso);
  const end = validTimestamp(endIso);
  if (start === null || end === null || end <= start) return null;
  const effectiveStart = date === today ? Math.max(start, now) : start;
  return effectiveStart < end ? { start: effectiveStart, end } : null;
}

function normalizeBusy(
  input: AssistantTaskPlanInput,
  ignoredOccurrenceIds: ReadonlySet<string>,
  breakMinutes: number,
): Interval[] {
  const intervals: Interval[] = [];
  for (const interval of input.busy || []) {
    if (ignoredOccurrenceIds.has(interval.id)) continue;
    const start = validTimestamp(interval.startAt);
    const end = validTimestamp(interval.endAt);
    if (start !== null && end !== null && end > start) intervals.push({ start, end });
  }
  const breakMs = breakMinutes * MINUTE_MS;
  for (const occurrence of input.occurrences) {
    if (ignoredOccurrenceIds.has(occurrence.id)) continue;
    const start = validTimestamp(occurrence.startAt);
    const end = validTimestamp(occurrence.endAt);
    if (start !== null && end !== null && end > start) {
      // Existing task work follows the same break invariant as newly planned
      // work. Fixed calendar events remain exact and are not padded.
      intervals.push({ start: Math.max(0, start - breakMs), end: end + breakMs });
    }
  }
  return intervals.sort((left, right) => left.start - right.start || left.end - right.end);
}

function minutesAlreadyScheduledByDay(
  occurrences: readonly ScheduleOccurrence[],
  ignoredOccurrenceIds: ReadonlySet<string>,
): Map<LocalDate, number> {
  const totals = new Map<LocalDate, number>();
  for (const occurrence of occurrences) {
    if (!occurrence.startAt || !occurrence.endAt || ignoredOccurrenceIds.has(occurrence.id)) continue;
    const start = validTimestamp(occurrence.startAt);
    const end = validTimestamp(occurrence.endAt);
    if (start === null || end === null || end <= start) continue;
    totals.set(occurrence.date, (totals.get(occurrence.date) || 0) + Math.ceil((end - start) / MINUTE_MS));
  }
  return totals;
}

function firstFreeStart(
  window: Interval,
  durationMinutes: number,
  busy: readonly Interval[],
  slotMinutes: number,
): number | null {
  const durationMs = durationMinutes * MINUTE_MS;
  let candidate = ceilToSlot(window.start, slotMinutes);
  for (const interval of busy) {
    if (interval.end <= candidate || interval.start >= window.end) continue;
    if (candidate + durationMs <= interval.start) return candidate;
    if (candidate < interval.end) candidate = ceilToSlot(interval.end, slotMinutes);
    if (candidate + durationMs > window.end) return null;
  }
  return candidate + durationMs <= window.end ? candidate : null;
}

function localDateLabel(date: LocalDate, timeZone: string): string {
  const noon = localDateTimeToIso(date, '12:00:00', timeZone);
  if (!noon) return date;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(noon));
}

/**
 * Plan a whole task set into real free time. The result is stable for the same
 * snapshot and never treats a passed deadline as a scheduling prohibition.
 */
export function buildAssistantTaskPlan(input: AssistantTaskPlanInput): ScheduleCommandPreview {
  const settings = normalizePlannerSettings({ ...input.settings, timeZone: input.timeZone });
  const now = validTimestamp(input.now) ?? Date.now();
  const today = localDateFromIso(new Date(now).toISOString(), settings.timeZone) as LocalDate;
  const requestedStartDate = input.request.startDate && input.request.startDate >= today
    ? input.request.startDate
    : null;
  // A "tomorrow" request is both a deadline scope and a placement request.
  // Without this deterministic default, its one-day horizon would incorrectly
  // put tomorrow's work on today. An explicit valid future date always wins.
  const startDate = requestedStartDate
    || (input.request.taskScope === 'tomorrow' ? addLocalDays(today, 1) : today);
  const horizonDays = Math.max(1, Math.min(7, Math.trunc(input.request.horizonDays || 7)));
  const horizonDates = Array.from({ length: horizonDays }, (_, index) => addLocalDays(startDate, index));
  const horizonEndDate = horizonDates[horizonDates.length - 1];
  const selectedTasks = selectTasks(
    input.request,
    input.tasks,
    input.entries,
    input.occurrences,
    now,
    settings.timeZone,
    today,
  );
  const entriesByTask = new Map(input.entries.map(entry => [entry.taskId, entry]));
  const activeScheduledIds = scheduledTaskIds(input.entries, input.occurrences, now, today);
  const scheduledSelectedIds = new Set<string>();
  const replacementOccurrences = new Map<string, ScheduleOccurrence>();
  const ignoredOccurrenceIds = new Set<string>();

  if (input.request.includeAlreadyScheduled) {
    for (const task of selectedTasks) {
      const entry = entriesByTask.get(task.id);
      if (!entry || !isTimedScheduleEntry(entry) || !activeScheduledIds.has(task.id)) continue;
      scheduledSelectedIds.add(task.id);
      const candidates = input.occurrences
        .filter(occurrence => (
          occurrence.taskId === task.id
          && occurrence.timed
          && (validTimestamp(occurrence.endAt) ?? validTimestamp(occurrence.startAt) ?? 0) > now
        ))
        .sort((left, right) => (
          (left.startAt || '').localeCompare(right.startAt || '')
          || left.id.localeCompare(right.id)
        ));
      const replacement = entry.recurrence === 'none'
        ? candidates[0]
        : candidates.find(occurrence => occurrence.date >= startDate && occurrence.date <= horizonEndDate);
      if (replacement) {
        replacementOccurrences.set(task.id, replacement);
        // Ignore only the concrete occurrence that will be replaced. Other
        // occurrences in a recurring series must remain collision barriers.
        ignoredOccurrenceIds.add(replacement.id);
      }
    }
  }

  const busy = normalizeBusy(input, ignoredOccurrenceIds, settings.minBreakMinutes);
  const scheduledMinutes = minutesAlreadyScheduledByDay(input.occurrences, ignoredOccurrenceIds);
  const assumptions: string[] = [];

  if (selectedTasks.length === 0) {
    return {
      id: `assistant-plan-${plannerHash({ request: input.request, now: input.now, empty: true })}`,
      command: 'plan tasks',
      commands: [],
      normalizedCommand: 'plan tasks',
      kind: null,
      status: 'query',
      summary: input.request.taskScope === 'overdue'
        ? 'You have no unscheduled overdue tasks to plan.'
        : 'I could not find any matching unscheduled tasks to plan.',
      actions: [],
      assumptions: [],
      candidates: [],
      gaps: [],
      occurrences: [],
    };
  }

  const work: PlannedTask[] = selectedTasks.map(task => {
    const estimate = estimatePlannerTask(
      taskToPlannerInput(task, settings.timeZone),
      input.estimateCache || {},
      input.feedbackMultipliers || {},
    );
    return {
      task,
      deadline: validTimestamp(plannerTaskDeadline(task, settings.timeZone)),
      minutes: roundMinutesToSlot(estimate.finalMinutes, settings.slotMinutes),
      estimateReasons: estimate.reasons,
    };
  }).sort((left, right) => (
    (left.deadline ?? Number.POSITIVE_INFINITY) - (right.deadline ?? Number.POSITIVE_INFINITY)
    || priorityRank(left.task) - priorityRank(right.task)
    || left.task.title.localeCompare(right.task.title)
    || left.task.id.localeCompare(right.task.id)
  ));

  const placements: Placement[] = [];
  const unscheduled: PlannedTask[] = [];
  const afterDeadline = new Set<string>();
  const dailyPlanned = new Map<LocalDate, number>();
  const breakMs = settings.minBreakMinutes * MINUTE_MS;

  for (const item of work) {
    let placement: Placement | null = null;
    const entry = entriesByTask.get(item.task.id);
    if (
      scheduledSelectedIds.has(item.task.id)
      && entry?.recurrence !== 'none'
      && !replacementOccurrences.has(item.task.id)
    ) {
      // A recurring schedule can only be changed safely through a concrete
      // occurrence override. Without one, leave the series untouched and make
      // the rebalance fail atomically below.
      unscheduled.push(item);
      continue;
    }
    for (const requireDeadline of [true, false]) {
      if (requireDeadline && (item.deadline === null || item.deadline < now)) continue;
      for (const date of horizonDates) {
        if (placement) break;
        const availability = availabilityForDate(date, settings, today, now);
        if (!availability) continue;

        const deadlineEnd = requireDeadline && item.deadline !== null
          ? Math.min(availability.end, item.deadline)
          : availability.end;
        if (deadlineEnd <= availability.start) continue;
        const start = firstFreeStart(
          { start: availability.start, end: deadlineEnd },
          item.minutes,
          busy,
          settings.slotMinutes,
        );
        if (start === null) continue;
        const placementDate = localDateFromIso(new Date(start).toISOString(), settings.timeZone) || date;
        if (placementDate < startDate || placementDate > horizonEndDate) continue;
        const normalCap = settings.maxDailyMinutes;
        const requestedCap = placementDate === today && input.request.todayLoad === 'skip'
          ? 0
          : placementDate === today && input.request.todayLoad === 'light'
            ? Math.min(60, Math.max(settings.slotMinutes, roundMinutesToSlot(normalCap / 4, settings.slotMinutes)))
            : normalCap;
        const used = (scheduledMinutes.get(placementDate) || 0) + (dailyPlanned.get(placementDate) || 0);
        if (used + item.minutes > requestedCap) continue;
        const end = start + item.minutes * MINUTE_MS;
        placement = { task: item.task, date: placementDate, start, end, minutes: item.minutes, deadline: item.deadline };
        placements.push(placement);
        dailyPlanned.set(placementDate, (dailyPlanned.get(placementDate) || 0) + item.minutes);
        busy.push({ start: Math.max(0, start - breakMs), end: end + breakMs });
        busy.sort((left, right) => left.start - right.start || left.end - right.end);
        if (item.deadline !== null && end > item.deadline) afterDeadline.add(item.task.id);
      }
      if (placement) break;
    }
    if (!placement) unscheduled.push(item);
  }

  const failedScheduled = unscheduled.filter(item => scheduledSelectedIds.has(item.task.id));
  if (failedScheduled.length > 0) {
    const failedTitles = failedScheduled.map(item => item.task.title).join(', ');
    return {
      id: `assistant-plan-${plannerHash({
        request: input.request,
        now: input.now,
        atomicRebalanceFailed: failedScheduled.map(item => item.task.id),
      })}`,
      command: 'plan tasks',
      commands: [],
      normalizedCommand: 'plan tasks',
      kind: null,
      status: 'clarification',
      summary: `I could not safely rebalance every already-scheduled task inside this ${horizonDays}-day window, so I prepared no changes.`,
      actions: [],
      assumptions: [`These existing schedules were left unchanged: ${failedTitles}.`],
      candidates: [],
      gaps: [],
      occurrences: [],
    };
  }

  if (input.request.todayLoad === 'light') {
    assumptions.push('I kept today light: at most 60 minutes of newly planned work, while still respecting your saved daily limit.');
  } else if (input.request.todayLoad === 'skip') {
    assumptions.push('I left today free and started planning on the next available day.');
  }
  if (afterDeadline.size > 0) {
    assumptions.push(`${afterDeadline.size} overdue or capacity-limited ${afterDeadline.size === 1 ? 'task was' : 'tasks were'} placed at the earliest available time, even though the original deadline has passed.`);
  }
  if (unscheduled.length > 0) {
    assumptions.push(`I could not fit ${unscheduled.length} ${unscheduled.length === 1 ? 'task' : 'tasks'} inside this ${horizonDays}-day window without exceeding your availability or daily workload limit: ${unscheduled.map(item => item.task.title).join(', ')}.`);
  }

  const operations: ScheduleBatchOperation[] = placements.map(placement => {
    const entry = entriesByTask.get(placement.task.id);
    const replacement = replacementOccurrences.get(placement.task.id);
    const scheduledDate = placement.date;
    const startAt = new Date(placement.start).toISOString();
    const durationSeconds = placement.minutes * 60;
    if (scheduledSelectedIds.has(placement.task.id) && entry?.recurrence !== 'none' && replacement) {
      return {
        type: 'override',
        taskId: placement.task.id,
        occurrenceDate: replacement.recurrenceSourceDate,
        override: { scheduledDate, startAt, durationSeconds },
      };
    }
    return {
      type: 'upsert',
      taskId: placement.task.id,
      // Omitting recurrence fields preserves an existing row's recurrence and
      // occurrenceOverrides in the schedule store instead of flattening it.
      input: { scheduledDate, startAt, durationSeconds },
    };
  });
  const coverage = `${placements.length} of ${work.length}`;
  const daysUsed = [...new Set(placements.map(placement => placement.date))];
  const summary = placements.length === 0
    ? `I found ${work.length} matching ${work.length === 1 ? 'task' : 'tasks'}, but none fit inside the requested window and workload limits.`
    : `Scheduled ${coverage} matching ${work.length === 1 ? 'task' : 'tasks'} across ${daysUsed.length} ${daysUsed.length === 1 ? 'day' : 'days'} (${daysUsed.map(date => localDateLabel(date, settings.timeZone)).join(', ')}).`;
  const id = `assistant-plan-${plannerHash({
    request: input.request,
    now: input.now,
    placements: placements.map(placement => [placement.task.id, placement.start, placement.minutes]),
  })}`;

  return {
    id,
    command: 'plan tasks',
    commands: [],
    normalizedCommand: 'plan tasks',
    kind: null,
    status: operations.length > 0 ? 'ready' : 'clarification',
    summary,
    actions: operations.length > 0 ? [{ type: 'schedule_batch', operations }] : [],
    assumptions,
    candidates: [],
    gaps: [],
    occurrences: placements.map(placement => ({
      taskId: placement.task.id,
      title: placement.task.title,
      date: placement.date,
      startAt: new Date(placement.start).toISOString(),
      durationSeconds: placement.minutes * 60,
    })),
  };
}
