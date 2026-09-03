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
  ScheduleCommandAction,
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

export interface AssistantTaskPlanAdditionalTask {
  title: string;
  durationSeconds: number;
}
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
  availableAfter?: string | null;
  availableBefore?: string | null;
  additionalTasks?: readonly AssistantTaskPlanAdditionalTask[];
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
  key: string;
  title: string;
  task: Task | null;
  deadline: number | null;
  durationSeconds: number;
  workloadMinutes: number;
  estimateReasons: string[];
}

interface Placement {
  item: PlannedTask;
  date: LocalDate;
  start: number;
  end: number;
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

function validClock(value: string | null | undefined): string | null {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

function priorityRank(task: Task | null): number {
  if (!task) return 1;
  if (task.priority === 'high') return 0;
  if (task.priority === 'medium') return 1;
  return 2;
}

function additionalWorkItems(
  additionalTasks: readonly AssistantTaskPlanAdditionalTask[] | undefined,
): { items: PlannedTask[]; invalidCount: number } {
  const items: PlannedTask[] = [];
  let invalidCount = 0;

  for (const [index, candidate] of (additionalTasks || []).entries()) {
    const title = typeof candidate?.title === 'string'
      ? candidate.title.trim().replace(/\s+/g, ' ').slice(0, 180)
      : '';
    const durationSeconds = Number.isFinite(candidate?.durationSeconds)
      ? Math.round(candidate.durationSeconds)
      : 0;
    if (!title || durationSeconds <= 0 || durationSeconds > 24 * 60 * 60) {
      invalidCount += 1;
      continue;
    }
    items.push({
      key: `additional-${index}-${plannerHash({ title, durationSeconds })}`,
      title,
      task: null,
      deadline: null,
      durationSeconds,
      workloadMinutes: Math.ceil(durationSeconds / 60),
      estimateReasons: ['Used the duration supplied in chat.'],
    });
  }

  return { items, invalidCount };
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
  availableAfter: string | null,
  availableBefore: string | null,
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

  const requestStart = availableAfter
    ? validTimestamp(localDateTimeToIso(date, `${availableAfter}:00`, settings.timeZone))
    : null;
  let requestEnd: number | null = null;
  if (availableBefore) {
    // An explicit range such as 22:00-01:00 crosses midnight. When only an
    // end clock is supplied, mirror the saved availability's overnight shape.
    const crossesMidnight = availableAfter
      ? availableBefore <= availableAfter
      : endTime <= startTime && availableBefore <= startTime;
    const requestEndDate = crossesMidnight ? addLocalDays(date, 1) : date;
    requestEnd = validTimestamp(localDateTimeToIso(
      requestEndDate,
      `${availableBefore}:00`,
      settings.timeZone,
    ));
  }

  const effectiveStart = Math.max(
    start,
    date === today ? now : start,
    requestStart ?? start,
  );
  const effectiveEnd = Math.min(end, requestEnd ?? end);
  return effectiveStart < effectiveEnd ? { start: effectiveStart, end: effectiveEnd } : null;
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
  durationSeconds: number,
  busy: readonly Interval[],
  slotMinutes: number,
): number | null {
  const durationMs = durationSeconds * 1_000;
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
  const availableAfter = validClock(input.request.availableAfter);
  const availableBefore = validClock(input.request.availableBefore);
  const additional = additionalWorkItems(input.request.additionalTasks);
  const softCompositeDailyLimit = (
    horizonDays === 1
    && additional.items.length > 0
    && Boolean(availableAfter || availableBefore)
  );

  if (selectedTasks.length === 0 && additional.items.length === 0) {
    return {
      id: `assistant-plan-${plannerHash({ request: input.request, now: input.now, empty: true })}`,
      command: 'plan tasks',
      commands: [],
      normalizedCommand: 'plan tasks',
      kind: null,
      status: 'query',
      summary: input.request.taskScope === 'overdue' && !(input.request.additionalTasks?.length)
        ? 'You have no unscheduled overdue tasks to plan.'
        : additional.invalidCount > 0
          ? 'I could not find valid work to plan. Each new activity needs a title and a duration between one second and 24 hours.'
          : 'I could not find any matching unscheduled tasks to plan.',
      actions: [],
      assumptions: [],
      candidates: [],
      gaps: [],
      occurrences: [],
    };
  }

  const selectedWork = selectedTasks.map<PlannedTask>(task => {
    const estimate = estimatePlannerTask(
      taskToPlannerInput(task, settings.timeZone),
      input.estimateCache || {},
      input.feedbackMultipliers || {},
    );
    const minutes = roundMinutesToSlot(estimate.finalMinutes, settings.slotMinutes);
    return {
      key: `task-${task.id}`,
      title: task.title,
      task,
      deadline: validTimestamp(plannerTaskDeadline(task, settings.timeZone)),
      durationSeconds: minutes * 60,
      workloadMinutes: minutes,
      estimateReasons: estimate.reasons,
    };
  });
  const work: PlannedTask[] = [...selectedWork, ...additional.items].sort((left, right) => (
    (left.deadline ?? Number.POSITIVE_INFINITY) - (right.deadline ?? Number.POSITIVE_INFINITY)
    || priorityRank(left.task) - priorityRank(right.task)
    || left.title.localeCompare(right.title)
    || left.key.localeCompare(right.key)
  ));

  const placements: Placement[] = [];
  const unscheduled: PlannedTask[] = [];
  const afterDeadline = new Set<string>();
  const dailyPlanned = new Map<LocalDate, number>();
  const breakMs = settings.minBreakMinutes * MINUTE_MS;

  for (const item of work) {
    let placement: Placement | null = null;
    const entry = item.task ? entriesByTask.get(item.task.id) : undefined;
    if (
      item.task
      && scheduledSelectedIds.has(item.task.id)
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
        const availability = availabilityForDate(
          date,
          settings,
          today,
          now,
          availableAfter,
          availableBefore,
        );
        if (!availability) continue;

        const deadlineEnd = requireDeadline && item.deadline !== null
          ? Math.min(availability.end, item.deadline)
          : availability.end;
        if (deadlineEnd <= availability.start) continue;
        const start = firstFreeStart(
          { start: availability.start, end: deadlineEnd },
          item.durationSeconds,
          busy,
          settings.slotMinutes,
        );
        if (start === null) continue;
        const placementDate = localDateFromIso(new Date(start).toISOString(), settings.timeZone) || date;
        if (placementDate < startDate || placementDate > horizonEndDate) continue;
        const normalCap = settings.maxDailyMinutes;
        const scheduledForDay = scheduledMinutes.get(placementDate) || 0;
        // In a one-day mixed request, an explicit availability boundary is a
        // stronger statement than the user's usual workload target. The real
        // time window (plus collision checks) is still a hard upper bound.
        const constrainedWindowCap = scheduledForDay
          + Math.floor((availability.end - availability.start) / MINUTE_MS);
        const requestedCap = placementDate === today && input.request.todayLoad === 'skip'
          ? 0
          : softCompositeDailyLimit
            ? constrainedWindowCap
          : placementDate === today && input.request.todayLoad === 'light'
            ? Math.min(60, Math.max(settings.slotMinutes, roundMinutesToSlot(normalCap / 4, settings.slotMinutes)))
            : normalCap;
        const used = scheduledForDay + (dailyPlanned.get(placementDate) || 0);
        if (used + item.workloadMinutes > requestedCap) continue;
        const end = start + item.durationSeconds * 1_000;
        placement = { item, date: placementDate, start, end };
        placements.push(placement);
        dailyPlanned.set(
          placementDate,
          (dailyPlanned.get(placementDate) || 0) + item.workloadMinutes,
        );
        busy.push({ start: Math.max(0, start - breakMs), end: end + breakMs });
        busy.sort((left, right) => left.start - right.start || left.end - right.end);
        if (item.deadline !== null && end > item.deadline) afterDeadline.add(item.key);
      }
      if (placement) break;
    }
    if (!placement) unscheduled.push(item);
  }

  const failedScheduled = unscheduled.filter(item => (
    item.task && scheduledSelectedIds.has(item.task.id)
  ));
  if (failedScheduled.length > 0) {
    const failedTitles = failedScheduled.map(item => item.title).join(', ');
    return {
      id: `assistant-plan-${plannerHash({
        request: input.request,
        now: input.now,
        atomicRebalanceFailed: failedScheduled.map(item => item.task?.id),
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

  if (softCompositeDailyLimit && input.request.todayLoad !== 'skip') {
    assumptions.push('For this one-day mixed request, I treated your saved daily workload limit as a soft target and used the actual requested free-time window instead. School, bedtime, and occupied calendar blocks remained hard limits.');
  } else if (input.request.todayLoad === 'light') {
    assumptions.push('I kept today light: at most 60 minutes of newly planned work, while still respecting your saved daily limit.');
  } else if (input.request.todayLoad === 'skip') {
    assumptions.push('I left today free and started planning on the next available day.');
  }
  if (availableAfter || availableBefore) {
    const requestedWindow = availableAfter && availableBefore
      ? `${availableAfter}-${availableBefore}`
      : availableAfter
        ? `after ${availableAfter}`
        : `before ${availableBefore}`;
    assumptions.push(`I limited each planning day to your requested time window (${requestedWindow}), intersected with your saved availability.`);
  }
  if (additional.invalidCount > 0) {
    assumptions.push(`${additional.invalidCount} new ${additional.invalidCount === 1 ? 'activity was' : 'activities were'} ignored because the title or duration was invalid.`);
  }
  if (afterDeadline.size > 0) {
    assumptions.push(`${afterDeadline.size} overdue or capacity-limited ${afterDeadline.size === 1 ? 'task was' : 'tasks were'} placed at the earliest available time, even though the original deadline has passed.`);
  }
  if (unscheduled.length > 0) {
    const unscheduledMinutes = Math.ceil(
      unscheduled.reduce((total, item) => total + item.durationSeconds, 0) / 60,
    );
    assumptions.push(`I scheduled only the work that fit. I could not fit ${unscheduled.length} ${unscheduled.length === 1 ? 'task' : 'tasks'} (${unscheduledMinutes} minutes total) inside this ${horizonDays}-day window without exceeding your availability or daily workload limit: ${unscheduled.map(item => item.title).join(', ')}.`);
  }

  const operations: ScheduleBatchOperation[] = [];
  const createActions: ScheduleCommandAction[] = [];
  for (const placement of placements) {
    const scheduledDate = placement.date;
    const startAt = new Date(placement.start).toISOString();
    const durationSeconds = placement.item.durationSeconds;
    if (!placement.item.task) {
      createActions.push({
        type: 'create_task',
        title: placement.item.title,
        description: null,
        schedule: {
          scheduledDate,
          startAt,
          durationSeconds,
          recurrence: 'none',
          recurrenceDays: null,
          recurrenceEndDate: null,
        },
      });
      continue;
    }

    const taskId = placement.item.task.id;
    const entry = entriesByTask.get(taskId);
    const replacement = replacementOccurrences.get(taskId);
    if (scheduledSelectedIds.has(taskId) && entry?.recurrence !== 'none' && replacement) {
      operations.push({
        type: 'override',
        taskId,
        occurrenceDate: replacement.recurrenceSourceDate,
        override: { scheduledDate, startAt, durationSeconds },
      });
      continue;
    }
    operations.push({
      type: 'upsert',
      taskId,
      // Omitting recurrence fields preserves an existing row's recurrence and
      // occurrenceOverrides in the schedule store instead of flattening it.
      input: { scheduledDate, startAt, durationSeconds },
    });
  }
  const actions: ScheduleCommandAction[] = [
    ...(operations.length > 0 ? [{ type: 'schedule_batch' as const, operations }] : []),
    ...createActions,
  ];
  const coverage = `${placements.length} of ${work.length}`;
  const daysUsed = [...new Set(placements.map(placement => placement.date))];
  const summary = placements.length === 0
    ? `I found ${work.length} matching ${work.length === 1 ? 'task' : 'tasks'}, but none fit inside the requested window and workload limits.`
    : `Scheduled ${coverage} matching ${work.length === 1 ? 'task' : 'tasks'} across ${daysUsed.length} ${daysUsed.length === 1 ? 'day' : 'days'} (${daysUsed.map(date => localDateLabel(date, settings.timeZone)).join(', ')}).`;
  const id = `assistant-plan-${plannerHash({
    request: input.request,
    now: input.now,
    placements: placements.map(placement => [
      placement.item.key,
      placement.start,
      placement.item.durationSeconds,
    ]),
  })}`;

  return {
    id,
    command: 'plan tasks',
    commands: [],
    normalizedCommand: 'plan tasks',
    kind: null,
    status: actions.length > 0 ? 'ready' : 'clarification',
    summary,
    actions,
    assumptions,
    candidates: [],
    gaps: [],
    occurrences: placements.map(placement => ({
      taskId: placement.item.task?.id || null,
      title: placement.item.title,
      date: placement.date,
      startAt: new Date(placement.start).toISOString(),
      durationSeconds: placement.item.durationSeconds,
    })),
  };
}
