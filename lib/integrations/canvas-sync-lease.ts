export interface CanvasSyncLease {
  token: string;
  revision: number;
}

interface PostgrestErrorLike {
  code?: unknown;
  message?: unknown;
}

/**
 * Supabase may return a table-valued RPC as either one row or a one-row array,
 * depending on whether the caller added a singular response transform.
 */
export function parseCanvasSyncLease(payload: unknown): CanvasSyncLease | null {
  const value = Array.isArray(payload) ? payload[0] : payload;
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new Error('Canvas sync lease response was invalid');

  const row = value as Record<string, unknown>;
  const token = row.lease_token;
  const revision = Number(row.sync_revision);
  if (
    typeof token !== 'string'
    || token.length === 0
    || !Number.isSafeInteger(revision)
    || revision < 1
  ) {
    throw new Error('Canvas sync lease response was invalid');
  }

  return { token, revision };
}

/** PostgREST codes used when the tracked lease migration is not installed. */
export function isCanvasSyncLeaseMigrationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as PostgrestErrorLike;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  if (code === '42883' || code === 'PGRST202') return true;

  const message = typeof candidate.message === 'string'
    ? candidate.message.toLowerCase()
    : '';
  return message.includes('claim_canvas_sync')
    || message.includes('renew_canvas_sync_lease')
    || message.includes('complete_canvas_sync')
    || message.includes('release_canvas_sync_lease');
}
