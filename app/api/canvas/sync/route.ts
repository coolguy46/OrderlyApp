import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import {
  getCanvasFeedSummary,
  syncCanvasUser,
  type CanvasSyncSetting,
} from '@/lib/integrations/canvas-server-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/canvas/sync
 * Syncs Canvas calendar from iCal URL
 */
export async function POST() {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The generated database type predates canvas_settings, so keep this query
    // localized behind a narrow runtime shape until those types are regenerated.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: setting, error: settingError } = await (sessionClient as any)
      .from('canvas_settings')
      .select('user_id, ical_url, last_sync_at, last_background_sync_at, auto_sync_interval, time_zone')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingError) {
      return NextResponse.json({ error: settingError.message }, { status: 500 });
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
    const result = await syncCanvasUser(admin, setting as CanvasSyncSetting, 'manual');

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
      lastSyncAt: result.lastSyncAt,
      lastBackgroundSyncAt: result.lastBackgroundSyncAt,
    });
  } catch (error) {
    console.error('Canvas sync error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to sync Canvas calendar',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/canvas/sync
 * Returns sync status and instructions
 */
export async function GET() {
  try {
    const sessionClient = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await sessionClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: setting, error: settingError } = await (sessionClient as any)
      .from('canvas_settings')
      .select('ical_url')
      .eq('user_id', user.id)
      .maybeSingle();

    if (settingError) {
      return NextResponse.json({ error: settingError.message }, { status: 500 });
    }
    if (!setting?.ical_url) {
      return NextResponse.json({ error: 'Canvas is not connected' }, { status: 404 });
    }

    const summary = await getCanvasFeedSummary(setting.ical_url);
    return NextResponse.json(summary);
  } catch (error) {
    console.error('Canvas feed summary error:', error);
    return NextResponse.json({ error: 'Could not load Canvas feed summary' }, { status: 500 });
  }
}
