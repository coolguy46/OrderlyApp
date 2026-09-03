import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  mergePlannerHydration,
  plannerAdjustmentInsert,
  plannerBlockInsert,
  plannerFeedbackInsert,
  plannerPersistencePayload,
  plannerPersistenceSnapshotFromRows,
  plannerPlanInsert,
  plannerPreferencesInsert,
  recurringCommitmentInsert,
} from '../lib/planner/persistence.ts';

const settings = {
  timeZone: 'America/Los_Angeles',
  horizonDays: 7,
  slotMinutes: 15,
  maxBlockMinutes: 90,
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

const block = {
  id: 'block-opaque-id',
  planId: 'plan-opaque-id',
  kind: 'requested_activity',
  sourceId: 'activity-workout',
  activityId: 'activity-workout',
  title: 'Workout',
  description: 'Strength training',
  subjectId: null,
  assignmentType: 'other',
  priority: 'medium',
  startAt: '2026-08-27T01:00:00.000Z',
  endAt: '2026-08-27T02:00:00.000Z',
  deadlineAt: '2026-08-28T06:00:00.000Z',
  estimatedMinutes: 60,
  segmentIndex: 0,
  segmentCount: 1,
  locked: false,
  status: 'planned',
};

const plan = {
  id: 'plan-opaque-id',
  userId: 'user-a',
  status: 'active',
  generatedAt: '2026-08-26T18:00:00.000Z',
  archivedAt: null,
  horizonStart: '2026-08-26T07:00:00.000Z',
  horizonEnd: '2026-09-02T07:00:00.000Z',
  prompt: 'Add a workout tomorrow',
  focusSubjects: [],
  promptTasks: [],
  requestedActivities: [{
    id: 'activity-workout',
    title: 'Workout',
    description: 'Strength training',
    minutesPerOccurrence: 60,
    recurrence: 'once',
    daysOfWeek: [],
    startOffsetDays: 1,
    durationDays: 1,
  }],
  promptCommitments: [],
  inputFingerprint: 'fingerprint',
  inputSnapshot: {
    version: 1,
    tasks: {},
    exams: {},
    commitments: {},
    settingsFingerprint: 'settings',
    estimatesFingerprint: 'estimates',
    feedbackFingerprint: 'feedback',
    fingerprint: 'fingerprint',
  },
  settings,
  blocks: [block],
  fixedIntervals: [],
  estimates: {},
  warnings: [],
  totalScheduledMinutes: 60,
  totalUnscheduledMinutes: 0,
};

const record = {
  settings,
  commitments: [{
    id: 'school-opaque-id',
    title: 'School',
    kind: 'school',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '15:30',
    timeZone: 'America/Los_Angeles',
    enabled: true,
    occurrenceOverrides: {
      '2026-08-28': { skipped: true },
    },
  }],
  currentPlan: plan,
  history: [],
  messages: [{ id: 'message-1', role: 'user', content: 'Plan this', createdAt: '2026-08-26T18:00:00.000Z' }],
  estimateCache: {},
  feedbackMultipliers: {},
  feedback: [{
    id: 'feedback-opaque-id',
    planId: plan.id,
    blockId: block.id,
    taskId: null,
    examId: null,
    activityId: block.activityId,
    subjectId: null,
    assignmentType: null,
    predictedMinutes: 60,
    actualMinutes: 75,
    timingRating: 'too_short',
    scheduleRating: 4,
    note: 'Needed a little longer',
    createdAt: '2026-08-27T02:05:00.000Z',
  }],
  adjustments: [{
    id: 'adjustment-opaque-id',
    planId: plan.id,
    blockId: block.id,
    type: 'move',
    previousStartAt: '2026-08-27T00:00:00.000Z',
    previousEndAt: '2026-08-27T01:00:00.000Z',
    newStartAt: block.startAt,
    newEndAt: block.endAt,
    createdAt: '2026-08-27T00:30:00.000Z',
  }],
};

const preferenceRow = {
  id: 'preference-db-id',
  user_id: 'user-a',
  revision: 7,
  time_zone: settings.timeZone,
  horizon_days: 7,
  slot_minutes: 15,
  max_block_minutes: 90,
  wake_time: '07:00:00',
  school_start_time: '08:00:00',
  school_home_time: '16:00:00',
  bedtime: '23:00:00',
  school_days: [1, 2, 3, 4, 5],
  weekend_available_start: '09:00:00',
  weekend_available_end: '23:00:00',
  max_daily_minutes: 240,
  min_break_minutes: 15,
  estimate_cache: {},
  feedback_multipliers: {},
  created_at: '2026-08-26T18:00:00.000Z',
  updated_at: '2026-08-26T18:00:00.000Z',
};

const commitmentRow = {
  id: 'commitment-db-uuid',
  user_id: 'user-a',
  client_commitment_id: 'school-opaque-id',
  title: 'School',
  kind: 'school',
  days_of_week: [1, 2, 3, 4, 5],
  start_time: '08:00:00',
  end_time: '15:30:00',
  start_date: null,
  end_date: null,
  time_zone: settings.timeZone,
  enabled: true,
  color: null,
  occurrence_overrides: { '2026-08-28': { skipped: true } },
  created_at: '2026-08-26T18:00:00.000Z',
  updated_at: '2026-08-26T18:00:00.000Z',
};

const planRow = {
  id: 'plan-db-uuid',
  user_id: 'user-a',
  client_plan_id: plan.id,
  status: 'active',
  generated_at: plan.generatedAt,
  archived_at: null,
  horizon_start: plan.horizonStart,
  horizon_end: plan.horizonEnd,
  prompt: plan.prompt,
  input_fingerprint: plan.inputFingerprint,
  input_snapshot: plan.inputSnapshot,
  settings_snapshot: settings,
  plan_payload: plan,
  messages: record.messages,
  warnings: [],
  total_scheduled_minutes: 60,
  total_unscheduled_minutes: 0,
  created_at: plan.generatedAt,
  updated_at: plan.generatedAt,
};

const feedbackRow = {
  id: 'feedback-db-uuid',
  user_id: 'user-a',
  client_feedback_id: 'feedback-opaque-id',
  plan_id: 'plan-db-uuid',
  client_plan_id: plan.id,
  block_id: 'block-db-uuid',
  client_block_id: block.id,
  task_id: null,
  exam_id: null,
  activity_id: block.activityId,
  subject_id: null,
  assignment_type: null,
  predicted_minutes: 60,
  actual_minutes: 75,
  timing_rating: 'too_short',
  schedule_rating: 4,
  note: 'Needed a little longer',
  created_at: '2026-08-27T02:05:00.000Z',
};

const adjustmentRow = {
  id: 'adjustment-db-uuid',
  user_id: 'user-a',
  client_adjustment_id: 'adjustment-opaque-id',
  plan_id: 'plan-db-uuid',
  client_plan_id: plan.id,
  block_id: 'block-db-uuid',
  client_block_id: block.id,
  adjustment_type: 'move',
  previous_start_at: '2026-08-27T00:00:00.000Z',
  previous_end_at: '2026-08-27T01:00:00.000Z',
  new_start_at: block.startAt,
  new_end_at: block.endAt,
  metadata: {},
  created_at: '2026-08-27T00:30:00.000Z',
};

test('planner mappings preserve opaque IDs, complete plans, activities, and occurrence overrides', () => {
  const preferenceInsert = plannerPreferencesInsert('user-a', record);
  assert.equal(preferenceInsert.user_id, 'user-a');
  assert.equal(preferenceInsert.time_zone, settings.timeZone);

  const commitmentInsert = recurringCommitmentInsert('user-a', record.commitments[0]);
  assert.equal(commitmentInsert.client_commitment_id, 'school-opaque-id');
  assert.deepEqual(commitmentInsert.occurrence_overrides, { '2026-08-28': { skipped: true } });

  const planInsert = plannerPlanInsert('user-a', plan, record.messages);
  assert.deepEqual(planInsert.plan_payload, plan);
  assert.deepEqual(planInsert.messages, record.messages);

  const blockInsert = plannerBlockInsert('user-a', 'plan-db-uuid', block);
  assert.equal(blockInsert.source_kind, 'requested_activity');
  assert.equal(blockInsert.activity_id, 'activity-workout');
  assert.equal(blockInsert.task_id, null);
  assert.equal(blockInsert.exam_id, null);

  const feedbackInsert = plannerFeedbackInsert('user-a', record.feedback[0]);
  assert.equal(feedbackInsert.client_feedback_id, 'feedback-opaque-id');
  assert.equal(feedbackInsert.client_plan_id, plan.id);
  assert.equal(feedbackInsert.activity_id, block.activityId);

  const adjustmentInsert = plannerAdjustmentInsert('user-a', record.adjustments[0]);
  assert.equal(adjustmentInsert.client_adjustment_id, 'adjustment-opaque-id');
  assert.equal(adjustmentInsert.client_plan_id, plan.id);

  const payload = plannerPersistencePayload('user-a', record);
  assert.equal(payload.preferences.user_id, 'user-a');
  assert.equal(payload.feedback[0].client_feedback_id, 'feedback-opaque-id');
  assert.equal(payload.adjustments[0].client_adjustment_id, 'adjustment-opaque-id');
  assert.equal(payload.plans[0].blocks[0].client_block_id, block.id);
});

test('planner rows hydrate per account and restore the canonical plan payload', () => {
  const snapshot = plannerPersistenceSnapshotFromRows(
    'user-a',
    preferenceRow,
    [commitmentRow, { ...commitmentRow, id: 'foreign-commitment', user_id: 'user-b' }],
    [planRow, { ...planRow, id: 'foreign-plan', user_id: 'user-b', plan_payload: { ...plan, userId: 'user-b' } }],
    [feedbackRow, { ...feedbackRow, id: 'foreign-feedback', user_id: 'user-b' }],
    [adjustmentRow, { ...adjustmentRow, id: 'foreign-adjustment', user_id: 'user-b' }],
  );

  assert.equal(snapshot.hasServerData, true);
  assert.equal(snapshot.serverRevision, 7);
  assert.equal(snapshot.settings.timeZone, settings.timeZone);
  assert.deepEqual(snapshot.commitments, [{
    ...record.commitments[0],
    startDate: null,
    endDate: null,
    color: null,
    updatedAt: commitmentRow.updated_at,
  }]);
  assert.deepEqual(snapshot.currentPlan, plan);
  assert.deepEqual(snapshot.messages, record.messages);
  assert.deepEqual(snapshot.feedback, record.feedback);
  assert.deepEqual(snapshot.adjustments, record.adjustments);
});

test('foreign rows cannot make an account look hydrated or leak planner content', () => {
  const snapshot = plannerPersistenceSnapshotFromRows(
    'user-a',
    { ...preferenceRow, user_id: 'user-b' },
    [{ ...commitmentRow, user_id: 'user-b' }],
    [{ ...planRow, user_id: 'user-b', plan_payload: { ...plan, userId: 'user-b' } }],
    [{ ...feedbackRow, user_id: 'user-b' }],
    [{ ...adjustmentRow, user_id: 'user-b' }],
  );

  assert.equal(snapshot.hasServerData, false);
  assert.equal(snapshot.settings, undefined);
  assert.deepEqual(snapshot.commitments, []);
  assert.equal(snapshot.currentPlan, null);
  assert.deepEqual(snapshot.messages, []);
  assert.equal(snapshot.serverRevision, 0);
  assert.deepEqual(snapshot.feedback, []);
  assert.deepEqual(snapshot.adjustments, []);
});

test('clean hydration uses server state while an offline outbox keeps the local planner intact', () => {
  const remote = plannerPersistenceSnapshotFromRows(
    'user-a',
    preferenceRow,
    [commitmentRow],
    [planRow],
    [feedbackRow],
    [adjustmentRow],
  );
  const local = {
    ...record,
    settings: { ...settings, bedtime: '22:00' },
    commitments: [],
  };

  const clean = mergePlannerHydration(local, remote, false);
  assert.equal(clean.settings.bedtime, '23:00');
  assert.equal(clean.commitments.length, 1);
  assert.equal(clean.currentPlan.id, plan.id);
  assert.deepEqual(clean.feedback, record.feedback);
  assert.deepEqual(clean.adjustments, record.adjustments);
  assert.equal(mergePlannerHydration(local, remote, true), local);
});

test('planner store and migration source retain durable outbox and account fences', async () => {
  const [store, client, rootStore, migration] = await Promise.all([
    readFile(new URL('../lib/planner/store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/planner/persistence-client.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/store.ts', import.meta.url), 'utf8'),
    readFile(new URL('../lib/supabase/planner-migration.sql', import.meta.url), 'utf8'),
  ]);

  assert.match(store, /pendingRevisionByUser/);
  assert.match(store, /serverRevisionByUser/);
  assert.match(store, /serverMergeRequiredByUser/);
  assert.match(store, /!before\.serverMergeRequiredByUser\[userId\]/);
  assert.match(store, /persistenceResult\.mergedSnapshot && !savedMutationIsCurrent/);
  assert.match(store, /sessionGeneration !== expectedGeneration/);
  assert.match(store, /persistedVersion < 2/);
  assert.match(client, /rpc\('replace_planner_snapshot'/);
  assert.match(client, /latest\.serverRevision, false/);
  assert.match(client, /loadPlannerPersistenceSnapshot\(userId\)/);
  assert.doesNotMatch(client, /\.from\('planner_plans'\)\.delete/);
  assert.match(rootStore, /loadPlannerPersistenceSnapshot/);
  assert.match(rootStore, /hydrateUserPlannerData/);
  assert.match(rootStore, /plannerRevisionAtStart/);
  assert.match(rootStore, /nextRevisionByUser\[requestedUserId\]/);
  assert.match(migration, /client_commitment_id TEXT/);
  assert.match(migration, /plan_payload JSONB/);
  assert.match(migration, /'requested_activity'/);
  assert.match(migration, /idx_recurring_commitments_user_client_id/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION replace_planner_snapshot/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /v_current_revision IS DISTINCT FROM p_expected_revision/);
  assert.match(migration, /p_reconcile_deletes/);
  assert.match(migration, /IF p_reconcile_deletes AND v_active_client_plan_id IS NOT NULL/);
  assert.match(migration, /IF p_reconcile_deletes OR NOT v_plan_existed/);
  assert.match(migration, /WHERE p_reconcile_deletes\s+RETURNING id INTO v_database_plan_id/);
  assert.match(migration, /IF NOT p_reconcile_deletes[\s\S]+status IN \('active', 'stale'\)[\s\S]+\{status\}[\s\S]+archived/);
  assert.match(migration, /ELSE\s+UPDATE planner_preferences\s+SET revision = v_next_revision/);
  assert.match(migration, /client_feedback_id TEXT/);
  assert.match(migration, /client_adjustment_id TEXT/);
  assert.match(migration, /Feedback is immutable learning history/);
  assert.match(migration, /Adjustments are also append-only learning history/);
  assert.doesNotMatch(migration, /DELETE FROM planner_feedback/);
  assert.doesNotMatch(migration, /DELETE FROM plan_adjustments/);
  assert.match(migration, /SECURITY INVOKER/);
});
