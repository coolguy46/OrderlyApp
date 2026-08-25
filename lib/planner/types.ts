export const PLANNER_SCHEMA_VERSION = 1;
export const PLANNER_SLOT_MINUTES = 15;
export const PLANNER_MAX_BLOCK_MINUTES = 90;
export const PLANNER_MAX_HORIZON_DAYS = 7;
export const PLANNER_PROMPT_TASK_SOURCE = 'planner_prompt';
export const PLANNER_PROMPT_COMMITMENT_PREFIX = 'prompt-constraint-';

export type IsoDateTime = string;
export type LocalDate = string;
export type LocalTime = string;
export type PlannerPriority = 'high' | 'medium' | 'low';
export type PlannerTimeBucket = 'morning' | 'afternoon' | 'evening' | 'night';
export type PlannerTimePreferenceScores = Readonly<Partial<Record<PlannerTimeBucket, number>>>;
export type PlannerRequestedActivityRecurrence = 'once' | 'daily' | 'weekly';
export type PlannerAssignmentType =
  | 'assignment'
  | 'exam'
  | 'quiz'
  | 'discussion'
  | 'project'
  | 'other';

/** Canonical plan-only activity extracted exclusively from the user's prompt. */
export interface PlannerRequestedActivity {
  id: string;
  title: string;
  description: string;
  minutesPerOccurrence: number;
  recurrence: PlannerRequestedActivityRecurrence;
  daysOfWeek: number[];
  startOffsetDays: number;
  durationDays: number;
  deadlineTime?: LocalTime;
}

export interface PlannerSettings {
  timeZone: string;
  horizonDays: number;
  slotMinutes: 15;
  maxBlockMinutes: number;
  wakeTime: LocalTime;
  schoolStartTime: LocalTime;
  schoolHomeTime: LocalTime;
  bedtime: LocalTime;
  schoolDays: number[];
  weekendAvailableStart: LocalTime;
  weekendAvailableEnd: LocalTime;
  maxDailyMinutes: number;
  minBreakMinutes: number;
}

export function getDefaultPlannerSettings(timeZone?: string): PlannerSettings {
  const resolvedTimeZone = timeZone
    || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '')
    || 'UTC';

  return {
    timeZone: resolvedTimeZone,
    horizonDays: PLANNER_MAX_HORIZON_DAYS,
    slotMinutes: PLANNER_SLOT_MINUTES,
    maxBlockMinutes: PLANNER_MAX_BLOCK_MINUTES,
    wakeTime: '07:00',
    schoolStartTime: '08:00',
    schoolHomeTime: '16:00',
    bedtime: '23:00',
    schoolDays: [1, 2, 3, 4, 5],
    weekendAvailableStart: '09:00',
    weekendAvailableEnd: '23:00',
    maxDailyMinutes: 240,
    minBreakMinutes: 15,
  };
}

export interface PlannerTaskInput {
  /** Unique work-input ID. Recurring occurrences use `<taskId>@YYYY-MM-DD`. */
  id: string;
  /** Original Orderly task row used when the user completes the work. */
  taskId?: string | null;
  /** Local due date for a generated recurring occurrence. */
  occurrenceDate?: LocalDate | null;
  /** Exact instant before which this occurrence cannot be scheduled. */
  availableFrom?: IsoDateTime | null;
  /** Stable plan-only activity template ID; null for durable tasks. */
  activityId?: string | null;
  title: string;
  description?: string | null;
  subjectId?: string | null;
  courseName?: string | null;
  priority: PlannerPriority;
  status?: 'pending' | 'in_progress' | 'completed';
  dueAt?: IsoDateTime | null;
  assignmentType?: PlannerAssignmentType | null;
  source?: 'manual' | 'canvas' | 'google_classroom' | string;
  externalId?: string | null;
  updatedAt?: IsoDateTime | null;
  estimateMinutes?: number | null;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceDays?: number[] | null;
}

export interface PlannerExamInput {
  id: string;
  title: string;
  description?: string | null;
  subjectId?: string | null;
  examAt: IsoDateTime;
  preparationProgress?: number;
  priority?: PlannerPriority;
  updatedAt?: IsoDateTime | null;
  estimateMinutes?: number | null;
}

export type CommitmentKind = 'class' | 'school' | 'sports' | 'work' | 'appointment' | 'personal' | 'other';

export interface RecurringCommitmentInput {
  id: string;
  title: string;
  kind: CommitmentKind;
  daysOfWeek: number[];
  startTime: LocalTime;
  endTime: LocalTime;
  startDate?: LocalDate | null;
  endDate?: LocalDate | null;
  timeZone?: string | null;
  enabled?: boolean;
  color?: string | null;
  updatedAt?: IsoDateTime | null;
}

export interface PlannerEstimateCacheEntry {
  entityId: string;
  contentFingerprint: string;
  minutes: number;
  source: 'ai' | 'manual';
  model?: string | null;
  promptVersion?: string | null;
  explanation?: string | null;
  createdAt: IsoDateTime;
}

export interface PlannerFeedbackMultiplier {
  key: string;
  multiplier: number;
  sampleWeight: number;
  updatedAt: IsoDateTime;
}

export interface PlannerEstimateBreakdown {
  entityId: string;
  contentFingerprint: string;
  heuristicMinutes: number;
  overrideMinutes: number | null;
  overrideSource: 'ai' | 'manual' | null;
  feedbackKey: string | null;
  feedbackMultiplier: number;
  finalMinutes: number;
  reasons: string[];
}

export interface PlannerGenerationInput {
  userId: string;
  tasks: readonly PlannerTaskInput[];
  exams?: readonly PlannerExamInput[];
  commitments?: readonly RecurringCommitmentInput[];
  settings: PlannerSettings;
  estimateCache?: Readonly<Record<string, PlannerEstimateCacheEntry>>;
  feedbackMultipliers?: Readonly<Record<string, PlannerFeedbackMultiplier>>;
  now?: IsoDateTime;
  prompt?: string | null;
  /** Exact course/subject labels interpreted from the user's prompt. */
  focusSubjects?: readonly string[];
  /** Learned, bounded preference scores; negative buckets remain usable if needed. */
  timePreferenceScores?: PlannerTimePreferenceScores;
  /** Canonical templates used to create any plan-only task inputs. */
  requestedActivities?: readonly PlannerRequestedActivity[];
}

export interface PlannerFixedInterval {
  id: string;
  kind: 'school' | 'commitment';
  title: string;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  commitmentId?: string | null;
  color?: string | null;
  editable: boolean;
}

export interface PlannerBlock {
  id: string;
  planId: string;
  kind: 'task' | 'exam_prep' | 'requested_activity';
  sourceId: string;
  taskId?: string | null;
  examId?: string | null;
  activityId?: string | null;
  title: string;
  description?: string | null;
  subjectId?: string | null;
  assignmentType?: PlannerAssignmentType | null;
  priority: PlannerPriority;
  startAt: IsoDateTime;
  endAt: IsoDateTime;
  deadlineAt: IsoDateTime;
  estimatedMinutes: number;
  segmentIndex: number;
  segmentCount: number;
  locked: boolean;
  status: 'planned' | 'completed' | 'skipped';
}

export type PlannerWarningCode =
  | 'invalid_deadline'
  | 'deadline_passed'
  | 'insufficient_capacity'
  | 'no_availability'
  | 'invalid_commitment';

export interface PlannerWarning {
  id: string;
  code: PlannerWarningCode;
  entityKind: 'task' | 'exam' | 'commitment' | 'plan';
  entityId?: string | null;
  title: string;
  message: string;
  unscheduledMinutes?: number;
  deadlineAt?: IsoDateTime | null;
}

export interface PlannerInputSnapshot {
  version: number;
  tasks: Record<string, string>;
  exams: Record<string, string>;
  commitments: Record<string, string>;
  settingsFingerprint: string;
  estimatesFingerprint: string;
  feedbackFingerprint: string;
  fingerprint: string;
}

export interface PlannerPlan {
  id: string;
  userId: string;
  status: 'active' | 'stale' | 'archived';
  generatedAt: IsoDateTime;
  archivedAt?: IsoDateTime | null;
  horizonStart: IsoDateTime;
  horizonEnd: IsoDateTime;
  prompt?: string | null;
  /** Normalized intent used to deterministically break equal-deadline ties. */
  focusSubjects?: string[];
  /** Plan-only work derived from the prompt, retained for stable staleness checks. */
  promptTasks?: PlannerTaskInput[];
  /** Canonical prompt templates retained so explicit replans do not lose intent. */
  requestedActivities?: PlannerRequestedActivity[];
  /** Prompt-only availability constraints retained with the plan snapshot. */
  promptCommitments?: RecurringCommitmentInput[];
  inputFingerprint: string;
  inputSnapshot: PlannerInputSnapshot;
  settings: PlannerSettings;
  blocks: PlannerBlock[];
  fixedIntervals: PlannerFixedInterval[];
  estimates: Record<string, PlannerEstimateBreakdown>;
  warnings: PlannerWarning[];
  totalScheduledMinutes: number;
  totalUnscheduledMinutes: number;
}

export interface PlannerStaleness {
  isStale: boolean;
  previousFingerprint: string;
  currentFingerprint: string;
  newTaskIds: string[];
  removedTaskIds: string[];
  changedTaskIds: string[];
  newExamIds: string[];
  removedExamIds: string[];
  changedExamIds: string[];
  changedCommitmentIds: string[];
  settingsChanged: boolean;
  estimatesChanged: boolean;
  feedbackChanged: boolean;
  summary: string[];
}

export interface PlannerChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: IsoDateTime;
}

export type TimingRating = 'too_short' | 'accurate' | 'too_long';

export interface PlannerFeedbackRecord {
  id: string;
  planId?: string | null;
  blockId?: string | null;
  taskId?: string | null;
  examId?: string | null;
  activityId?: string | null;
  subjectId?: string | null;
  assignmentType?: PlannerAssignmentType | null;
  predictedMinutes: number;
  actualMinutes?: number | null;
  timingRating: TimingRating;
  scheduleRating?: number | null;
  note?: string | null;
  createdAt: IsoDateTime;
}

export type PlannerFeedbackInput = Omit<PlannerFeedbackRecord, 'id' | 'createdAt'>
  & Partial<Pick<PlannerFeedbackRecord, 'id' | 'createdAt'>>;

export interface PlannerAdjustmentRecord {
  id: string;
  planId: string;
  blockId?: string | null;
  type: 'move' | 'resize' | 'delete' | 'edit';
  previousStartAt?: IsoDateTime | null;
  previousEndAt?: IsoDateTime | null;
  newStartAt?: IsoDateTime | null;
  newEndAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface PlannerUserRecord {
  settings: PlannerSettings;
  commitments: RecurringCommitmentInput[];
  currentPlan: PlannerPlan | null;
  history: PlannerPlan[];
  messages: PlannerChatMessage[];
  estimateCache: Record<string, PlannerEstimateCacheEntry>;
  feedbackMultipliers: Record<string, PlannerFeedbackMultiplier>;
  feedback: PlannerFeedbackRecord[];
  adjustments: PlannerAdjustmentRecord[];
}

export interface PlannerActionResult<T = undefined> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface PlannerBlockPatch {
  title?: string;
  description?: string | null;
  startAt?: IsoDateTime;
  endAt?: IsoDateTime;
  locked?: boolean;
  status?: PlannerBlock['status'];
}
