import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  CanvasSyncInProgressError,
  CanvasSyncMigrationRequiredError,
  syncCanvasUser,
  type CanvasSyncSetting,
} from '@/lib/integrations/canvas-server-sync';
import {
  isCanvasProviderThrottleMigrationError,
  parseCanvasProviderRequestClaim,
} from '@/lib/integrations/canvas-provider-request';
import {
  CANVAS_MANUAL_SYNC_SERVER_DEADLINE_MS,
  CANVAS_SYNC_TIMEOUT_MESSAGE,
  CanvasOperationTimeoutError,
  withCanvasDeadline,
} from '@/lib/integrations/canvas-sync-reliability';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** POST /api/canvas/sync — sync the signed-in user's Canvas calendar. */
export async function POST() {
  try {
    return await withCanvasDeadline(async () => {
      const sessionClient = await createSupabaseServerClient();
      const { data: { user }, error: authError } = await sessionClient.auth.getUser();
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { data: setting, error: settingError } = await sessionClient
        .from('canvas_settings')
        .select('user_id, ical_url, last_sync_at, last_background_sync_at, auto_sync_interval, time_zone')
        .eq('user_id', user.id)
        .maybeSingle();

      if (settingError) {
        return NextResponse.json({ error: 'Could not load Canvas settings' }, { status: 500 });
      }
      if (!setting?.ical_url) {
        return NextResponse.json({ error: 'Connect a Canvas calendar before syncing' }, { status: 400 });
      }

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceRoleKey) {
        return NextResponse.json({ error: 'Canvas sync is not configured' }, { status: 503 });
      }

      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: claimData, error: claimError } = await sessionClient.rpc(
        'claim_canvas_provider_request',
        { requested_kind: 'manual_sync' },
      );
      if (claimError) {
        if (isCanvasProviderThrottleMigrationError(claimError)) {
          throw new CanvasSyncMigrationRequiredError();
        }
        return NextResponse.json(
          { error: 'Canvas sync is temporarily unavailable' },
          { status: 503 },
        );
      }

      let claim;
      try {
        claim = parseCanvasProviderRequestClaim(claimData);
      } catch {
        return NextResponse.json(
          { error: 'Canvas sync is temporarily unavailable' },
          { status: 503 },
        );
      }
      if (!claim.token) {
        return NextResponse.json(
          { error: 'Please wait before starting another Canvas sync.' },
          {
            status: 429,
            headers: { 'Retry-After': String(claim.retryAfterSeconds) },
          },
        );
      }

      let result: Awaited<ReturnType<typeof syncCanvasUser>>;
      try {
        result = await syncCanvasUser(admin, setting as CanvasSyncSetting, 'manual');
      } finally {
        const { error: releaseError } = await sessionClient.rpc(
          'release_canvas_provider_request',
          {
            requested_kind: 'manual_sync',
            expected_claim_token: claim.token,
          },
        );
        if (releaseError) {
          // The token-fenced guard expires automatically; do not turn a
          // successful import into a failure because cleanup was delayed.
          console.error('Canvas manual-sync throttle release failed');
        }
      }

      return NextResponse.json({
        success: true,
        count: result.assignments.length,
        assignments: result.assignments,
        imported: result.imported,
        updated: result.updated,
        removed: result.removed,
        examsImported: result.examsImported,
        examsUpdated: result.examsUpdated,
        orphanCleanupSkipped: result.orphanCleanupSkipped,
        courseCount: result.courseCount,
        lastSyncAt: result.lastSyncAt,
        lastBackgroundSyncAt: result.lastBackgroundSyncAt,
      });
    }, CANVAS_MANUAL_SYNC_SERVER_DEADLINE_MS, CANVAS_SYNC_TIMEOUT_MESSAGE);
  } catch (error) {
    if (
      error instanceof CanvasOperationTimeoutError
      || (error instanceof Error && error.message.toLowerCase().includes('timed out'))
    ) {
      return NextResponse.json(
        {
          error: error instanceof CanvasOperationTimeoutError
            ? error.message
            : 'Canvas did not respond in time. Check the calendar feed and try again.',
        },
        { status: 504, headers: { 'Retry-After': '60' } },
      );
    }
    if (error instanceof CanvasSyncInProgressError) {
      return NextResponse.json(
        { error: 'A Canvas sync is already in progress. Try again shortly.' },
        { status: 409, headers: { 'Retry-After': '15' } },
      );
    }
    if (error instanceof CanvasSyncMigrationRequiredError) {
      return NextResponse.json(
        { error: 'Canvas sync requires a database migration' },
        { status: 503 },
      );
    }

    // Network errors can retain the private feed URL in nested metadata.
    console.error(`Canvas sync failed (${error instanceof Error ? error.name : 'UnknownError'})`);
    return NextResponse.json(
      { error: 'Failed to sync Canvas calendar' },
      { status: 500 },
    );
  }
}

/** GET /api/canvas/sync — return the persisted Canvas course count. */
export async function GET() {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: setting, error: settingError } = await sessionClient
      .from('canvas_settings')
      .select('ical_url, course_count')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingError) {
      if (isCanvasProviderThrottleMigrationError(settingError)) {
        return NextResponse.json(
          { error: 'Canvas sync requires a database migration' },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: 'Could not load Canvas settings' }, { status: 500 });
    }
    if (!setting?.ical_url) {
      return NextResponse.json({ error: 'Canvas is not connected' }, { status: 404 });
    }

    const courseCount = Number(setting.course_count);
    if (!Number.isInteger(courseCount) || courseCount < 0) {
      return NextResponse.json({ error: 'Could not load Canvas feed summary' }, { status: 500 });
    }
    return NextResponse.json({ courses: courseCount });
  } catch (error) {
    console.error(`Canvas feed summary failed (${error instanceof Error ? error.name : 'UnknownError'})`);
    return NextResponse.json({ error: 'Could not load Canvas feed summary' }, { status: 500 });
  }
}
