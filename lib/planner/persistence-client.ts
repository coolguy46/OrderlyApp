'use client';

import { supabase } from '@/lib/supabase/client';
import type { PlannerUserRecord } from './types';
import {
  plannerPersistencePayload,
  plannerPersistenceSnapshotFromRows,
  type PlannerPersistenceSnapshot,
} from './persistence';

function throwIfError(error: { message: string } | null): void {
  if (error) throw error;
}

export async function loadPlannerPersistenceSnapshot(userId: string): Promise<PlannerPersistenceSnapshot> {
  const [preferencesResult, commitmentsResult, plansResult, feedbackResult, adjustmentsResult] = await Promise.all([
    supabase.from('planner_preferences').select('*').eq('user_id', userId).maybeSingle(),
    supabase.from('recurring_commitments').select('*').eq('user_id', userId).order('client_commitment_id'),
    supabase.from('planner_plans').select('*').eq('user_id', userId).order('generated_at', { ascending: false }),
    supabase.from('planner_feedback').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
    supabase.from('plan_adjustments').select('*').eq('user_id', userId).order('created_at', { ascending: false }),
  ]);
  throwIfError(preferencesResult.error);
  throwIfError(commitmentsResult.error);
  throwIfError(plansResult.error);
  throwIfError(feedbackResult.error);
  throwIfError(adjustmentsResult.error);
  return plannerPersistenceSnapshotFromRows(
    userId,
    preferencesResult.data,
    commitmentsResult.data || [],
    plansResult.data || [],
    feedbackResult.data || [],
    adjustmentsResult.data || [],
  );
}

export interface PlannerPersistenceResult {
  serverRevision: number;
  /** Present when a remote-wins merge must replace the now-stale local base. */
  mergedSnapshot: PlannerPersistenceSnapshot | null;
}

async function replacePlannerSnapshot(
  userId: string,
  record: PlannerUserRecord,
  expectedRevision: number,
  reconcileDeletes: boolean,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('replace_planner_snapshot', {
    p_expected_revision: expectedRevision,
    p_snapshot: plannerPersistencePayload(userId, record),
    p_reconcile_deletes: reconcileDeletes,
  });
  throwIfError(error);
  if (data === null) return null;
  if (!Number.isSafeInteger(data) || data < 0) {
    throw new Error('Planner persistence returned an invalid server revision.');
  }
  return data;
}

/**
 * Atomically persist one account. A clean expected revision may reconcile
 * deletions. If another tab/device won the race, retry against its revision in
 * non-destructive merge mode so a stale local snapshot cannot erase its work.
 */
export async function persistPlannerUserRecord(
  userId: string,
  record: PlannerUserRecord,
  expectedRevision: number,
  reconcileDeletes = true,
): Promise<PlannerPersistenceResult> {
  const savedRevision = await replacePlannerSnapshot(
    userId,
    record,
    expectedRevision,
    reconcileDeletes,
  );
  if (savedRevision !== null) {
    const mergedSnapshot = reconcileDeletes ? null : await loadPlannerPersistenceSnapshot(userId);
    return {
      serverRevision: mergedSnapshot?.serverRevision ?? savedRevision,
      mergedSnapshot,
    };
  }

  const latest = await loadPlannerPersistenceSnapshot(userId);
  const mergedRevision = await replacePlannerSnapshot(userId, record, latest.serverRevision, false);
  if (mergedRevision === null) {
    throw new Error('Planner data changed again while resolving a concurrent update.');
  }
  const mergedSnapshot = await loadPlannerPersistenceSnapshot(userId);
  return { serverRevision: mergedSnapshot.serverRevision, mergedSnapshot };
}
