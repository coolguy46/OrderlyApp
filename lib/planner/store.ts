'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createEstimateCacheKey,
  feedbackMultiplierKeys,
  generatePlannerPlan,
  getPlannerStaleness,
  normalizePlannerSettings,
} from './engine';
import {
  PLANNER_SLOT_MINUTES,
  getDefaultPlannerSettings,
  type PlannerActionResult,
  type PlannerAdjustmentRecord,
  type PlannerBlock,
  type PlannerBlockPatch,
  type PlannerChatMessage,
  type PlannerEstimateCacheEntry,
  type PlannerExamInput,
  type PlannerFeedbackMultiplier,
  type PlannerFeedbackInput,
  type PlannerFeedbackRecord,
  type PlannerGenerationInput,
  type PlannerPlan,
  type PlannerRequestedActivity,
  type PlannerSettings,
  type PlannerStaleness,
  type PlannerTaskInput,
  type PlannerTimeBucket,
  type PlannerTimePreferenceScores,
  type PlannerUserRecord,
  type RecurringCommitmentInput,
} from './types';

const MINUTE_MS = 60_000;
const MAX_HISTORY = 24;
const MAX_MESSAGES = 200;
const MAX_FEEDBACK = 500;
const MAX_ADJUSTMENTS = 1_000;

export interface PlannerGenerateRequest {
  tasks: readonly PlannerTaskInput[];
  exams?: readonly PlannerExamInput[];
  commitments?: readonly RecurringCommitmentInput[];
  settings?: Partial<PlannerSettings>;
  estimateCache?: Readonly<Record<string, PlannerEstimateCacheEntry>>;
  feedbackMultipliers?: Readonly<Record<string, PlannerFeedbackMultiplier>>;
  now?: string;
  prompt?: string | null;
  focusSubjects?: readonly string[];
  timePreferenceScores?: PlannerTimePreferenceScores;
  requestedActivities?: readonly PlannerRequestedActivity[];
}

export interface PlannerStoreState {
  activeUserId: string | null;
  users: Record<string, PlannerUserRecord>;
  setActiveUser: (userId: string | null, timeZone?: string) => void;
  ensureUser: (userId: string, timeZone?: string) => PlannerUserRecord;
  updateSettings: (userId: string, patch: Partial<PlannerSettings>) => PlannerSettings;
  setCommitments: (userId: string, commitments: RecurringCommitmentInput[]) => void;
  upsertCommitment: (userId: string, commitment: RecurringCommitmentInput) => void;
  removeCommitment: (userId: string, commitmentId: string) => void;
  generatePlan: (userId: string, request: PlannerGenerateRequest) => PlannerPlan;
  savePlan: (userId: string, plan: PlannerPlan) => void;
  refreshPlanStaleness: (userId: string, request: PlannerGenerateRequest) => PlannerStaleness | null;
  updateBlock: (userId: string, blockId: string, patch: PlannerBlockPatch) => PlannerActionResult<PlannerBlock>;
  moveBlock: (userId: string, blockId: string, newStartAt: string) => PlannerActionResult<PlannerBlock>;
  resizeBlock: (userId: string, blockId: string, newDurationMinutes: number) => PlannerActionResult<PlannerBlock>;
  deleteBlock: (userId: string, blockId: string) => PlannerActionResult;
  archiveCurrentPlan: (userId: string) => PlannerActionResult<PlannerPlan>;
  deletePlan: (userId: string, planId: string) => PlannerActionResult;
  addMessage: (userId: string, message: Omit<PlannerChatMessage, 'id' | 'createdAt'> & Partial<Pick<PlannerChatMessage, 'id' | 'createdAt'>>) => PlannerChatMessage;
  clearMessages: (userId: string) => void;
  cacheEstimate: (userId: string, entry: PlannerEstimateCacheEntry, cacheKey?: string) => void;
  removeCachedEstimate: (userId: string, cacheKey: string) => void;
  recordFeedback: (userId: string, feedback: PlannerFeedbackInput) => PlannerActionResult<PlannerFeedbackRecord>;
  clearUserPlannerData: (userId: string) => void;
}

function uniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createUserRecord(timeZone?: string): PlannerUserRecord {
  return {
    settings: getDefaultPlannerSettings(timeZone),
    commitments: [],
    currentPlan: null,
    history: [],
    messages: [],
    estimateCache: {},
    feedbackMultipliers: {},
    feedback: [],
    adjustments: [],
  };
}

function hydratedRecord(record: Partial<PlannerUserRecord> | undefined, timeZone?: string): PlannerUserRecord {
  const fallback = createUserRecord(timeZone);
  if (!record) return fallback;
  return {
    ...fallback,
    ...record,
    settings: normalizePlannerSettings({ ...fallback.settings, ...(record.settings || {}) }),
    commitments: record.commitments || [],
    history: record.history || [],
    messages: record.messages || [],
    estimateCache: record.estimateCache || {},
    feedbackMultipliers: record.feedbackMultipliers || {},
    feedback: record.feedback || [],
    adjustments: record.adjustments || [],
  };
}

function archivePlan(plan: PlannerPlan, archivedAt = new Date().toISOString()): PlannerPlan {
  return { ...plan, status: 'archived', archivedAt };
}

function planWithRecalculatedTotals(plan: PlannerPlan, blocks: PlannerBlock[]): PlannerPlan {
  const sorted = [...blocks].sort((left, right) => left.startAt.localeCompare(right.startAt) || left.id.localeCompare(right.id));
  return {
    ...plan,
    blocks: sorted,
    totalScheduledMinutes: sorted.reduce((sum, block) => sum + block.estimatedMinutes, 0),
  };
}

function localDateAt(timestamp: number, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function intervalsOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function validateBlock(plan: PlannerPlan, candidate: PlannerBlock, ignoredBlockId: string): string | null {
  const start = new Date(candidate.startAt).getTime();
  const end = new Date(candidate.endAt).getTime();
  const horizonStart = new Date(plan.horizonStart).getTime();
  const horizonEnd = new Date(plan.horizonEnd).getTime();
  if (![start, end, horizonStart, horizonEnd].every(Number.isFinite)) return 'The block contains an invalid date.';

  const durationMinutes = (end - start) / MINUTE_MS;
  const slotMs = PLANNER_SLOT_MINUTES * MINUTE_MS;
  if (start % slotMs !== 0 || end % slotMs !== 0) return `Blocks must align to the ${PLANNER_SLOT_MINUTES}-minute grid.`;
  if (durationMinutes < PLANNER_SLOT_MINUTES || durationMinutes % PLANNER_SLOT_MINUTES !== 0) {
    return `Blocks must be at least ${PLANNER_SLOT_MINUTES} minutes and use the ${PLANNER_SLOT_MINUTES}-minute grid.`;
  }
  if (durationMinutes > plan.settings.maxBlockMinutes) return `Blocks cannot exceed ${plan.settings.maxBlockMinutes} minutes.`;
  if (start < horizonStart || end > horizonEnd) return 'The block must stay inside this plan week.';
  if (localDateAt(start, plan.settings.timeZone) !== localDateAt(end - 1, plan.settings.timeZone)) {
    return 'A block cannot cross into another day.';
  }

  for (const block of plan.blocks) {
    if (block.id === ignoredBlockId || block.status === 'skipped') continue;
    const otherStart = new Date(block.startAt).getTime();
    const otherEnd = new Date(block.endAt).getTime();
    if (intervalsOverlap(start, end, otherStart, otherEnd)) return `This time overlaps “${block.title}”.`;
    const breakMs = plan.settings.minBreakMinutes * MINUTE_MS;
    if (
      breakMs > 0
      && ((start >= otherEnd && start < otherEnd + breakMs)
        || (otherStart >= end && otherStart < end + breakMs))
    ) {
      return `Keep at least ${plan.settings.minBreakMinutes} minutes between work blocks.`;
    }
  }
  for (const fixed of plan.fixedIntervals) {
    const fixedStart = new Date(fixed.startAt).getTime();
    const fixedEnd = new Date(fixed.endAt).getTime();
    if (intervalsOverlap(start, end, fixedStart, fixedEnd)) return `This time overlaps “${fixed.title}”.`;
  }

  const candidateDate = localDateAt(start, plan.settings.timeZone);
  const otherMinutes = plan.blocks
    .filter(block => block.id !== ignoredBlockId && block.status !== 'skipped')
    .filter(block => localDateAt(new Date(block.startAt).getTime(), plan.settings.timeZone) === candidateDate)
    .reduce((sum, block) => sum + block.estimatedMinutes, 0);
  if (otherMinutes + durationMinutes > plan.settings.maxDailyMinutes) {
    return `This change exceeds the ${plan.settings.maxDailyMinutes}-minute daily limit.`;
  }
  return null;
}

function createAdjustment(
  planId: string,
  block: PlannerBlock,
  type: PlannerAdjustmentRecord['type'],
  next?: PlannerBlock,
): PlannerAdjustmentRecord {
  return {
    id: uniqueId('adjustment'),
    planId,
    blockId: block.id,
    type,
    previousStartAt: block.startAt,
    previousEndAt: block.endAt,
    newStartAt: next?.startAt || null,
    newEndAt: next?.endAt || null,
    createdAt: new Date().toISOString(),
  };
}

function timeBucketAt(value: string | null | undefined, timeZone: string): PlannerTimeBucket | null {
  if (!value) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  const hourPart = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp).find(part => part.type === 'hour')?.value;
  const hour = Number(hourPart);
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/**
 * Convert already-persisted moves and happy/unhappy schedule feedback into a
 * small deterministic bias. These scores contain no AI work and never block a
 * necessary deadline slot; the engine merely uses them to rank feasible slots.
 */
export function derivePlannerTimePreferenceScores(
  record: PlannerUserRecord,
): PlannerTimePreferenceScores {
  const scores: Record<PlannerTimeBucket, number> = {
    morning: 0,
    afternoon: 0,
    evening: 0,
    night: 0,
  };
  const add = (value: string | null | undefined, amount: number) => {
    const bucket = timeBucketAt(value, record.settings.timeZone);
    if (bucket) scores[bucket] += amount;
  };

  record.adjustments.forEach(adjustment => {
    if (adjustment.type !== 'move') return;
    add(adjustment.previousStartAt, -0.1);
    add(adjustment.newStartAt, 0.2);
  });

  const blockById = new Map<string, PlannerBlock>();
  [...record.history, ...(record.currentPlan ? [record.currentPlan] : [])]
    .forEach(plan => plan.blocks.forEach(block => blockById.set(block.id, block)));
  record.feedback.forEach(feedback => {
    if (!feedback.blockId || !feedback.scheduleRating) return;
    const block = blockById.get(feedback.blockId);
    if (!block) return;
    if (feedback.scheduleRating >= 4) add(block.startAt, 0.1);
    else if (feedback.scheduleRating <= 2) add(block.startAt, -0.1);
  });

  return Object.fromEntries(
    Object.entries(scores)
      .filter(([, score]) => score !== 0)
      .map(([bucket, score]) => [bucket, Math.round(Math.min(1, Math.max(-1, score)) * 100) / 100]),
  ) as PlannerTimePreferenceScores;
}

/**
 * Treat an explicit duration resize as a small timing signal for future plans.
 * This is recomputed from persisted adjustments, so it is deterministic and
 * never spends AI tokens. Direct feedback remains the stronger signal.
 */
export function derivePlannerAdjustmentMultipliers(
  record: PlannerUserRecord,
): Record<string, PlannerFeedbackMultiplier> {
  const multipliers = { ...record.feedbackMultipliers };
  const blockById = new Map<string, PlannerBlock>();
  [...record.history, ...(record.currentPlan ? [record.currentPlan] : [])]
    .forEach(plan => plan.blocks.forEach(block => blockById.set(block.id, block)));

  [...record.adjustments].reverse().forEach(adjustment => {
    if (adjustment.type !== 'resize' && adjustment.type !== 'edit') return;
    if (!adjustment.previousStartAt || !adjustment.previousEndAt
      || !adjustment.newStartAt || !adjustment.newEndAt) return;
    const previousMinutes = (
      new Date(adjustment.previousEndAt).getTime()
      - new Date(adjustment.previousStartAt).getTime()
    ) / MINUTE_MS;
    const nextMinutes = (
      new Date(adjustment.newEndAt).getTime()
      - new Date(adjustment.newStartAt).getTime()
    ) / MINUTE_MS;
    if (!Number.isFinite(previousMinutes) || !Number.isFinite(nextMinutes)
      || previousMinutes <= 0 || nextMinutes <= 0 || previousMinutes === nextMinutes) return;

    if (!adjustment.blockId) return;
    const block = blockById.get(adjustment.blockId);
    if (!block) return;
    const kind = block.activityId ? 'activity' as const : block.examId ? 'exam' as const : 'task' as const;
    const entityId = block.activityId || block.examId || block.taskId;
    if (!entityId) return;
    const keys = feedbackMultiplierKeys(
      kind,
      entityId,
      block.subjectId || null,
      block.assignmentType || (block.examId ? 'exam' : 'assignment'),
    );
    keys.forEach((key, index) => {
      const weight = index === 0 ? 0.2 : 0.1;
      multipliers[key] = updateMultiplier(
        multipliers[key],
        key,
        nextMinutes / previousMinutes,
        weight,
        adjustment.createdAt,
      );
    });
  });

  return multipliers;
}

function mergeGenerationInput(
  userId: string,
  record: PlannerUserRecord,
  request: PlannerGenerateRequest,
): PlannerGenerationInput {
  return {
    userId,
    tasks: request.tasks,
    exams: request.exams || [],
    commitments: request.commitments || record.commitments,
    settings: normalizePlannerSettings({ ...record.settings, ...(request.settings || {}) }),
    estimateCache: request.estimateCache || record.estimateCache,
    feedbackMultipliers: request.feedbackMultipliers || derivePlannerAdjustmentMultipliers(record),
    now: request.now,
    prompt: request.prompt || null,
    focusSubjects: request.focusSubjects || [],
    timePreferenceScores: request.timePreferenceScores || derivePlannerTimePreferenceScores(record),
    requestedActivities: request.requestedActivities || [],
  };
}

function observedFeedbackRatio(feedback: PlannerFeedbackRecord): { ratio: number; weight: number } {
  if (feedback.actualMinutes && feedback.actualMinutes > 0 && feedback.predictedMinutes > 0) {
    return {
      ratio: Math.min(2.5, Math.max(0.5, feedback.actualMinutes / feedback.predictedMinutes)),
      weight: 1,
    };
  }
  if (feedback.timingRating === 'too_short') return { ratio: 1.25, weight: 0.5 };
  if (feedback.timingRating === 'too_long') return { ratio: 0.8, weight: 0.5 };
  return { ratio: 1, weight: 0.5 };
}

function updateMultiplier(
  existing: PlannerFeedbackMultiplier | undefined,
  key: string,
  ratio: number,
  observationWeight: number,
  updatedAt: string,
): PlannerFeedbackMultiplier {
  const previousWeight = Math.max(0, existing?.sampleWeight || 0);
  const previousMultiplier = existing?.multiplier || 1;
  const nextWeight = previousWeight + observationWeight;
  const nextMultiplier = (previousMultiplier * previousWeight + ratio * observationWeight) / nextWeight;
  return {
    key,
    multiplier: Math.min(2.5, Math.max(0.5, nextMultiplier)),
    sampleWeight: nextWeight,
    updatedAt,
  };
}

export const usePlannerStore = create<PlannerStoreState>()(
  persist(
    (set, get) => ({
      activeUserId: null,
      users: {},

      setActiveUser: (userId, timeZone) => {
        if (userId && !get().users[userId]) {
          set(state => ({
            activeUserId: userId,
            users: { ...state.users, [userId]: createUserRecord(timeZone) },
          }));
          return;
        }
        set({ activeUserId: userId });
      },

      ensureUser: (userId, timeZone) => {
        const existing = get().users[userId];
        if (existing) return existing;
        const created = createUserRecord(timeZone);
        set(state => ({ users: { ...state.users, [userId]: created } }));
        return created;
      },

      updateSettings: (userId, patch) => {
        const current = get().ensureUser(userId);
        const settings = normalizePlannerSettings({ ...current.settings, ...patch });
        set(state => ({
          users: {
            ...state.users,
            [userId]: { ...hydratedRecord(state.users[userId]), settings },
          },
        }));
        return settings;
      },

      setCommitments: (userId, commitments) => {
        get().ensureUser(userId);
        const sorted = [...commitments].sort((left, right) => left.id.localeCompare(right.id));
        set(state => ({
          users: { ...state.users, [userId]: { ...hydratedRecord(state.users[userId]), commitments: sorted } },
        }));
      },

      upsertCommitment: (userId, commitment) => {
        const current = get().ensureUser(userId);
        const commitments = [
          ...current.commitments.filter(item => item.id !== commitment.id),
          commitment,
        ].sort((left, right) => left.id.localeCompare(right.id));
        set(state => ({
          users: { ...state.users, [userId]: { ...hydratedRecord(state.users[userId]), commitments } },
        }));
      },

      removeCommitment: (userId, commitmentId) => {
        const current = get().ensureUser(userId);
        set(state => ({
          users: {
            ...state.users,
            [userId]: {
              ...hydratedRecord(state.users[userId]),
              commitments: current.commitments.filter(item => item.id !== commitmentId),
            },
          },
        }));
      },

      generatePlan: (userId, request) => {
        const current = get().ensureUser(userId);
        const generationInput = mergeGenerationInput(userId, current, request);
        const generated = generatePlannerPlan(generationInput);
        // Plan IDs are derived from canonical inputs. Reuse the matching plan
        // (including manual edits) so deleting/archiving and repeating the same
        // request restores the same result instead of inventing a new calendar.
        const reusable = current.currentPlan?.id === generated.id
          ? current.currentPlan
          : current.history.find(plan => plan.id === generated.id);
        const plan: PlannerPlan = reusable
          ? { ...reusable, status: 'active', archivedAt: null }
          : generated;
        const historyWithoutRestored = current.history.filter(item => item.id !== plan.id);
        const history = current.currentPlan && current.currentPlan.id !== plan.id
          ? [archivePlan(current.currentPlan, plan.generatedAt), ...historyWithoutRestored].slice(0, MAX_HISTORY)
          : historyWithoutRestored;
        set(state => ({
          users: {
            ...state.users,
            [userId]: {
              ...hydratedRecord(state.users[userId]),
              settings: generationInput.settings,
              commitments: [...(generationInput.commitments || [])],
              currentPlan: plan,
              history,
            },
          },
        }));
        return plan;
      },

      savePlan: (userId, plan) => {
        const current = get().ensureUser(userId);
        const history = current.currentPlan && current.currentPlan.id !== plan.id
          ? [archivePlan(current.currentPlan), ...current.history].slice(0, MAX_HISTORY)
          : current.history;
        set(state => ({
          users: {
            ...state.users,
            [userId]: { ...hydratedRecord(state.users[userId]), currentPlan: plan, history },
          },
        }));
      },

      refreshPlanStaleness: (userId, request) => {
        const current = get().ensureUser(userId);
        if (!current.currentPlan) return null;
        const staleness = getPlannerStaleness(
          current.currentPlan,
          mergeGenerationInput(userId, current, request),
        );
        const nextStatus = staleness.isStale ? 'stale' : 'active';
        if (
          current.currentPlan.status !== 'archived'
          && current.currentPlan.status !== nextStatus
        ) {
          set(state => ({
            users: {
              ...state.users,
              [userId]: {
                ...hydratedRecord(state.users[userId]),
                currentPlan: state.users[userId].currentPlan
                  ? { ...state.users[userId].currentPlan, status: nextStatus }
                  : null,
              },
            },
          }));
        }
        return staleness;
      },

      updateBlock: (userId, blockId, patch) => {
        const current = get().ensureUser(userId);
        const plan = current.currentPlan;
        if (!plan) return { ok: false, error: 'There is no active plan.' };
        if (plan.status === 'archived') return { ok: false, error: 'Archived plans cannot be edited.' };
        const block = plan.blocks.find(item => item.id === blockId);
        if (!block) return { ok: false, error: 'The plan block was not found.' };
        const candidate: PlannerBlock = {
          ...block,
          ...patch,
          estimatedMinutes: Math.round(
            (new Date(patch.endAt || block.endAt).getTime() - new Date(patch.startAt || block.startAt).getTime()) / MINUTE_MS,
          ),
        };
        if (!candidate.title.trim()) return { ok: false, error: 'A plan block needs a title.' };
        const validationError = validateBlock(plan, candidate, block.id);
        if (validationError) return { ok: false, error: validationError };
        const nextPlan = planWithRecalculatedTotals(
          plan,
          plan.blocks.map(item => item.id === blockId ? candidate : item),
        );
        const adjustment = createAdjustment(plan.id, block, 'edit', candidate);
        set(state => ({
          users: {
            ...state.users,
            [userId]: {
              ...hydratedRecord(state.users[userId]),
              currentPlan: nextPlan,
              adjustments: [adjustment, ...hydratedRecord(state.users[userId]).adjustments].slice(0, MAX_ADJUSTMENTS),
            },
          },
        }));
        return { ok: true, value: candidate };
      },

      moveBlock: (userId, blockId, newStartAt) => {
        const current = get().ensureUser(userId);
        const block = current.currentPlan?.blocks.find(item => item.id === blockId);
        if (!block) return { ok: false, error: 'The plan block was not found.' };
        const duration = new Date(block.endAt).getTime() - new Date(block.startAt).getTime();
        const start = new Date(newStartAt).getTime();
        if (!Number.isFinite(start)) return { ok: false, error: 'The new start time is invalid.' };
        const result = get().updateBlock(userId, blockId, {
          startAt: new Date(start).toISOString(),
          endAt: new Date(start + duration).toISOString(),
        });
        if (result.ok) {
          set(state => {
            const record = hydratedRecord(state.users[userId]);
            const latest = record.adjustments[0];
            return latest
              ? { users: { ...state.users, [userId]: { ...record, adjustments: [{ ...latest, type: 'move' }, ...record.adjustments.slice(1)] } } }
              : state;
          });
        }
        return result;
      },

      resizeBlock: (userId, blockId, newDurationMinutes) => {
        const current = get().ensureUser(userId);
        const block = current.currentPlan?.blocks.find(item => item.id === blockId);
        if (!block) return { ok: false, error: 'The plan block was not found.' };
        if (!Number.isFinite(newDurationMinutes)) return { ok: false, error: 'The new duration is invalid.' };
        const start = new Date(block.startAt).getTime();
        const result = get().updateBlock(userId, blockId, {
          endAt: new Date(start + newDurationMinutes * MINUTE_MS).toISOString(),
        });
        if (result.ok) {
          set(state => {
            const record = hydratedRecord(state.users[userId]);
            const latest = record.adjustments[0];
            return latest
              ? { users: { ...state.users, [userId]: { ...record, adjustments: [{ ...latest, type: 'resize' }, ...record.adjustments.slice(1)] } } }
              : state;
          });
        }
        return result;
      },

      deleteBlock: (userId, blockId) => {
        const current = get().ensureUser(userId);
        const plan = current.currentPlan;
        if (!plan) return { ok: false, error: 'There is no active plan.' };
        const block = plan.blocks.find(item => item.id === blockId);
        if (!block) return { ok: false, error: 'The plan block was not found.' };
        const adjustment = createAdjustment(plan.id, block, 'delete');
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          return {
            users: {
              ...state.users,
              [userId]: {
                ...record,
                currentPlan: planWithRecalculatedTotals(plan, plan.blocks.filter(item => item.id !== blockId)),
                adjustments: [adjustment, ...record.adjustments].slice(0, MAX_ADJUSTMENTS),
              },
            },
          };
        });
        return { ok: true };
      },

      archiveCurrentPlan: (userId) => {
        const current = get().ensureUser(userId);
        if (!current.currentPlan) return { ok: false, error: 'There is no active plan.' };
        const archived = archivePlan(current.currentPlan);
        set(state => ({
          users: {
            ...state.users,
            [userId]: {
              ...hydratedRecord(state.users[userId]),
              currentPlan: null,
              history: [archived, ...current.history.filter(plan => plan.id !== archived.id)].slice(0, MAX_HISTORY),
            },
          },
        }));
        return { ok: true, value: archived };
      },

      deletePlan: (userId, planId) => {
        const current = get().ensureUser(userId);
        const exists = current.currentPlan?.id === planId || current.history.some(plan => plan.id === planId);
        if (!exists) return { ok: false, error: 'The plan was not found.' };
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          return {
            users: {
              ...state.users,
              [userId]: {
                ...record,
                currentPlan: record.currentPlan?.id === planId ? null : record.currentPlan,
                history: record.history.filter(plan => plan.id !== planId),
              },
            },
          };
        });
        return { ok: true };
      },

      addMessage: (userId, message) => {
        get().ensureUser(userId);
        const complete: PlannerChatMessage = {
          ...message,
          id: message.id || uniqueId('message'),
          createdAt: message.createdAt || new Date().toISOString(),
        };
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          return {
            users: {
              ...state.users,
              [userId]: { ...record, messages: [...record.messages, complete].slice(-MAX_MESSAGES) },
            },
          };
        });
        return complete;
      },

      clearMessages: (userId) => {
        get().ensureUser(userId);
        set(state => ({
          users: { ...state.users, [userId]: { ...hydratedRecord(state.users[userId]), messages: [] } },
        }));
      },

      cacheEstimate: (userId, entry, cacheKey) => {
        get().ensureUser(userId);
        const entityParts = entry.entityId.split(':');
        const inferredKind = entityParts[0] === 'exam'
          ? 'exam'
          : entityParts[0] === 'activity'
            ? 'activity'
            : 'task';
        const inferredId = entityParts.length > 1 ? entityParts.slice(1).join(':') : entry.entityId;
        const key = cacheKey || createEstimateCacheKey(inferredKind, inferredId, entry.contentFingerprint);
        // A content fingerprint is immutable planner evidence. Keeping the first
        // accepted estimate makes identical prompts and inputs reproduce the same
        // plan even if an AI provider returns a slightly different answer later.
        if (get().users[userId]?.estimateCache[key]) return;
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          return {
            users: {
              ...state.users,
              [userId]: { ...record, estimateCache: { ...record.estimateCache, [key]: entry } },
            },
          };
        });
      },

      removeCachedEstimate: (userId, cacheKey) => {
        get().ensureUser(userId);
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          const estimateCache = { ...record.estimateCache };
          delete estimateCache[cacheKey];
          return { users: { ...state.users, [userId]: { ...record, estimateCache } } };
        });
      },

      recordFeedback: (userId, feedback) => {
        const current = get().ensureUser(userId);
        if (feedback.blockId && current.feedback.some(item => item.blockId === feedback.blockId)) {
          return { ok: false, error: 'Timing feedback was already recorded for this block.' };
        }
        if (feedback.predictedMinutes <= 0) return { ok: false, error: 'Predicted minutes must be positive.' };
        const normalized: PlannerFeedbackRecord = {
          ...feedback,
          id: feedback.id || uniqueId('feedback'),
          createdAt: feedback.createdAt || new Date().toISOString(),
        };
        const observation = observedFeedbackRatio(normalized);
        const assignmentType = normalized.assignmentType || 'assignment';
        const kind = normalized.activityId ? 'activity' : normalized.examId ? 'exam' : 'task';
        const entityId = normalized.activityId || normalized.examId || normalized.taskId;
        const keys = entityId
          ? feedbackMultiplierKeys(kind, entityId, normalized.subjectId || null, assignmentType)
          : [normalized.subjectId ? `subject:${normalized.subjectId}:type:${assignmentType}` : '', `type:${assignmentType}`, 'global'].filter(Boolean);
        const nextMultipliers = { ...current.feedbackMultipliers };
        keys.forEach((key, index) => {
          const groupWeight = index === 0 ? observation.weight : observation.weight * 0.5;
          nextMultipliers[key] = updateMultiplier(
            nextMultipliers[key],
            key,
            observation.ratio,
            groupWeight,
            normalized.createdAt,
          );
        });
        set(state => {
          const record = hydratedRecord(state.users[userId]);
          return {
            users: {
              ...state.users,
              [userId]: {
                ...record,
                feedback: [normalized, ...record.feedback].slice(0, MAX_FEEDBACK),
                feedbackMultipliers: nextMultipliers,
              },
            },
          };
        });
        return { ok: true, value: normalized };
      },

      clearUserPlannerData: (userId) => {
        set(state => {
          const users = { ...state.users };
          delete users[userId];
          return { users, activeUserId: state.activeUserId === userId ? null : state.activeUserId };
        });
      },
    }),
    {
      name: 'orderly-planner-storage',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: state => ({ activeUserId: state.activeUserId, users: state.users }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<PlannerStoreState> | undefined;
        const users = Object.fromEntries(
          Object.entries(saved?.users || {}).map(([userId, record]) => [userId, hydratedRecord(record)]),
        );
        return { ...current, ...saved, users };
      },
    },
  ),
);

export function getPlannerUserRecord(userId: string): PlannerUserRecord {
  return usePlannerStore.getState().ensureUser(userId);
}

export function getActivePlannerRecord(state: PlannerStoreState): PlannerUserRecord | null {
  return state.activeUserId ? state.users[state.activeUserId] || null : null;
}
