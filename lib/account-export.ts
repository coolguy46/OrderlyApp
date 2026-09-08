import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';

// Explicit fields prevent new credentials/internal job columns from silently
// becoming part of an account download when the database schema grows.
export const ACCOUNT_EXPORT_FIELDS = {
  profiles: 'id,email,full_name,avatar_url,total_study_time,tasks_completed,current_streak,longest_streak,created_at,updated_at',
  subjects: 'id,user_id,name,color,created_at',
  tasks: 'id,user_id,subject_id,title,description,priority,status,due_date,due_time,recurrence,recurrence_days,completed_at,created_at,updated_at,source,external_id,external_url,course_name,assignment_type,scheduled_date,scheduled_start_at,duration_seconds,schedule_recurrence_end_date,schedule_occurrence_overrides',
  goals: 'id,user_id,title,description,target_value,current_value,unit,goal_type,deadline,status,created_at,updated_at',
  exams: 'id,user_id,subject_id,title,description,exam_date,location,preparation_progress,created_at,updated_at,source,external_id',
  study_sessions: 'id,user_id,subject_id,task_id,duration_minutes,session_type,started_at,ended_at,notes,created_at',
  recurring_commitments: 'id,user_id,client_commitment_id,title,description,location,kind,days_of_week,start_time,end_time,start_date,end_date,time_zone,enabled,color,occurrence_overrides,created_at,updated_at',
  planner_preferences: 'id,user_id,revision,time_zone,horizon_days,slot_minutes,max_block_minutes,wake_time,school_start_time,school_home_time,bedtime,school_days,weekend_available_start,weekend_available_end,max_daily_minutes,min_break_minutes,estimate_cache,feedback_multipliers,created_at,updated_at',
  planner_plans: 'id,user_id,client_plan_id,status,generated_at,archived_at,horizon_start,horizon_end,prompt,input_fingerprint,input_snapshot,settings_snapshot,plan_payload,messages,warnings,total_scheduled_minutes,total_unscheduled_minutes,created_at,updated_at',
  planner_blocks: 'id,plan_id,user_id,client_block_id,source_kind,task_id,exam_id,activity_id,commitment_id,source_id_snapshot,title_snapshot,description_snapshot,subject_id,assignment_type,priority,start_at,end_at,deadline_at,estimated_minutes,segment_index,segment_count,locked,status,created_at,updated_at',
  planner_feedback: 'id,user_id,client_feedback_id,plan_id,client_plan_id,block_id,client_block_id,task_id,exam_id,activity_id,subject_id,assignment_type,predicted_minutes,actual_minutes,timing_rating,schedule_rating,note,created_at',
  plan_adjustments: 'id,user_id,client_adjustment_id,plan_id,client_plan_id,block_id,client_block_id,adjustment_type,previous_start_at,previous_end_at,new_start_at,new_end_at,metadata,created_at',
  canvas_settings: 'id,user_id,last_sync_at,last_background_sync_at,course_count,sync_enabled,auto_import_assignments,auto_sync_interval,time_zone,created_at,updated_at',
} as const;

type ExportTable = keyof typeof ACCOUNT_EXPORT_FIELDS;
type ExportRow = Record<string, unknown>;

export async function readAccountExport(
  client: SupabaseClient<Database>,
  userId: string,
  signal: AbortSignal,
) {
  const startedAt = new Date().toISOString();
  const collections = {} as Record<ExportTable, ExportRow[]>;
  let bytes = 0;
  for (const table of Object.keys(ACCOUNT_EXPORT_FIELDS) as ExportTable[]) {
    const rows: ExportRow[] = [];
    const selection: string = ACCOUNT_EXPORT_FIELDS[table];
    const fields = selection.split(',');
    const ownerField = table === 'profiles' ? 'id' : 'user_id';
    let cursor: string | null = null;
    while (true) {
      signal.throwIfAborted();
      const owned = table === 'profiles'
        ? client.from('profiles').select(selection).eq('id', userId)
        : client.from(table).select(selection).eq('user_id', userId);
      let query = owned.order('id', { ascending: true }).limit(250);
      if (cursor) query = query.gt('id', cursor);
      const { data, error }: { data: unknown; error: unknown } = await query.abortSignal(signal);
      if (error || !Array.isArray(data)) throw new Error('Account export read failed');
      if (data.length === 0) break;
      // Continue even when the database applies a lower page cap than 250.
      for (const value of data as unknown as ExportRow[]) {
        if (value[ownerField] !== userId || typeof value.id !== 'string'
          || (cursor !== null && value.id <= cursor)) {
          throw new Error('Account export ownership or pagination mismatch');
        }
        const row = Object.fromEntries(fields.map(field => [field, value[field]]));
        bytes += Buffer.byteLength(JSON.stringify(row), 'utf8');
        // Stay below the hosting response limit, and fail explicitly instead
        // of silently truncating a large account's download.
        if (bytes > 3_500_000) throw new AccountExportTooLargeError();
        rows.push(row);
        cursor = value.id;
      }
    }
    collections[table] = rows;
  }
  return {
    version: 2,
    accountId: userId,
    startedAt,
    exportedAt: new Date().toISOString(),
    description: 'Saved Orderly data read during this export. Edits made while it runs may be reflected at different times. This is not an importable backup.',
    excluded: ['Passwords and authentication tokens', 'Private Canvas calendar feed URLs', 'Internal security and job records', 'Browser-only preferences and unsaved changes'],
    profile: collections.profiles[0] ?? null,
    tasks: collections.tasks,
    goals: collections.goals,
    exams: collections.exams,
    studySessions: collections.study_sessions,
    subjects: collections.subjects,
    events: collections.recurring_commitments,
    plannerPreferences: collections.planner_preferences,
    plans: collections.planner_plans,
    scheduleBlocks: collections.planner_blocks,
    plannerFeedback: collections.planner_feedback,
    planAdjustments: collections.plan_adjustments,
    canvasSettings: collections.canvas_settings,
  };
}

export class AccountExportTooLargeError extends Error {
  constructor() {
    super('Your saved data is too large for a single download. No partial export was created.');
    this.name = 'AccountExportTooLargeError';
  }
}
