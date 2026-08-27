import type { SupabaseClient } from '@supabase/supabase-js';

export const ACCOUNT_DELETION_BUCKETS = ['study-materials'] as const;

const STORAGE_LIST_LIMIT = 100;
const DEFAULT_MAX_LIST_CALLS = 24;
const DEFAULT_MAX_REMOVE_CALLS = 8;
const DEFAULT_MAX_OBJECTS = 500;

type AccountDeletionPhase = 'storage' | 'auth' | 'completed';
type AccountDeletionStatus = 'queued' | 'processing' | 'retry' | 'completed';

export interface AccountDeletionRequest {
  user_id: string;
  phase: AccountDeletionPhase;
  status: AccountDeletionStatus;
  attempts: number;
  lease_token: string;
}

interface StorageEntry {
  id?: string | null;
  name: string;
}

interface StorageError {
  message?: string;
  status?: number;
  statusCode?: string;
}

export interface StorageBucket {
  list(
    path: string,
    options: {
      limit: number;
      offset: number;
      sortBy: { column: 'name'; order: 'asc' };
    },
  ): Promise<{ data: StorageEntry[] | null; error: StorageError | null }>;
  remove(paths: string[]): Promise<{ error: StorageError | null }>;
}

export interface StorageClient {
  from(bucket: string): StorageBucket;
}

export interface StorageCleanupOptions {
  maxListCalls?: number;
  maxRemoveCalls?: number;
  maxObjects?: number;
}

export interface StorageCleanupResult {
  complete: boolean;
  removed: number;
  listCalls: number;
  removeCalls: number;
}

export interface AccountDeletionProgress {
  completed: boolean;
  phase: AccountDeletionPhase;
  removed: number;
  retryScheduled: boolean;
}

function isMissingBucketError(error: StorageError) {
  const message = error.message?.toLowerCase() ?? '';
  return error.status === 404
    || error.statusCode === '404'
    || message.includes('bucket not found')
    || message.includes('does not exist');
}

export function isMissingAuthUserError(error: {
  message?: string;
  status?: number;
  code?: string;
}) {
  const message = error.message?.toLowerCase() ?? '';
  return error.status === 404
    || error.code === 'user_not_found'
    || message.includes('user not found');
}

function normalizedLimit(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && (value ?? 0) > 0 ? value as number : fallback;
}

/**
 * Deletes a bounded amount of one user's Storage namespace. Every list call
 * deliberately uses offset zero: deleting objects shifts later pages, so an
 * increasing offset can permanently skip objects. A future invocation simply
 * starts over and continues until the namespace is empty.
 */
export async function cleanupAccountStorage(
  storage: StorageClient,
  userId: string,
  buckets: readonly string[] = ACCOUNT_DELETION_BUCKETS,
  options: StorageCleanupOptions = {},
): Promise<StorageCleanupResult> {
  const maxListCalls = normalizedLimit(options.maxListCalls, DEFAULT_MAX_LIST_CALLS);
  const maxRemoveCalls = normalizedLimit(options.maxRemoveCalls, DEFAULT_MAX_REMOVE_CALLS);
  const maxObjects = normalizedLimit(options.maxObjects, DEFAULT_MAX_OBJECTS);
  let listCalls = 0;
  let removeCalls = 0;
  let removed = 0;

  const scanForBatch = async (
    bucket: StorageBucket,
    prefix: string,
    paths: string[],
    depth: number,
  ): Promise<'complete' | 'budget' | 'missing-bucket'> => {
    if (listCalls >= maxListCalls || paths.length >= STORAGE_LIST_LIMIT) return 'budget';
    if (depth > 64) throw new Error('storage-directory-depth-exceeded');

    listCalls += 1;
    const { data, error } = await bucket.list(prefix, {
      limit: STORAGE_LIST_LIMIT,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      if (isMissingBucketError(error)) return 'missing-bucket';
      throw new Error('storage-list-failed');
    }

    for (const entry of data ?? []) {
      if (paths.length >= STORAGE_LIST_LIMIT) return 'budget';
      const path = `${prefix}/${entry.name}`;
      if (entry.id) {
        paths.push(path);
      } else {
        if (listCalls >= maxListCalls) return 'budget';
        const childResult = await scanForBatch(bucket, path, paths, depth + 1);
        if (childResult !== 'complete') return childResult;
      }
    }
    return 'complete';
  };

  for (const bucketName of buckets) {
    const bucket = storage.from(bucketName);
    while (
      listCalls < maxListCalls
      && removeCalls < maxRemoveCalls
      && removed < maxObjects
    ) {
      const paths: string[] = [];
      const scanResult = await scanForBatch(bucket, userId, paths, 0);
      if (scanResult === 'missing-bucket') break;

      if (paths.length === 0) {
        if (scanResult === 'complete') break;
        return { complete: false, removed, listCalls, removeCalls };
      }

      const remainingObjectBudget = maxObjects - removed;
      const batch = paths.slice(0, Math.min(STORAGE_LIST_LIMIT, remainingObjectBudget));
      if (batch.length === 0 || removeCalls >= maxRemoveCalls) {
        return { complete: false, removed, listCalls, removeCalls };
      }
      const { error } = await bucket.remove(batch);
      removeCalls += 1;
      if (error && !isMissingBucketError(error)) throw new Error('storage-remove-failed');
      removed += batch.length;
      // Rescan this namespace from offset zero. Never increment an offset after
      // deletion because the remaining rows have shifted toward the first page.
    }

    if (
      listCalls >= maxListCalls
      || removeCalls >= maxRemoveCalls
      || removed >= maxObjects
    ) {
      return { complete: false, removed, listCalls, removeCalls };
    }
  }

  return { complete: true, removed, listCalls, removeCalls };
}

export async function claimAccountDeletionRequests(
  admin: SupabaseClient,
  limit: number,
  userId: string | null = null,
): Promise<AccountDeletionRequest[]> {
  const { data, error } = await admin.rpc('claim_account_deletion_requests', {
    request_limit: Math.max(1, Math.min(5, Math.trunc(limit))),
    requested_user_id: userId,
  });
  if (error) throw new Error('account-deletion-claim-failed');
  return (data ?? []) as AccountDeletionRequest[];
}

async function updateClaimedRequest(
  admin: SupabaseClient,
  request: AccountDeletionRequest,
  values: Record<string, unknown>,
) {
  const { data, error } = await admin
    .from('account_deletion_requests')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('user_id', request.user_id)
    .eq('lease_token', request.lease_token)
    .select('user_id')
    .maybeSingle();
  if (error || !data) throw new Error('account-deletion-state-update-failed');
}

function retryAt(attempts: number) {
  const delayMinutes = Math.min(60, Math.max(1, 2 ** Math.min(6, attempts - 1)));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

async function scheduleRetry(
  admin: SupabaseClient,
  request: AccountDeletionRequest,
  phase: Exclude<AccountDeletionPhase, 'completed'>,
  errorCode: string | null,
) {
  await updateClaimedRequest(admin, request, {
    phase,
    status: errorCode ? 'retry' : 'queued',
    last_error: errorCode,
    next_attempt_at: errorCode ? retryAt(request.attempts) : new Date().toISOString(),
    lease_token: null,
    lease_expires_at: null,
  });
}

export async function processAccountDeletionRequest(
  admin: SupabaseClient,
  request: AccountDeletionRequest,
): Promise<AccountDeletionProgress> {
  let removed = 0;
  let phase = request.phase;

  if (phase === 'storage') {
    try {
      const cleanup = await cleanupAccountStorage(admin.storage, request.user_id);
      removed = cleanup.removed;
      if (!cleanup.complete) {
        await scheduleRetry(admin, request, 'storage', null);
        return { completed: false, phase: 'storage', removed, retryScheduled: true };
      }
      // Persist the next phase before deleting the Auth identity. If this write
      // fails, the lease expires and a later worker safely repeats cleanup.
      await updateClaimedRequest(admin, request, {
        phase: 'auth',
        status: 'processing',
        last_error: null,
      });
      phase = 'auth';
    } catch (error) {
      const code = error instanceof Error ? error.message : 'storage-cleanup-failed';
      await scheduleRetry(admin, request, 'storage', code);
      return { completed: false, phase: 'storage', removed, retryScheduled: true };
    }
  }

  if (phase === 'auth') {
    const { error } = await admin.auth.admin.deleteUser(request.user_id);
    if (error && !isMissingAuthUserError(error)) {
      await scheduleRetry(admin, request, 'auth', 'auth-delete-failed');
      return { completed: false, phase: 'auth', removed, retryScheduled: true };
    }

    // If this final write fails, the durable row remains in the Auth phase. A
    // later retry treats the now-missing Auth user as success and completes it.
    await updateClaimedRequest(admin, request, {
      phase: 'completed',
      status: 'completed',
      last_error: null,
      next_attempt_at: null,
      lease_token: null,
      lease_expires_at: null,
      completed_at: new Date().toISOString(),
    });
    return { completed: true, phase: 'completed', removed, retryScheduled: false };
  }

  return { completed: true, phase: 'completed', removed, retryScheduled: false };
}
