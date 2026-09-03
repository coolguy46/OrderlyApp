import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  CanvasSyncInProgressError,
  CanvasSyncMigrationRequiredError,
  CanvasSyncNotEnabledError,
  syncCanvasUser,
  type CanvasSyncSetting,
} from '@/lib/integrations/canvas-server-sync';
import {
  isCanvasSyncDispatchDue,
  isCanvasSyncDue,
} from '@/lib/integrations/canvas-sync-schedule';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_USERS_PER_RUN = 9;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface BackgroundSyncBody {
  userId?: unknown;
}

async function readTargetUserId(request: NextRequest): Promise<{
  userId: string | null;
  error: string | null;
}> {
  const rawBody = await request.text();
  if (!rawBody.trim()) return { userId: null, error: null };

  let parsed: BackgroundSyncBody;
  try {
    parsed = JSON.parse(rawBody) as BackgroundSyncBody;
  } catch {
    return { userId: null, error: 'Request body must be valid JSON' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { userId: null, error: 'Request body must be a JSON object' };
  }
  if (parsed.userId === undefined || parsed.userId === null) {
    return { userId: null, error: null };
  }
  if (typeof parsed.userId !== 'string' || !UUID_PATTERN.test(parsed.userId)) {
    return { userId: null, error: 'userId must be a valid UUID' };
  }

  return { userId: parsed.userId, error: null };
}

/**
 * Called by Supabase's five-minute scheduler. The service-role key stays
 * on the server; callers must provide the separate cron secret.
 */
export async function POST(request: NextRequest) {
  const cronSecret = process.env.CANVAS_SYNC_CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: 'Background sync is not configured' }, { status: 503 });
  }

  const target = await readTargetUserId(request);
  if (target.error) {
    return NextResponse.json({ error: target.error }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const loadSettings = async (includeAttemptMarker: boolean) => {
    const columns = includeAttemptMarker
      ? 'user_id, ical_url, last_sync_at, last_background_sync_at, last_background_attempt_at, auto_sync_interval, time_zone'
      : 'user_id, ical_url, last_sync_at, last_background_sync_at, auto_sync_interval, time_zone';
    let settingsQuery = admin
      .from('canvas_settings')
      .select(columns)
      .eq('sync_enabled', true)
      .not('ical_url', 'is', null);
    if (target.userId) {
      settingsQuery = settingsQuery.eq('user_id', target.userId);
    }
    return settingsQuery;
  };

  let supportsAttemptMarker = true;
  let settingsResult = await loadSettings(true);
  // This makes deployment safe before the SQL migration is applied. The old
  // empty-body cron continues to work during the short rollout window.
  if (
    settingsResult.error?.code === '42703'
    && settingsResult.error.message.includes('last_background_attempt_at')
  ) {
    supportsAttemptMarker = false;
    settingsResult = await loadSettings(false);
  }
  const { data, error } = settingsResult;

  if (error) {
    return NextResponse.json({ error: 'Could not load Canvas settings' }, { status: 500 });
  }

  const now = new Date();
  const dueSettings = ((data || []) as unknown as CanvasSyncSetting[])
    .filter(setting => target.userId
      ? isCanvasSyncDue(setting.last_background_sync_at, setting.auto_sync_interval, now)
      : isCanvasSyncDispatchDue(
          setting.last_background_sync_at,
          setting.auto_sync_interval,
          supportsAttemptMarker ? setting.last_background_attempt_at : null,
          now
        )
    )
    .sort((left, right) => {
      const parsedLeftTime = left.last_background_sync_at
        ? new Date(left.last_background_sync_at).getTime()
        : Number.NEGATIVE_INFINITY;
      const parsedRightTime = right.last_background_sync_at
        ? new Date(right.last_background_sync_at).getTime()
        : Number.NEGATIVE_INFINITY;
      const leftTime = Number.isFinite(parsedLeftTime) ? parsedLeftTime : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(parsedRightTime) ? parsedRightTime : Number.NEGATIVE_INFINITY;
      return leftTime - rightTime;
    });
  // Production pg_cron sends one authenticated { userId } request per due
  // account, so each feed receives an independent function budget. Keep the
  // bounded bulk behavior only for the legacy empty-body cron.
  const selectedSettings = target.userId
    ? dueSettings
    : dueSettings.slice(0, MAX_USERS_PER_RUN);
  const results: Array<{
    success: boolean;
    imported?: number;
    updated?: number;
    removed?: number;
    examsImported?: number;
    examsUpdated?: number;
    orphanCleanupSkipped?: boolean;
    lastSyncAt?: string;
    lastBackgroundSyncAt?: string | null;
    busy?: boolean;
    migrationRequired?: boolean;
    skipped?: boolean;
  }> = [];

  // Small batches keep feeds moving without overwhelming Canvas or Supabase.
  for (let index = 0; index < selectedSettings.length; index += 3) {
    const batch = selectedSettings.slice(index, index + 3);
    const batchResults = await Promise.all(batch.map(async setting => {
      try {
        // The targeted pg_cron dispatcher atomically claims delivery before it
        // queues this HTTP request. syncCanvasUser separately acquires the
        // durable mutation lease shared with manual syncs. The legacy bulk
        // path has no delivery claim, so it records its attempt marker here.
        if (!target.userId && supportsAttemptMarker) {
          const { error: attemptError } = await admin
            .from('canvas_settings')
            .update({ last_background_attempt_at: new Date().toISOString() })
            .eq('user_id', setting.user_id);
          if (attemptError) {
            throw new Error(`Could not save sync attempt time: ${attemptError.message}`);
          }
        }
        const { assignments: _assignments, ...counts } = await syncCanvasUser(admin, setting, 'background');
        return { success: true, ...counts };
      } catch (syncError) {
        if (syncError instanceof CanvasSyncInProgressError) {
          return { success: false, busy: true };
        }
        if (syncError instanceof CanvasSyncMigrationRequiredError) {
          return { success: false, migrationRequired: true };
        }
        if (syncError instanceof CanvasSyncNotEnabledError) {
          return { success: false, skipped: true };
        }
        // Feed/network errors can retain the private iCal URL. Keep both user
        // identifiers and raw provider errors out of HTTP bodies and logs.
        console.error(`Canvas background sync failed (${syncError instanceof Error ? syncError.name : 'UnknownError'})`);
        return { success: false };
      }
    }));
    results.push(...batchResults);
  }

  if (results.some(result => result.migrationRequired)) {
    return NextResponse.json(
      { error: 'Canvas sync requires a database migration' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    checked: data?.length || 0,
    due: dueSettings.length,
    attempted: selectedSettings.length,
    deferred: Math.max(0, dueSettings.length - selectedSettings.length),
    synced: results.filter(result => result.success).length,
    busy: results.filter(result => result.busy).length,
    skipped: results.filter(result => result.skipped).length,
    failed: results.filter(result =>
      !result.success && !result.busy && !result.skipped
    ).length,
    imported: results.reduce((total, result) => total + (result.imported || 0), 0),
    updated: results.reduce((total, result) => total + (result.updated || 0), 0),
    removed: results.reduce((total, result) => total + (result.removed || 0), 0),
    orphanCleanupSkipped: results.some(result => result.orphanCleanupSkipped),
  });
}
