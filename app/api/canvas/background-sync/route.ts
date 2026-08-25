import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  hydrateCanvasDueDate,
  syncCanvasCalendar,
  type CanvasAssignment,
} from '@/lib/integrations/canvas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SUBJECT_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6',
  '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#06b6d4',
];

interface CanvasSyncSetting {
  user_id: string;
  ical_url: string;
  last_sync_at: string | null;
  auto_sync_interval: number | null;
  time_zone: string | null;
}

function canvasTaskChanged(
  existing: Record<string, unknown>,
  next: Record<string, unknown>
): boolean {
  return Object.entries(next).some(([key, value]) => {
    const current = existing[key];
    if (key === 'due_date' && typeof current === 'string' && typeof value === 'string') {
      return new Date(current).getTime() !== new Date(value).getTime();
    }
    return (current ?? null) !== (value ?? null);
  });
}

function syncIsDue(setting: CanvasSyncSetting, now: Date): boolean {
  if (!setting.last_sync_at) return true;
  const interval = [5, 15, 30, 60].includes(Number(setting.auto_sync_interval))
    ? Number(setting.auto_sync_interval)
    : 15;
  return now.getTime() - new Date(setting.last_sync_at).getTime() >= interval * 60_000;
}

function dueTimeFor(assignment: CanvasAssignment, dueDate: Date, timeZone: string): string | null {
  if (assignment.dueDateOnly) return '23:59';
  if (!assignment.hasDueTime) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(dueDate).map(({ type, value }) => [type, value]));
    return `${parts.hour}:${parts.minute}`;
  } catch {
    return `${String(dueDate.getUTCHours()).padStart(2, '0')}:${String(dueDate.getUTCMinutes()).padStart(2, '0')}`;
  }
}

async function syncOneUser(
  // The service-role client intentionally operates across user RLS boundaries.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  setting: CanvasSyncSetting
) {
  const assignments = await syncCanvasCalendar(setting.ical_url);
  const currentIds = assignments.map(assignment => assignment.id);

  const [{ data: existingSubjects, error: subjectError }, { data: existingTasks, error: taskError }] = await Promise.all([
    admin.from('subjects').select('id, name').eq('user_id', setting.user_id),
    admin.from('tasks').select('*').eq('user_id', setting.user_id).eq('source', 'canvas'),
  ]);

  if (subjectError) throw new Error(`Could not load subjects: ${subjectError.message}`);
  if (taskError) throw new Error(`Could not load Canvas tasks: ${taskError.message}`);

  const subjectIds = new Map<string, string>(
    (existingSubjects || []).map((subject: { id: string; name: string }) => [subject.name.toLowerCase(), subject.id])
  );
  const uniqueCourses = [...new Set(
    assignments
      .map(assignment => assignment.courseName)
      .filter(course => course && course !== 'Unknown Course')
  )];

  for (const courseName of uniqueCourses) {
    if (subjectIds.has(courseName.toLowerCase())) continue;
    const { data: created, error } = await admin
      .from('subjects')
      .insert({
        user_id: setting.user_id,
        name: courseName,
        color: SUBJECT_COLORS[subjectIds.size % SUBJECT_COLORS.length],
      })
      .select('id')
      .single();
    if (error) throw new Error(`Could not create subject: ${error.message}`);
    subjectIds.set(courseName.toLowerCase(), created.id);
  }

  const tasksByExternalId = new Map<string, Record<string, unknown>>(
    (existingTasks || [])
      .filter((task: Record<string, unknown>) => typeof task.external_id === 'string')
      .map((task: Record<string, unknown>) => [task.external_id as string, task])
  );
  let imported = 0;
  let updated = 0;
  const now = new Date();

  for (const assignment of assignments) {
    const dueDate = hydrateCanvasDueDate(assignment, setting.time_zone || 'UTC');
    if (!dueDate) continue;

    const existing = tasksByExternalId.get(assignment.id);
    if (!existing && dueDate < now) continue;

    const resolvedCourseName = assignment.courseName !== 'Unknown Course'
      ? assignment.courseName
      : typeof existing?.course_name === 'string' ? existing.course_name : null;
    const subjectId = resolvedCourseName
      ? subjectIds.get(resolvedCourseName.toLowerCase()) || existing?.subject_id || null
      : existing?.subject_id || null;
    const taskValues = {
      title: `[Canvas] ${assignment.title}`,
      description: assignment.description || `Course: ${resolvedCourseName || 'Canvas'}`,
      due_date: dueDate.toISOString(),
      due_time: dueTimeFor(assignment, dueDate, setting.time_zone || 'UTC'),
      subject_id: subjectId,
      external_url: assignment.url || null,
      course_name: resolvedCourseName,
      assignment_type: assignment.type || 'assignment',
    };

    if (existing) {
      // Canvas feeds repeat every assignment on every request. Avoid touching
      // unchanged rows so planner input fingerprints only become stale when an
      // assignment actually changes.
      if (!canvasTaskChanged(existing, taskValues)) continue;
      const { error } = await admin.from('tasks').update(taskValues).eq('id', existing.id);
      if (error) throw new Error(`Could not update Canvas task: ${error.message}`);
      updated++;
    } else {
      const { error } = await admin.from('tasks').insert({
        user_id: setting.user_id,
        ...taskValues,
        priority: assignment.type === 'exam' ? 'high' : 'medium',
        status: 'pending',
        recurrence: 'none',
        recurrence_days: null,
        completed_at: null,
        source: 'canvas',
        external_id: assignment.id,
      });
      if (error) throw new Error(`Could not import Canvas task: ${error.message}`);
      imported++;
    }
  }

  const orphanIds = (existingTasks || [])
    .filter((task: Record<string, unknown>) =>
      typeof task.external_id === 'string' && !currentIds.includes(task.external_id)
    )
    .map((task: Record<string, unknown>) => task.id as string);
  if (orphanIds.length > 0) {
    const { error } = await admin.from('tasks').delete().in('id', orphanIds);
    if (error) throw new Error(`Could not remove old Canvas tasks: ${error.message}`);
  }

  const { error: settingsError } = await admin
    .from('canvas_settings')
    .update({ last_sync_at: new Date().toISOString() })
    .eq('user_id', setting.user_id);
  if (settingsError) throw new Error(`Could not save sync time: ${settingsError.message}`);

  return { imported, updated, removed: orphanIds.length };
}

/**
 * Called by the repository's five-minute scheduler. The service-role key stays
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

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .from('canvas_settings')
    .select('user_id, ical_url, last_sync_at, auto_sync_interval, time_zone')
    .eq('sync_enabled', true)
    .not('ical_url', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const now = new Date();
  const dueSettings = ((data || []) as CanvasSyncSetting[]).filter(setting => syncIsDue(setting, now));
  const results: Array<{ userId: string; success: boolean; imported?: number; updated?: number; removed?: number; error?: string }> = [];

  // Small batches keep feeds moving without overwhelming Canvas or Supabase.
  for (let index = 0; index < dueSettings.length; index += 3) {
    const batch = dueSettings.slice(index, index + 3);
    const batchResults = await Promise.all(batch.map(async setting => {
      try {
        const counts = await syncOneUser(admin, setting);
        return { userId: setting.user_id, success: true, ...counts };
      } catch (syncError) {
        return {
          userId: setting.user_id,
          success: false,
          error: syncError instanceof Error ? syncError.message : 'Unknown sync error',
        };
      }
    }));
    results.push(...batchResults);
  }

  return NextResponse.json({
    checked: data?.length || 0,
    due: dueSettings.length,
    synced: results.filter(result => result.success).length,
    failed: results.filter(result => !result.success).length,
    results,
  });
}
