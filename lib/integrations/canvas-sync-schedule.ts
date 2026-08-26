export const CANVAS_SYNC_INTERVALS = [5, 15, 30, 60] as const;

export type CanvasSyncInterval = (typeof CANVAS_SYNC_INTERVALS)[number];

const DEFAULT_INTERVAL: CanvasSyncInterval = 15;
// Supabase Cron runs on five-minute boundaries, while last_sync_at is written
// after the previous HTTP request completes. Without a small allowance, a
// request that finishes a few milliseconds after a boundary is skipped at the
// next boundary and a five-minute preference effectively becomes ten minutes.
const CRON_JITTER_TOLERANCE_MS = 60_000;
const DISPATCH_RETRY_INTERVAL_MINUTES = 5;

export function normalizeCanvasSyncInterval(value: unknown): CanvasSyncInterval {
  const interval = Number(value);
  return CANVAS_SYNC_INTERVALS.includes(interval as CanvasSyncInterval)
    ? interval as CanvasSyncInterval
    : DEFAULT_INTERVAL;
}

export function isCanvasSyncDue(
  lastSyncAt: string | null | undefined,
  intervalValue: unknown,
  now: Date = new Date()
): boolean {
  if (!lastSyncAt) return true;

  const lastSyncTime = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(lastSyncTime)) return true;

  const intervalMs = normalizeCanvasSyncInterval(intervalValue) * 60_000;
  const elapsedMs = now.getTime() - lastSyncTime;
  if (elapsedMs < 0) return false;

  return elapsedMs + CRON_JITTER_TOLERANCE_MS >= intervalMs;
}

/**
 * The success marker controls the user's requested cadence. The attempt marker
 * only prevents the scheduler from launching the same user more than once on
 * a five-minute cron boundary. A failed sync is therefore retried at the next
 * boundary instead of waiting for the user's longer success interval.
 */
export function isCanvasSyncDispatchDue(
  lastBackgroundSyncAt: string | null | undefined,
  intervalValue: unknown,
  lastBackgroundAttemptAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  return isCanvasSyncDue(lastBackgroundSyncAt, intervalValue, now)
    && isCanvasSyncDue(lastBackgroundAttemptAt, DISPATCH_RETRY_INTERVAL_MINUTES, now);
}
