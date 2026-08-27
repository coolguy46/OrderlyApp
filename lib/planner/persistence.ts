import type { Database, Json } from '@/lib/supabase/types';
import type {
  PlannerBlock,
  PlannerAdjustmentRecord,
  PlannerChatMessage,
  PlannerEstimateCacheEntry,
  PlannerFeedbackMultiplier,
  PlannerFeedbackRecord,
  PlannerPlan,
  PlannerSettings,
  PlannerUserRecord,
  RecurringCommitmentInput,
} from './types';

type PreferencesRow = Database['public']['Tables']['planner_preferences']['Row'];
type PreferencesInsert = Database['public']['Tables']['planner_preferences']['Insert'];
type CommitmentRow = Database['public']['Tables']['recurring_commitments']['Row'];
type CommitmentInsert = Database['public']['Tables']['recurring_commitments']['Insert'];
type PlanRow = Database['public']['Tables']['planner_plans']['Row'];
type PlanInsert = Database['public']['Tables']['planner_plans']['Insert'];
type BlockInsert = Database['public']['Tables']['planner_blocks']['Insert'];
type FeedbackRow = Database['public']['Tables']['planner_feedback']['Row'];
type FeedbackInsert = Database['public']['Tables']['planner_feedback']['Insert'];
type AdjustmentRow = Database['public']['Tables']['plan_adjustments']['Row'];
type AdjustmentInsert = Database['public']['Tables']['plan_adjustments']['Insert'];

export interface PlannerPersistenceSnapshot {
  hasServerData: boolean;
  serverRevision: number;
  settings?: Partial<PlannerSettings>;
  commitments: RecurringCommitmentInput[];
  currentPlan: PlannerPlan | null;
  history: PlannerPlan[];
  messages: PlannerChatMessage[];
  estimateCache: Record<string, PlannerEstimateCacheEntry>;
  feedbackMultipliers: Record<string, PlannerFeedbackMultiplier>;
  feedback: PlannerFeedbackRecord[];
  adjustments: PlannerAdjustmentRecord[];
}

function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

function objectRecord<T>(value: Json, predicate: (candidate: unknown) => candidate is T): Record<string, T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, T> = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (predicate(candidate)) result[key] = candidate;
  }
  return result;
}

function isEstimate(value: unknown): value is PlannerEstimateCacheEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PlannerEstimateCacheEntry>;
  return typeof candidate.entityId === 'string'
    && typeof candidate.contentFingerprint === 'string'
    && typeof candidate.minutes === 'number'
    && (candidate.source === 'ai' || candidate.source === 'manual')
    && typeof candidate.createdAt === 'string';
}

function isMultiplier(value: unknown): value is PlannerFeedbackMultiplier {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<PlannerFeedbackMultiplier>;
  return typeof candidate.key === 'string'
    && typeof candidate.multiplier === 'number'
    && typeof candidate.sampleWeight === 'number'
    && typeof candidate.updatedAt === 'string';
}

function timeWithoutSeconds(value: string): string {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

function isPlannerPlan(value: Json, userId: string, clientPlanId: string): value is Json & PlannerPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as unknown as Partial<PlannerPlan>;
  return candidate.id === clientPlanId
    && candidate.userId === userId
    && (candidate.status === 'active' || candidate.status === 'stale' || candidate.status === 'archived')
    && typeof candidate.generatedAt === 'string'
    && typeof candidate.horizonStart === 'string'
    && typeof candidate.horizonEnd === 'string'
    && Array.isArray(candidate.blocks)
    && Array.isArray(candidate.fixedIntervals)
    && Array.isArray(candidate.warnings);
}

function plannerPlanFromRow(row: PlanRow, userId: string): PlannerPlan | null {
  if (!isPlannerPlan(row.plan_payload, userId, row.client_plan_id)) return null;
  const plan = row.plan_payload as unknown as PlannerPlan;
  return {
    ...plan,
    userId,
    status: row.status,
    archivedAt: row.archived_at,
  };
}

function messagesFromJson(value: Json): PlannerChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, Json | undefined>;
    if (
      typeof item.id !== 'string'
      || (item.role !== 'user' && item.role !== 'assistant' && item.role !== 'system')
      || typeof item.content !== 'string'
      || typeof item.createdAt !== 'string'
    ) return [];
    return [{ id: item.id, role: item.role, content: item.content, createdAt: item.createdAt }];
  });
}

function commitmentFromRow(row: CommitmentRow): RecurringCommitmentInput | null {
  if (!row.client_commitment_id || !row.title.trim()) return null;
  const rawOverrides = row.occurrence_overrides;
  const occurrenceOverrides = rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)
    ? rawOverrides as RecurringCommitmentInput['occurrenceOverrides']
    : {};
  return {
    id: row.client_commitment_id,
    title: row.title,
    kind: row.kind,
    daysOfWeek: row.days_of_week,
    startTime: timeWithoutSeconds(row.start_time),
    endTime: timeWithoutSeconds(row.end_time),
    startDate: row.start_date,
    endDate: row.end_date,
    timeZone: row.time_zone,
    enabled: row.enabled,
    color: row.color,
    updatedAt: row.updated_at,
    occurrenceOverrides,
  };
}

function feedbackFromRow(row: FeedbackRow): PlannerFeedbackRecord | null {
  if (!row.client_feedback_id || !row.timing_rating || row.predicted_minutes <= 0) return null;
  return {
    id: row.client_feedback_id,
    planId: row.client_plan_id,
    blockId: row.client_block_id,
    taskId: row.task_id,
    examId: row.exam_id,
    activityId: row.activity_id,
    subjectId: row.subject_id,
    assignmentType: row.assignment_type,
    predictedMinutes: row.predicted_minutes,
    actualMinutes: row.actual_minutes,
    timingRating: row.timing_rating,
    scheduleRating: row.schedule_rating,
    note: row.note,
    createdAt: row.created_at,
  };
}

function adjustmentFromRow(row: AdjustmentRow): PlannerAdjustmentRecord | null {
  if (!row.client_adjustment_id || !row.client_plan_id || !row.adjustment_type) return null;
  return {
    id: row.client_adjustment_id,
    planId: row.client_plan_id,
    blockId: row.client_block_id,
    type: row.adjustment_type,
    previousStartAt: row.previous_start_at,
    previousEndAt: row.previous_end_at,
    newStartAt: row.new_start_at,
    newEndAt: row.new_end_at,
    createdAt: row.created_at,
  };
}

export function plannerPersistenceSnapshotFromRows(
  userId: string,
  preferences: PreferencesRow | null,
  commitments: readonly CommitmentRow[],
  planRows: readonly PlanRow[],
  feedbackRows: readonly FeedbackRow[] = [],
  adjustmentRows: readonly AdjustmentRow[] = [],
): PlannerPersistenceSnapshot {
  const ownedPreferences = preferences?.user_id === userId ? preferences : null;
  const ownedCommitments = commitments.filter(row => row.user_id === userId);
  const ownedPlanRows = planRows.filter(row => row.user_id === userId);
  const ownedFeedbackRows = feedbackRows.filter(row => row.user_id === userId);
  const ownedAdjustmentRows = adjustmentRows.filter(row => row.user_id === userId);
  const plans = ownedPlanRows
    .flatMap(row => {
      const plan = plannerPlanFromRow(row, userId);
      return plan ? [plan] : [];
    })
    .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt));
  const currentPlan = plans.find(plan => plan.status === 'active' || plan.status === 'stale') || null;
  const history = plans.filter(plan => plan.id !== currentPlan?.id && plan.status === 'archived').slice(0, 24);
  const messageOwner = currentPlan
    ? ownedPlanRows.find(row => row.client_plan_id === currentPlan.id)
    : ownedPlanRows[0];

  return {
    hasServerData: Boolean(
      ownedPreferences
      || ownedCommitments.length > 0
      || ownedPlanRows.length > 0
      || ownedFeedbackRows.length > 0
      || ownedAdjustmentRows.length > 0
    ),
    serverRevision: ownedPreferences?.revision || 0,
    settings: ownedPreferences ? {
      timeZone: ownedPreferences.time_zone,
      horizonDays: ownedPreferences.horizon_days,
      slotMinutes: 15,
      maxBlockMinutes: ownedPreferences.max_block_minutes,
      wakeTime: timeWithoutSeconds(ownedPreferences.wake_time),
      schoolStartTime: timeWithoutSeconds(ownedPreferences.school_start_time),
      schoolHomeTime: timeWithoutSeconds(ownedPreferences.school_home_time),
      bedtime: timeWithoutSeconds(ownedPreferences.bedtime),
      schoolDays: ownedPreferences.school_days,
      weekendAvailableStart: timeWithoutSeconds(ownedPreferences.weekend_available_start),
      weekendAvailableEnd: timeWithoutSeconds(ownedPreferences.weekend_available_end),
      maxDailyMinutes: ownedPreferences.max_daily_minutes,
      minBreakMinutes: ownedPreferences.min_break_minutes,
    } : undefined,
    commitments: ownedCommitments
      .flatMap(row => {
        const commitment = commitmentFromRow(row);
        return commitment ? [commitment] : [];
      })
      .sort((left, right) => left.id.localeCompare(right.id)),
    currentPlan,
    history,
    messages: messageOwner ? messagesFromJson(messageOwner.messages) : [],
    estimateCache: ownedPreferences ? objectRecord(ownedPreferences.estimate_cache, isEstimate) : {},
    feedbackMultipliers: ownedPreferences ? objectRecord(ownedPreferences.feedback_multipliers, isMultiplier) : {},
    feedback: ownedFeedbackRows
      .flatMap(row => {
        const feedback = feedbackFromRow(row);
        return feedback ? [feedback] : [];
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    adjustments: ownedAdjustmentRows
      .flatMap(row => {
        const adjustment = adjustmentFromRow(row);
        return adjustment ? [adjustment] : [];
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
  };
}

export function plannerPreferencesInsert(userId: string, record: PlannerUserRecord): PreferencesInsert {
  const settings = record.settings;
  return {
    user_id: userId,
    time_zone: settings.timeZone,
    horizon_days: settings.horizonDays,
    slot_minutes: 15,
    max_block_minutes: settings.maxBlockMinutes,
    wake_time: settings.wakeTime,
    school_start_time: settings.schoolStartTime,
    school_home_time: settings.schoolHomeTime,
    bedtime: settings.bedtime,
    school_days: settings.schoolDays,
    weekend_available_start: settings.weekendAvailableStart,
    weekend_available_end: settings.weekendAvailableEnd,
    max_daily_minutes: settings.maxDailyMinutes,
    min_break_minutes: settings.minBreakMinutes,
    estimate_cache: asJson(record.estimateCache),
    feedback_multipliers: asJson(record.feedbackMultipliers),
  };
}

export function recurringCommitmentInsert(userId: string, item: RecurringCommitmentInput): CommitmentInsert {
  return {
    user_id: userId,
    client_commitment_id: item.id,
    title: item.title,
    kind: item.kind,
    days_of_week: item.daysOfWeek,
    start_time: item.startTime,
    end_time: item.endTime,
    start_date: item.startDate || null,
    end_date: item.endDate || null,
    time_zone: item.timeZone || 'UTC',
    enabled: item.enabled !== false,
    color: item.color || null,
    occurrence_overrides: asJson(item.occurrenceOverrides || {}),
  };
}

export function plannerPlanInsert(
  userId: string,
  plan: PlannerPlan,
  messages: readonly PlannerChatMessage[],
): PlanInsert {
  return {
    user_id: userId,
    client_plan_id: plan.id,
    status: plan.status,
    generated_at: plan.generatedAt,
    archived_at: plan.archivedAt || null,
    horizon_start: plan.horizonStart,
    horizon_end: plan.horizonEnd,
    prompt: plan.prompt || null,
    input_fingerprint: plan.inputFingerprint,
    input_snapshot: asJson(plan.inputSnapshot),
    settings_snapshot: asJson(plan.settings),
    plan_payload: asJson(plan),
    messages: asJson(messages),
    warnings: asJson(plan.warnings),
    total_scheduled_minutes: plan.totalScheduledMinutes,
    total_unscheduled_minutes: plan.totalUnscheduledMinutes,
  };
}

function uuidOrNull(value: string | null | undefined): string | null {
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function plannerBlockInsert(userId: string, databasePlanId: string, block: PlannerBlock): BlockInsert {
  return {
    plan_id: databasePlanId,
    user_id: userId,
    client_block_id: block.id,
    source_kind: block.kind,
    task_id: uuidOrNull(block.taskId),
    exam_id: uuidOrNull(block.examId),
    activity_id: block.activityId || null,
    commitment_id: null,
    source_id_snapshot: block.sourceId,
    title_snapshot: block.title,
    description_snapshot: block.description || null,
    subject_id: uuidOrNull(block.subjectId),
    assignment_type: block.assignmentType || null,
    priority: block.priority,
    start_at: block.startAt,
    end_at: block.endAt,
    deadline_at: block.deadlineAt,
    estimated_minutes: block.estimatedMinutes,
    segment_index: block.segmentIndex,
    segment_count: block.segmentCount,
    locked: block.locked,
    status: block.status,
  };
}

export function plannerFeedbackInsert(userId: string, feedback: PlannerFeedbackRecord): FeedbackInsert {
  return {
    user_id: userId,
    client_feedback_id: feedback.id,
    plan_id: null,
    client_plan_id: feedback.planId || null,
    block_id: null,
    client_block_id: feedback.blockId || null,
    task_id: uuidOrNull(feedback.taskId),
    exam_id: uuidOrNull(feedback.examId),
    activity_id: feedback.activityId || null,
    subject_id: uuidOrNull(feedback.subjectId),
    assignment_type: feedback.assignmentType || null,
    predicted_minutes: feedback.predictedMinutes,
    actual_minutes: feedback.actualMinutes ?? null,
    timing_rating: feedback.timingRating,
    schedule_rating: feedback.scheduleRating ?? null,
    note: feedback.note || null,
    created_at: feedback.createdAt,
  };
}

export function plannerAdjustmentInsert(userId: string, adjustment: PlannerAdjustmentRecord): AdjustmentInsert {
  return {
    user_id: userId,
    client_adjustment_id: adjustment.id,
    plan_id: null,
    client_plan_id: adjustment.planId,
    block_id: null,
    client_block_id: adjustment.blockId || null,
    adjustment_type: adjustment.type,
    previous_start_at: adjustment.previousStartAt || null,
    previous_end_at: adjustment.previousEndAt || null,
    new_start_at: adjustment.newStartAt || null,
    new_end_at: adjustment.newEndAt || null,
    metadata: {},
    created_at: adjustment.createdAt,
  };
}

/** Build the complete JSON argument consumed atomically by replace_planner_snapshot. */
export function plannerPersistencePayload(userId: string, record: PlannerUserRecord): Json {
  const plansById = new Map<string, PlannerPlan>(
    record.history.map(plan => [plan.id, { ...plan, status: 'archived' as const }]),
  );
  if (record.currentPlan) plansById.set(record.currentPlan.id, record.currentPlan);
  const plans = [...plansById.values()];
  const messagePlanId = record.currentPlan?.id || plans[0]?.id || null;

  return asJson({
    preferences: plannerPreferencesInsert(userId, record),
    commitments: record.commitments.map(item => recurringCommitmentInsert(userId, item)),
    plans: plans.map(plan => ({
      row: plannerPlanInsert(userId, plan, plan.id === messagePlanId ? record.messages : []),
      blocks: plan.blocks.map(block => plannerBlockInsert(userId, '00000000-0000-0000-0000-000000000000', block)),
    })),
    feedback: record.feedback.map(item => plannerFeedbackInsert(userId, item)),
    adjustments: record.adjustments.map(item => plannerAdjustmentInsert(userId, item)),
  });
}

/** Server state wins after a clean sync; an offline pending revision keeps the local snapshot. */
export function mergePlannerHydration(
  local: PlannerUserRecord,
  remote: PlannerPersistenceSnapshot,
  hasPendingRevision: boolean,
): PlannerUserRecord {
  if (hasPendingRevision || !remote.hasServerData) return local;
  return {
    ...local,
    settings: { ...local.settings, ...(remote.settings || {}) },
    commitments: remote.commitments,
    currentPlan: remote.currentPlan,
    history: remote.history,
    messages: remote.messages,
    estimateCache: remote.estimateCache,
    feedbackMultipliers: remote.feedbackMultipliers,
    feedback: remote.feedback,
    adjustments: remote.adjustments,
  };
}
