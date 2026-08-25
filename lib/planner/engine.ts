import {
  PLANNER_MAX_BLOCK_MINUTES,
  PLANNER_MAX_HORIZON_DAYS,
  PLANNER_SCHEMA_VERSION,
  PLANNER_SLOT_MINUTES,
  type PlannerAssignmentType,
  type PlannerEstimateBreakdown,
  type PlannerEstimateCacheEntry,
  type PlannerExamInput,
  type PlannerFeedbackMultiplier,
  type PlannerFixedInterval,
  type PlannerGenerationInput,
  type PlannerInputSnapshot,
  type PlannerPlan,
  type PlannerPriority,
  type PlannerSettings,
  type PlannerStaleness,
  type PlannerTaskInput,
  type PlannerTimeBucket,
  type PlannerTimePreferenceScores,
  type PlannerWarning,
  type RecurringCommitmentInput,
} from './types';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

interface Interval {
  start: number;
  end: number;
}

interface AvailabilityInterval extends Interval {
  localDate: string;
}

interface WorkItem {
  key: string;
  kind: 'task' | 'exam_prep';
  sourceId: string;
  taskId: string | null;
  examId: string | null;
  title: string;
  description: string | null;
  subjectId: string | null;
  assignmentType: PlannerAssignmentType;
  priority: PlannerPriority;
  focused: boolean;
  deadline: number;
  estimatedMinutes: number;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

interface EstimateContext {
  kind: 'task' | 'exam';
  entityId: string;
  title: string;
  description: string | null;
  subjectId: string | null;
  assignmentType: PlannerAssignmentType;
  priority: PlannerPriority;
  explicitMinutes: number | null;
  estimateCache: Readonly<Record<string, PlannerEstimateCacheEntry>>;
  feedbackMultipliers: Readonly<Record<string, PlannerFeedbackMultiplier>>;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundToSlot(minutes: number, slotMinutes = PLANNER_SLOT_MINUTES): number {
  return Math.max(slotMinutes, Math.round(minutes / slotMinutes) * slotMinutes);
}

function ceilToSlot(timestamp: number, slotMinutes = PLANNER_SLOT_MINUTES): number {
  const slotMs = slotMinutes * MINUTE_MS;
  return Math.ceil(timestamp / slotMs) * slotMs;
}

function floorToSlot(timestamp: number, slotMinutes = PLANNER_SLOT_MINUTES): number {
  const slotMs = slotMinutes * MINUTE_MS;
  return Math.floor(timestamp / slotMs) * slotMs;
}

function normalizeDays(days: readonly number[]): number[] {
  return [...new Set(days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

function isLocalTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function normalizeLocalTime(value: string, fallback: string): string {
  return isLocalTime(value) ? value : fallback;
}

function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function normalizedFocusSubjects(subjects: readonly string[] | undefined): string[] {
  return [...new Set((subjects || [])
    .map(subject => subject.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'))
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizeTimePreferenceScores(
  scores: PlannerTimePreferenceScores | undefined,
): PlannerTimePreferenceScores {
  const buckets: PlannerTimeBucket[] = ['morning', 'afternoon', 'evening', 'night'];
  return Object.fromEntries(buckets.flatMap(bucket => {
    const value = Number(scores?.[bucket]);
    return Number.isFinite(value) && value !== 0
      ? [[bucket, clamp(value, -1, 1)]]
      : [];
  })) as PlannerTimePreferenceScores;
}

function matchesFocusedSubject(
  focusSubjects: readonly string[],
  courseName: string | null | undefined,
  title: string,
): boolean {
  if (!focusSubjects.length) return false;
  const normalizedCourse = courseName?.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') || '';
  if (normalizedCourse && focusSubjects.includes(normalizedCourse)) return true;

  // Exam inputs do not currently carry a course label, so allow a bounded title
  // match as a deterministic fallback. Task course names remain exact matches.
  if (normalizedCourse) return false;
  const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  return focusSubjects.some(subject => normalizedTitle.includes(subject));
}

export function normalizePlannerSettings(settings: PlannerSettings): PlannerSettings {
  const maxBlockMinutes = clamp(
    roundToSlot(Number(settings.maxBlockMinutes) || PLANNER_MAX_BLOCK_MINUTES),
    PLANNER_SLOT_MINUTES,
    PLANNER_MAX_BLOCK_MINUTES,
  );

  return {
    ...settings,
    timeZone: safeTimeZone(settings.timeZone || 'UTC'),
    horizonDays: clamp(Math.trunc(settings.horizonDays || PLANNER_MAX_HORIZON_DAYS), 1, PLANNER_MAX_HORIZON_DAYS),
    slotMinutes: PLANNER_SLOT_MINUTES,
    maxBlockMinutes,
    wakeTime: normalizeLocalTime(settings.wakeTime, '07:00'),
    schoolStartTime: normalizeLocalTime(settings.schoolStartTime, '08:00'),
    schoolHomeTime: normalizeLocalTime(settings.schoolHomeTime, '16:00'),
    bedtime: normalizeLocalTime(settings.bedtime, '23:00'),
    schoolDays: normalizeDays(settings.schoolDays || [1, 2, 3, 4, 5]),
    weekendAvailableStart: normalizeLocalTime(settings.weekendAvailableStart, '09:00'),
    weekendAvailableEnd: normalizeLocalTime(settings.weekendAvailableEnd, '23:00'),
    maxDailyMinutes: clamp(
      roundToSlot(Number(settings.maxDailyMinutes) || 240),
      PLANNER_SLOT_MINUTES,
      16 * 60,
    ),
    minBreakMinutes: clamp(
      Math.ceil((Number(settings.minBreakMinutes) || 0) / PLANNER_SLOT_MINUTES) * PLANNER_SLOT_MINUTES,
      0,
      60,
    ),
  };
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter(key => record[key] !== undefined)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function plannerHash(value: unknown): string {
  const input = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function zonedParts(timestamp: number, timeZone: string): ZonedParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(new Date(timestamp))
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function timeBucketForTimestamp(timestamp: number, timeZone: string): PlannerTimeBucket {
  const hour = zonedParts(timestamp, timeZone).hour;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function localDateFromParts(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): string {
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${(shifted.getUTCMonth() + 1).toString().padStart(2, '0')}-${shifted.getUTCDate().toString().padStart(2, '0')}`;
}

function localDayOfWeek(localDate: string): number {
  const [year, month, day] = localDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Convert a wall-clock date/time in an IANA zone to an exact UTC timestamp. */
export function zonedDateTimeToTimestamp(localDate: string, localTime: string, requestedTimeZone: string): number {
  const timeZone = safeTimeZone(requestedTimeZone);
  const [year, month, day] = localDate.split('-').map(Number);
  const [hour, minute] = localTime.split(':').map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = targetAsUtc;

  // Iterating handles ordinary offset changes and DST transitions without a timezone dependency.
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const rendered = zonedParts(guess, timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      0,
      0,
    );
    const difference = targetAsUtc - renderedAsUtc;
    if (difference === 0) break;
    guess += difference;
  }
  return guess;
}

function timestampForPossiblyOvernightRange(
  localDate: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): Interval {
  const start = zonedDateTimeToTimestamp(localDate, startTime, timeZone);
  let endDate = localDate;
  if (endTime <= startTime) endDate = addLocalDays(localDate, 1);
  const end = zonedDateTimeToTimestamp(endDate, endTime, timeZone);
  return { start, end };
}

function toPlainText(value: string | null): string {
  return (value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 12_000);
}

function normalizeAssignmentType(value: PlannerAssignmentType | null | undefined): PlannerAssignmentType {
  return value || 'assignment';
}

function estimateContentFingerprint(context: EstimateContext): string {
  return plannerHash({
    kind: context.kind,
    id: context.entityId,
    title: context.title.trim(),
    description: toPlainText(context.description),
    subjectId: context.subjectId,
    assignmentType: context.assignmentType,
    priority: context.priority,
  });
}

export function createEstimateCacheKey(
  kind: 'task' | 'exam',
  entityId: string,
  contentFingerprint: string,
): string {
  return `${kind}:${entityId}:${contentFingerprint}`;
}

function findEstimateOverride(
  context: EstimateContext,
  contentFingerprint: string,
): PlannerEstimateCacheEntry | null {
  const namespacedId = `${context.kind}:${context.entityId}`;
  const exact = context.estimateCache[createEstimateCacheKey(context.kind, context.entityId, contentFingerprint)];
  if (exact?.contentFingerprint === contentFingerprint) return exact;

  return Object.values(context.estimateCache)
    .filter(entry =>
      (entry.entityId === namespacedId || entry.entityId === context.entityId)
      && entry.contentFingerprint === contentFingerprint,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .at(-1) || null;
}

export function feedbackMultiplierKeys(
  kind: 'task' | 'exam',
  entityId: string,
  subjectId: string | null,
  assignmentType: PlannerAssignmentType,
): string[] {
  return [
    `${kind}:${entityId}`,
    subjectId ? `subject:${subjectId}:type:${assignmentType}` : '',
    `type:${assignmentType}`,
    'global',
  ].filter(Boolean);
}

function selectFeedbackMultiplier(context: EstimateContext): PlannerFeedbackMultiplier | null {
  for (const key of feedbackMultiplierKeys(
    context.kind,
    context.entityId,
    context.subjectId,
    context.assignmentType,
  )) {
    const match = context.feedbackMultipliers[key];
    if (match && Number.isFinite(match.multiplier)) return match;
  }
  return null;
}

function heuristicEstimate(context: EstimateContext): { minutes: number; reasons: string[] } {
  const reasons: string[] = [];
  const text = `${context.title} ${toPlainText(context.description)}`.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const baseByType: Record<PlannerAssignmentType, number> = {
    assignment: 45,
    exam: 120,
    quiz: 60,
    discussion: 30,
    project: 180,
    other: 45,
  };
  let minutes = baseByType[context.assignmentType];
  reasons.push(`${context.assignmentType.replace('_', ' ')} baseline`);

  if (words >= 250) {
    minutes += 30;
    reasons.push('long description');
  } else if (words >= 100) {
    minutes += 15;
    reasons.push('detailed description');
  }

  const quantified = [...text.matchAll(/(\d{1,3})\s*(pages?|problems?|questions?|exercises?)/g)];
  for (const match of quantified) {
    const count = Number(match[1]);
    const unit = match[2];
    const measured = unit.startsWith('page') ? count * 7 : count * 5;
    if (measured > minutes) {
      minutes = measured;
      reasons.push(`${count} ${unit}`);
    }
  }

  const longWorkSignals: Array<[RegExp, number, string]> = [
    [/\b(research paper|term paper|essay)\b/, 120, 'writing assignment'],
    [/\b(project|presentation|portfolio)\b/, 150, 'multi-step project'],
    [/\b(lab report|experiment)\b/, 90, 'lab work'],
    [/\b(study guide|review packet|practice exam)\b/, 90, 'exam preparation'],
    [/\b(read|chapter|textbook)\b/, 60, 'reading'],
    [/\b(code|program|debug|computer science)\b/, 90, 'coding work'],
  ];
  for (const [pattern, minimum, reason] of longWorkSignals) {
    if (pattern.test(text) && minutes < minimum) {
      minutes = minimum;
      reasons.push(reason);
    }
  }

  if (context.priority === 'high') {
    minutes += 15;
    reasons.push('high priority complexity buffer');
  } else if (context.priority === 'low' && minutes > 30) {
    minutes -= 15;
    reasons.push('low priority adjustment');
  }

  return { minutes: clamp(roundToSlot(minutes), PLANNER_SLOT_MINUTES, 8 * 60), reasons };
}

function estimateWork(context: EstimateContext): PlannerEstimateBreakdown {
  const contentFingerprint = estimateContentFingerprint(context);
  const heuristic = heuristicEstimate(context);
  const override = context.explicitMinutes && context.explicitMinutes > 0
    ? {
        entityId: `${context.kind}:${context.entityId}`,
        contentFingerprint,
        minutes: context.explicitMinutes,
        source: 'manual' as const,
        createdAt: '',
      }
    : findEstimateOverride(context, contentFingerprint);
  const feedback = override?.source === 'manual' ? null : selectFeedbackMultiplier(context);
  const multiplier = clamp(feedback?.multiplier || 1, 0.5, 2.5);
  const base = override?.minutes || heuristic.minutes;
  const finalMinutes = clamp(roundToSlot(base * multiplier), PLANNER_SLOT_MINUTES, 12 * 60);
  const reasons = [...heuristic.reasons];
  if (override) reasons.push(`${override.source} estimate override`);
  if (feedback && multiplier !== 1) reasons.push('personal timing feedback');

  return {
    entityId: `${context.kind}:${context.entityId}`,
    contentFingerprint,
    heuristicMinutes: heuristic.minutes,
    overrideMinutes: override ? roundToSlot(override.minutes) : null,
    overrideSource: override?.source || null,
    feedbackKey: feedback?.key || null,
    feedbackMultiplier: multiplier,
    finalMinutes,
    reasons,
  };
}

export function estimatePlannerTask(
  task: PlannerTaskInput,
  estimateCache: Readonly<Record<string, PlannerEstimateCacheEntry>> = {},
  feedbackMultipliers: Readonly<Record<string, PlannerFeedbackMultiplier>> = {},
): PlannerEstimateBreakdown {
  return estimateWork({
    kind: 'task',
    // Virtual recurrence IDs are schedule-specific. Estimate caching and timing
    // feedback belong to the durable Orderly task so every occurrence can learn.
    entityId: task.taskId || task.id,
    title: task.title,
    description: task.description || null,
    subjectId: task.subjectId || null,
    assignmentType: normalizeAssignmentType(task.assignmentType),
    priority: task.priority,
    explicitMinutes: task.estimateMinutes || null,
    estimateCache,
    feedbackMultipliers,
  });
}

export function estimatePlannerExam(
  exam: PlannerExamInput,
  estimateCache: Readonly<Record<string, PlannerEstimateCacheEntry>> = {},
  feedbackMultipliers: Readonly<Record<string, PlannerFeedbackMultiplier>> = {},
): PlannerEstimateBreakdown {
  const estimate = estimateWork({
    kind: 'exam',
    entityId: exam.id,
    title: exam.title,
    description: exam.description || null,
    subjectId: exam.subjectId || null,
    assignmentType: 'exam',
    priority: exam.priority || 'high',
    explicitMinutes: exam.estimateMinutes || null,
    estimateCache,
    feedbackMultipliers,
  });
  const remainingRatio = 1 - clamp(Number(exam.preparationProgress) || 0, 0, 100) / 100;
  return {
    ...estimate,
    finalMinutes: remainingRatio <= 0
      ? 0
      : clamp(roundToSlot(estimate.finalMinutes * remainingRatio), PLANNER_SLOT_MINUTES, 12 * 60),
    reasons: remainingRatio < 1
      ? [...estimate.reasons, `${Math.round(remainingRatio * 100)}% preparation remaining`]
      : estimate.reasons,
  };
}

function taskSnapshotValue(task: PlannerTaskInput): string {
  return plannerHash({
    taskId: task.taskId || task.id,
    occurrenceDate: task.occurrenceDate || null,
    title: task.title.trim(),
    description: toPlainText(task.description || null),
    subjectId: task.subjectId || null,
    courseName: task.courseName || null,
    priority: task.priority,
    status: task.status || 'pending',
    dueAt: task.dueAt || null,
    assignmentType: normalizeAssignmentType(task.assignmentType),
    source: task.source || 'manual',
    externalId: task.externalId || null,
    estimateMinutes: task.estimateMinutes || null,
    recurrence: task.recurrence || 'none',
    recurrenceDays: normalizeDays(task.recurrenceDays || []),
  });
}

function examSnapshotValue(exam: PlannerExamInput): string {
  return plannerHash({
    title: exam.title.trim(),
    description: toPlainText(exam.description || null),
    subjectId: exam.subjectId || null,
    examAt: exam.examAt,
    preparationProgress: exam.preparationProgress || 0,
    priority: exam.priority || 'high',
    estimateMinutes: exam.estimateMinutes || null,
  });
}

function commitmentSnapshotValue(commitment: RecurringCommitmentInput): string {
  return plannerHash({
    title: commitment.title.trim(),
    kind: commitment.kind,
    daysOfWeek: normalizeDays(commitment.daysOfWeek),
    startTime: commitment.startTime,
    endTime: commitment.endTime,
    startDate: commitment.startDate || null,
    endDate: commitment.endDate || null,
    timeZone: commitment.timeZone || null,
    enabled: commitment.enabled !== false,
  });
}

function recordFromEntries(entries: Array<[string, string]>): Record<string, string> {
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function createPlannerInputSnapshot(input: PlannerGenerationInput): PlannerInputSnapshot {
  const settings = normalizePlannerSettings(input.settings);
  const focusSubjects = normalizedFocusSubjects(input.focusSubjects);
  const tasks = recordFromEntries(input.tasks.map(task => [task.id, taskSnapshotValue(task)]));
  const exams = recordFromEntries((input.exams || []).map(exam => [exam.id, examSnapshotValue(exam)]));
  const commitments = recordFromEntries(
    (input.commitments || []).map(commitment => [commitment.id, commitmentSnapshotValue(commitment)]),
  );
  const settingsFingerprint = plannerHash({ settings, focusSubjects });
  const estimatesFingerprint = plannerHash(input.estimateCache || {});
  const feedbackFingerprint = plannerHash(input.feedbackMultipliers || {});
  const fingerprint = `planner-v${PLANNER_SCHEMA_VERSION}-${plannerHash({
    tasks,
    exams,
    commitments,
    settingsFingerprint,
    estimatesFingerprint,
    feedbackFingerprint,
  })}`;

  return {
    version: PLANNER_SCHEMA_VERSION,
    tasks,
    exams,
    commitments,
    settingsFingerprint,
    estimatesFingerprint,
    feedbackFingerprint,
    fingerprint,
  };
}

export function fingerprintPlannerInputs(input: PlannerGenerationInput): string {
  return createPlannerInputSnapshot(input).fingerprint;
}

function mapDiff(previous: Record<string, string>, current: Record<string, string>) {
  const previousIds = new Set(Object.keys(previous));
  const currentIds = new Set(Object.keys(current));
  return {
    added: [...currentIds].filter(id => !previousIds.has(id)).sort(),
    removed: [...previousIds].filter(id => !currentIds.has(id)).sort(),
    changed: [...currentIds].filter(id => previousIds.has(id) && previous[id] !== current[id]).sort(),
  };
}

export function getPlannerStaleness(
  plan: Pick<PlannerPlan, 'inputSnapshot' | 'inputFingerprint'>,
  currentInput: PlannerGenerationInput,
): PlannerStaleness {
  const current = createPlannerInputSnapshot(currentInput);
  const previous = plan.inputSnapshot;
  const taskDiff = mapDiff(previous.tasks, current.tasks);
  const examDiff = mapDiff(previous.exams, current.exams);
  const commitmentDiff = mapDiff(previous.commitments, current.commitments);
  const settingsChanged = previous.settingsFingerprint !== current.settingsFingerprint;
  const estimatesChanged = previous.estimatesFingerprint !== current.estimatesFingerprint;
  const feedbackChanged = previous.feedbackFingerprint !== current.feedbackFingerprint;
  const structuralChanged = taskDiff.added.length > 0
    || taskDiff.removed.length > 0
    || taskDiff.changed.length > 0
    || examDiff.added.length > 0
    || examDiff.removed.length > 0
    || examDiff.changed.length > 0
    || commitmentDiff.added.length > 0
    || commitmentDiff.removed.length > 0
    || commitmentDiff.changed.length > 0
    || settingsChanged;
  const summary: string[] = [];

  if (taskDiff.added.length) summary.push(`${taskDiff.added.length} new task${taskDiff.added.length === 1 ? '' : 's'}`);
  if (taskDiff.changed.length) summary.push(`${taskDiff.changed.length} changed task${taskDiff.changed.length === 1 ? '' : 's'}`);
  if (taskDiff.removed.length) summary.push(`${taskDiff.removed.length} removed task${taskDiff.removed.length === 1 ? '' : 's'}`);
  if (examDiff.added.length) summary.push(`${examDiff.added.length} new exam${examDiff.added.length === 1 ? '' : 's'}`);
  if (examDiff.changed.length) summary.push(`${examDiff.changed.length} changed exam${examDiff.changed.length === 1 ? '' : 's'}`);
  if (examDiff.removed.length) summary.push(`${examDiff.removed.length} removed exam${examDiff.removed.length === 1 ? '' : 's'}`);
  if (commitmentDiff.added.length || commitmentDiff.removed.length || commitmentDiff.changed.length) {
    summary.push('availability changed');
  }
  if (settingsChanged) summary.push('planning settings changed');
  if (estimatesChanged) summary.push('time estimates changed');
  if (feedbackChanged) summary.push('new timing feedback');

  return {
    // Learned estimates affect the next explicit generation, not the schedule
    // already shown to the user. Only structural inputs invalidate this plan.
    isStale: structuralChanged,
    previousFingerprint: plan.inputFingerprint,
    currentFingerprint: current.fingerprint,
    newTaskIds: taskDiff.added,
    removedTaskIds: taskDiff.removed,
    changedTaskIds: taskDiff.changed,
    newExamIds: examDiff.added,
    removedExamIds: examDiff.removed,
    changedExamIds: examDiff.changed,
    changedCommitmentIds: [...new Set([
      ...commitmentDiff.added,
      ...commitmentDiff.removed,
      ...commitmentDiff.changed,
    ])].sort(),
    settingsChanged,
    estimatesChanged,
    feedbackChanged,
    summary,
  };
}

function clipInterval(interval: Interval, start: number, end: number): Interval | null {
  const clipped = { start: Math.max(interval.start, start), end: Math.min(interval.end, end) };
  return clipped.end > clipped.start ? clipped : null;
}

function buildCalendar(
  settings: PlannerSettings,
  localStartDate: string,
  horizonStart: number,
  horizonEnd: number,
  commitments: readonly RecurringCommitmentInput[],
): {
  availability: AvailabilityInterval[];
  fixedIntervals: PlannerFixedInterval[];
  warnings: PlannerWarning[];
} {
  const availability: AvailabilityInterval[] = [];
  const fixedIntervals: PlannerFixedInterval[] = [];
  const warnings: PlannerWarning[] = [];

  for (let dayIndex = 0; dayIndex < settings.horizonDays; dayIndex += 1) {
    const localDate = addLocalDays(localStartDate, dayIndex);
    const dayOfWeek = localDayOfWeek(localDate);
    const isSchoolDay = settings.schoolDays.includes(dayOfWeek);
    const availableStartTime = isSchoolDay ? settings.schoolHomeTime : settings.weekendAvailableStart;
    const availableEndTime = isSchoolDay ? settings.bedtime : settings.weekendAvailableEnd;
    const availableRange = timestampForPossiblyOvernightRange(
      localDate,
      availableStartTime,
      availableEndTime,
      settings.timeZone,
    );
    const clippedAvailability = clipInterval(availableRange, horizonStart, horizonEnd);
    if (clippedAvailability) availability.push({ ...clippedAvailability, localDate });

    if (isSchoolDay) {
      const schoolRange = timestampForPossiblyOvernightRange(
        localDate,
        settings.wakeTime,
        settings.schoolHomeTime,
        settings.timeZone,
      );
      const clippedSchool = clipInterval(schoolRange, horizonStart, horizonEnd);
      if (clippedSchool) {
        fixedIntervals.push({
          id: `school-${localDate}`,
          kind: 'school',
          title: `School day (starts ${settings.schoolStartTime})`,
          startAt: new Date(clippedSchool.start).toISOString(),
          endAt: new Date(clippedSchool.end).toISOString(),
          commitmentId: null,
          color: null,
          editable: false,
        });
      }
    }
  }

  for (const commitment of [...commitments].sort((a, b) => a.id.localeCompare(b.id))) {
    if (commitment.enabled === false) continue;
    if (!isLocalTime(commitment.startTime) || !isLocalTime(commitment.endTime) || !normalizeDays(commitment.daysOfWeek).length) {
      warnings.push({
        id: `invalid-commitment-${commitment.id}`,
        code: 'invalid_commitment',
        entityKind: 'commitment',
        entityId: commitment.id,
        title: commitment.title,
        message: 'This recurring commitment has an invalid day or time and was ignored.',
      });
      continue;
    }

    const commitmentTimeZone = safeTimeZone(commitment.timeZone || settings.timeZone);
    const days = normalizeDays(commitment.daysOfWeek);
    for (let dayIndex = 0; dayIndex < settings.horizonDays; dayIndex += 1) {
      const localDate = addLocalDays(localStartDate, dayIndex);
      if (!days.includes(localDayOfWeek(localDate))) continue;
      if (commitment.startDate && localDate < commitment.startDate) continue;
      if (commitment.endDate && localDate > commitment.endDate) continue;

      const range = timestampForPossiblyOvernightRange(
        localDate,
        commitment.startTime,
        commitment.endTime,
        commitmentTimeZone,
      );
      const clipped = clipInterval(range, horizonStart, horizonEnd);
      if (!clipped) continue;
      fixedIntervals.push({
        id: `commitment-${commitment.id}-${localDate}`,
        kind: 'commitment',
        title: commitment.title,
        startAt: new Date(clipped.start).toISOString(),
        endAt: new Date(clipped.end).toISOString(),
        commitmentId: commitment.id,
        color: commitment.color || null,
        editable: true,
      });
    }
  }

  return {
    availability: availability.sort((a, b) => a.start - b.start),
    fixedIntervals: fixedIntervals.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id)),
    warnings,
  };
}

function priorityRank(priority: PlannerPriority): number {
  return priority === 'high' ? 0 : priority === 'medium' ? 1 : 2;
}

function parseDeadline(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function buildWorkItems(
  input: PlannerGenerationInput,
  horizonEnd: number,
): { workItems: WorkItem[]; estimates: Record<string, PlannerEstimateBreakdown>; warnings: PlannerWarning[] } {
  const workItems: WorkItem[] = [];
  const estimates: Record<string, PlannerEstimateBreakdown> = {};
  const warnings: PlannerWarning[] = [];
  const estimateCache = input.estimateCache || {};
  const feedbackMultipliers = input.feedbackMultipliers || {};
  const focusSubjects = normalizedFocusSubjects(input.focusSubjects);

  for (const task of [...input.tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    if (task.status === 'completed') continue;
    const parsedDeadline = parseDeadline(task.dueAt);
    if (Number.isNaN(parsedDeadline)) {
      warnings.push({
        id: `invalid-task-deadline-${task.id}`,
        code: 'invalid_deadline',
        entityKind: 'task',
        entityId: task.id,
        title: task.title,
        message: 'The task has an invalid deadline and was not scheduled.',
        deadlineAt: task.dueAt || null,
      });
      continue;
    }
    const estimate = estimatePlannerTask(task, estimateCache, feedbackMultipliers);
    const key = `task:${task.id}`;
    const originalTaskId = task.taskId || task.id;
    estimates[key] = estimate;
    workItems.push({
      key,
      kind: 'task',
      sourceId: task.id,
      taskId: originalTaskId,
      examId: null,
      title: task.title,
      description: task.description || null,
      subjectId: task.subjectId || null,
      assignmentType: normalizeAssignmentType(task.assignmentType),
      priority: task.priority,
      focused: matchesFocusedSubject(focusSubjects, task.courseName, task.title),
      deadline: parsedDeadline ?? horizonEnd,
      estimatedMinutes: estimate.finalMinutes,
    });
  }

  for (const exam of [...(input.exams || [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const parsedDeadline = parseDeadline(exam.examAt);
    if (parsedDeadline === null || Number.isNaN(parsedDeadline)) {
      warnings.push({
        id: `invalid-exam-deadline-${exam.id}`,
        code: 'invalid_deadline',
        entityKind: 'exam',
        entityId: exam.id,
        title: exam.title,
        message: 'The exam has an invalid date and was not scheduled.',
        deadlineAt: exam.examAt || null,
      });
      continue;
    }
    const estimate = estimatePlannerExam(exam, estimateCache, feedbackMultipliers);
    const key = `exam:${exam.id}`;
    estimates[key] = estimate;
    if (estimate.finalMinutes <= 0) continue;
    workItems.push({
      key,
      kind: 'exam_prep',
      sourceId: exam.id,
      taskId: null,
      examId: exam.id,
      title: `Prepare for ${exam.title}`,
      description: exam.description || null,
      subjectId: exam.subjectId || null,
      assignmentType: 'exam',
      priority: exam.priority || 'high',
      focused: matchesFocusedSubject(focusSubjects, null, exam.title),
      deadline: parsedDeadline,
      estimatedMinutes: estimate.finalMinutes,
    });
  }

  workItems.sort((left, right) =>
    left.deadline - right.deadline
    || Number(right.focused) - Number(left.focused)
    || priorityRank(left.priority) - priorityRank(right.priority)
    || left.key.localeCompare(right.key),
  );
  return { workItems, estimates, warnings };
}

function overlaps(left: Interval, right: Interval): boolean {
  return left.start < right.end && right.start < left.end;
}

function localDateForTimestamp(timestamp: number, timeZone: string): string {
  return localDateFromParts(zonedParts(timestamp, timeZone));
}

function findEarliestSlot(
  availability: readonly AvailabilityInterval[],
  occupied: readonly Interval[],
  deadline: number,
  requestedMinutes: number,
  dailyScheduledMinutes: ReadonlyMap<string, number>,
  settings: PlannerSettings,
  timePreferenceScores: PlannerTimePreferenceScores,
): Interval | null {
  const slotMs = settings.slotMinutes * MINUTE_MS;
  const sortedOccupied = [...occupied].sort((a, b) => a.start - b.start || a.end - b.end);
  let best: (Interval & { preferenceScore: number }) | null = null;

  for (const window of availability) {
    const localDate = window.localDate;
    const dailyRemaining = settings.maxDailyMinutes - (dailyScheduledMinutes.get(localDate) || 0);
    const maxMinutes = Math.min(requestedMinutes, dailyRemaining, settings.maxBlockMinutes);
    if (maxMinutes < settings.slotMinutes) continue;

    const limit = Math.min(window.end, deadline);
    let cursor = ceilToSlot(window.start, settings.slotMinutes);
    while (cursor + slotMs <= limit) {
      const containing = sortedOccupied.find(interval => overlaps(
        { start: cursor, end: cursor + slotMs },
        interval,
      ));
      if (containing) {
        cursor = ceilToSlot(containing.end, settings.slotMinutes);
        continue;
      }

      const nextOccupiedStart = sortedOccupied
        .filter(interval => interval.start >= cursor)
        .reduce((minimum, interval) => Math.min(minimum, interval.start), Number.POSITIVE_INFINITY);
      const freeEnd = Math.min(limit, nextOccupiedStart);
      const freeMinutes = Math.floor((freeEnd - cursor) / slotMs) * settings.slotMinutes;
      const durationMinutes = Math.floor(Math.min(maxMinutes, freeMinutes) / settings.slotMinutes) * settings.slotMinutes;
      if (durationMinutes >= settings.slotMinutes) {
        const candidate = {
          start: cursor,
          end: cursor + durationMinutes * MINUTE_MS,
          preferenceScore: timePreferenceScores[timeBucketForTimestamp(cursor, settings.timeZone)] || 0,
        };
        if (
          !best
          || candidate.preferenceScore > best.preferenceScore
          || (candidate.preferenceScore === best.preferenceScore && candidate.start < best.start)
        ) {
          best = candidate;
        }
      }
      cursor += slotMs;
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

export function generatePlannerPlan(rawInput: PlannerGenerationInput): PlannerPlan {
  const settings = normalizePlannerSettings(rawInput.settings);
  const focusSubjects = normalizedFocusSubjects(rawInput.focusSubjects);
  const timePreferenceScores = normalizeTimePreferenceScores(rawInput.timePreferenceScores);
  const input: PlannerGenerationInput = {
    ...rawInput,
    settings,
    focusSubjects,
    timePreferenceScores,
  };
  const requestedNow = rawInput.now ? new Date(rawInput.now).getTime() : Date.now();
  const now = Number.isFinite(requestedNow) ? requestedNow : Date.now();
  const localStartDate = localDateForTimestamp(now, settings.timeZone);
  const horizonStart = ceilToSlot(now, settings.slotMinutes);
  const horizonEnd = zonedDateTimeToTimestamp(
    addLocalDays(localStartDate, settings.horizonDays),
    '00:00',
    settings.timeZone,
  );
  const snapshot = createPlannerInputSnapshot(input);
  const planId = `plan-${plannerHash({
    userId: input.userId,
    fingerprint: snapshot.fingerprint,
    localStartDate,
    prompt: input.prompt || null,
    timePreferenceScores,
  })}`;
  const calendar = buildCalendar(
    settings,
    localStartDate,
    horizonStart,
    horizonEnd,
    input.commitments || [],
  );
  const work = buildWorkItems(input, horizonEnd);
  const warnings: PlannerWarning[] = [...calendar.warnings, ...work.warnings];
  const blocks: PlannerPlan['blocks'] = [];
  const occupied: Interval[] = calendar.fixedIntervals.map(interval => ({
    start: new Date(interval.startAt).getTime(),
    end: new Date(interval.endAt).getTime(),
  }));
  const dailyScheduledMinutes = new Map<string, number>();
  let totalUnscheduledMinutes = 0;

  if (!calendar.availability.length && work.workItems.length) {
    warnings.push({
      id: 'plan-no-availability',
      code: 'no_availability',
      entityKind: 'plan',
      title: 'No planning availability',
      message: 'Your school, sleep, weekend, and commitment settings leave no open planning time.',
    });
  }

  for (const item of work.workItems) {
    let remainingMinutes = item.estimatedMinutes;
    if (item.deadline <= horizonStart) {
      totalUnscheduledMinutes += remainingMinutes;
      warnings.push({
        id: `deadline-passed-${item.key}`,
        code: 'deadline_passed',
        entityKind: item.kind === 'task' ? 'task' : 'exam',
        entityId: item.sourceId,
        title: item.title,
        message: 'The exact deadline has already passed, so Orderly did not place work after it.',
        unscheduledMinutes: remainingMinutes,
        deadlineAt: new Date(item.deadline).toISOString(),
      });
      continue;
    }

    let segmentIndex = 0;
    while (remainingMinutes > 0) {
      const requestedMinutes = Math.min(remainingMinutes, settings.maxBlockMinutes);
      const slot = findEarliestSlot(
        calendar.availability,
        occupied,
        item.deadline,
        requestedMinutes,
        dailyScheduledMinutes,
        settings,
        timePreferenceScores,
      );
      if (!slot) break;
      const durationMinutes = Math.round((slot.end - slot.start) / MINUTE_MS);
      const localDate = localDateForTimestamp(slot.start, settings.timeZone);
      const blockId = `block-${plannerHash({ planId, item: item.key, segmentIndex, start: slot.start, end: slot.end })}`;
      blocks.push({
        id: blockId,
        planId,
        kind: item.kind,
        sourceId: item.sourceId,
        taskId: item.taskId,
        examId: item.examId,
        title: item.title,
        description: item.description,
        subjectId: item.subjectId,
        assignmentType: item.assignmentType,
        priority: item.priority,
        startAt: new Date(slot.start).toISOString(),
        endAt: new Date(slot.end).toISOString(),
        deadlineAt: new Date(item.deadline).toISOString(),
        estimatedMinutes: durationMinutes,
        segmentIndex,
        segmentCount: 0,
        locked: false,
        status: 'planned',
      });
      dailyScheduledMinutes.set(localDate, (dailyScheduledMinutes.get(localDate) || 0) + durationMinutes);
      remainingMinutes -= durationMinutes;
      segmentIndex += 1;

      // The break is an internal reservation, not a visible calendar block.
      occupied.push({
        start: slot.start,
        end: slot.end + settings.minBreakMinutes * MINUTE_MS,
      });
    }

    if (remainingMinutes > 0) {
      totalUnscheduledMinutes += remainingMinutes;
      warnings.push({
        id: `capacity-${item.key}`,
        code: 'insufficient_capacity',
        entityKind: item.kind === 'task' ? 'task' : 'exam',
        entityId: item.sourceId,
        title: item.title,
        message: `Orderly could not place ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'} before the exact deadline within this plan.`,
        unscheduledMinutes: remainingMinutes,
        deadlineAt: new Date(item.deadline).toISOString(),
      });
    }
  }

  const segmentCounts = blocks.reduce<Record<string, number>>((counts, block) => {
    const key = `${block.kind}:${block.sourceId}`;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const finalizedBlocks = blocks
    .map(block => ({ ...block, segmentCount: segmentCounts[`${block.kind}:${block.sourceId}`] || 1 }))
    .sort((left, right) => left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id));

  return {
    id: planId,
    userId: input.userId,
    status: 'active',
    generatedAt: new Date(now).toISOString(),
    archivedAt: null,
    horizonStart: new Date(horizonStart).toISOString(),
    horizonEnd: new Date(horizonEnd).toISOString(),
    prompt: input.prompt || null,
    focusSubjects,
    inputFingerprint: snapshot.fingerprint,
    inputSnapshot: snapshot,
    settings,
    blocks: finalizedBlocks,
    fixedIntervals: calendar.fixedIntervals,
    estimates: work.estimates,
    warnings,
    totalScheduledMinutes: finalizedBlocks.reduce((total, block) => total + block.estimatedMinutes, 0),
    totalUnscheduledMinutes,
  };
}

export const createPlannerPlan = generatePlannerPlan;
