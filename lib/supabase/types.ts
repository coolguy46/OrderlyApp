export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TablesWithNoDeclaredRelationships<T extends Record<string, object>> = {
  [K in keyof T]: T[K] & { Relationships: [] };
};

export interface Database {
  public: {
    Tables: TablesWithNoDeclaredRelationships<{
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          total_study_time: number;
          tasks_completed: number;
          /** Legacy compatibility value; not maintained by the current release. */
          current_streak: number;
          /** Legacy compatibility value; not maintained by the current release. */
          longest_streak: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          avatar_url?: string | null;
          total_study_time?: number;
          tasks_completed?: number;
          current_streak?: number;
          longest_streak?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          full_name?: string | null;
          avatar_url?: string | null;
          total_study_time?: number;
          tasks_completed?: number;
          current_streak?: number;
          longest_streak?: number;
          updated_at?: string;
        };
      };
      subjects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          color?: string;
        };
      };
      tasks: {
        Row: {
          id: string;
          user_id: string;
          subject_id: string | null;
          title: string;
          description: string | null;
          priority: 'high' | 'medium' | 'low';
          status: 'pending' | 'in_progress' | 'completed';
          due_date: string | null;
          due_time: string | null;
          recurrence: 'none' | 'daily' | 'weekly' | 'monthly';
          recurrence_days: number[] | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
          // Canvas integration fields
          source?: 'manual' | 'google_classroom' | 'canvas';
          external_id?: string | null;
          external_url?: string | null;
          course_name?: string | null;
          assignment_type?: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          scheduled_date?: string | null;
          scheduled_start_at?: string | null;
          duration_seconds?: number | null;
          schedule_recurrence_end_date?: string | null;
          schedule_occurrence_overrides?: Json;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id?: string | null;
          title: string;
          description?: string | null;
          priority?: 'high' | 'medium' | 'low';
          status?: 'pending' | 'in_progress' | 'completed';
          due_date?: string | null;
          due_time?: string | null;
          recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
          recurrence_days?: number[] | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
          // Canvas integration fields
          source?: 'manual' | 'google_classroom' | 'canvas';
          external_id?: string | null;
          external_url?: string | null;
          course_name?: string | null;
          assignment_type?: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          scheduled_date?: string | null;
          scheduled_start_at?: string | null;
          duration_seconds?: number | null;
          schedule_recurrence_end_date?: string | null;
          schedule_occurrence_overrides?: Json;
        };
        Update: {
          subject_id?: string | null;
          title?: string;
          description?: string | null;
          priority?: 'high' | 'medium' | 'low';
          status?: 'pending' | 'in_progress' | 'completed';
          due_date?: string | null;
          due_time?: string | null;
          recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
          recurrence_days?: number[] | null;
          completed_at?: string | null;
          updated_at?: string;
          source?: 'manual' | 'google_classroom' | 'canvas';
          external_id?: string | null;
          external_url?: string | null;
          course_name?: string | null;
          assignment_type?: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          scheduled_date?: string | null;
          scheduled_start_at?: string | null;
          duration_seconds?: number | null;
          schedule_recurrence_end_date?: string | null;
          schedule_occurrence_overrides?: Json;
        };
      };
      goals: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          target_value: number;
          current_value: number;
          unit: string;
          goal_type: 'short_term' | 'long_term';
          deadline: string | null;
          status: 'active' | 'completed' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          title: string;
          description?: string | null;
          target_value: number;
          current_value?: number;
          unit: string;
          goal_type?: 'short_term' | 'long_term';
          deadline?: string | null;
          status?: 'active' | 'completed' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          title?: string;
          description?: string | null;
          target_value?: number;
          current_value?: number;
          unit?: string;
          goal_type?: 'short_term' | 'long_term';
          deadline?: string | null;
          status?: 'active' | 'completed' | 'cancelled';
          updated_at?: string;
        };
      };
      study_sessions: {
        Row: {
          id: string;
          user_id: string;
          subject_id: string | null;
          task_id: string | null;
          duration_minutes: number;
          session_type: 'pomodoro' | 'free_study';
          started_at: string;
          ended_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id?: string | null;
          task_id?: string | null;
          duration_minutes: number;
          session_type?: 'pomodoro' | 'free_study';
          started_at: string;
          ended_at?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          subject_id?: string | null;
          task_id?: string | null;
          duration_minutes?: number;
          session_type?: 'pomodoro' | 'free_study';
          ended_at?: string | null;
          notes?: string | null;
        };
      };
      exams: {
        Row: {
          id: string;
          user_id: string;
          subject_id: string | null;
          title: string;
          description: string | null;
          exam_date: string;
          location: string | null;
          preparation_progress: number;
          created_at: string;
          updated_at: string;
          source: 'manual' | 'google_classroom' | 'canvas';
          external_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id?: string | null;
          title: string;
          description?: string | null;
          exam_date: string;
          location?: string | null;
          preparation_progress?: number;
          created_at?: string;
          updated_at?: string;
          source?: 'manual' | 'google_classroom' | 'canvas';
          external_id?: string | null;
        };
        Update: {
          subject_id?: string | null;
          title?: string;
          description?: string | null;
          exam_date?: string;
          location?: string | null;
          preparation_progress?: number;
          updated_at?: string;
          source?: 'manual' | 'google_classroom' | 'canvas';
          external_id?: string | null;
        };
      };
      friendships: {
        Row: {
          id: string;
          user_id: string;
          friend_id: string;
          status: 'pending' | 'accepted' | 'rejected';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          friend_id: string;
          status?: 'pending' | 'accepted' | 'rejected';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          status?: 'pending' | 'accepted' | 'rejected';
          updated_at?: string;
        };
      };
      competitions: {
        Row: {
          id: string;
          creator_id: string;
          title: string;
          description: string | null;
          competition_type: 'study_time' | 'tasks_completed' | 'streak';
          start_date: string;
          end_date: string;
          status: 'active' | 'completed';
          created_at: string;
        };
        Insert: {
          id?: string;
          creator_id: string;
          title: string;
          description?: string | null;
          competition_type: 'study_time' | 'tasks_completed' | 'streak';
          start_date: string;
          end_date: string;
          status?: 'active' | 'completed';
          created_at?: string;
        };
        Update: {
          title?: string;
          description?: string | null;
          status?: 'active' | 'completed';
        };
      };
      competition_participants: {
        Row: {
          id: string;
          competition_id: string;
          user_id: string;
          score: number;
          joined_at: string;
        };
        Insert: {
          id?: string;
          competition_id: string;
          user_id: string;
          score?: number;
          joined_at?: string;
        };
        Update: {
          score?: number;
        };
      };
      achievements: {
        Row: {
          id: string;
          user_id: string;
          achievement_type: string;
          title: string;
          description: string;
          unlocked_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          achievement_type: string;
          title: string;
          description: string;
          unlocked_at?: string;
        };
        Update: {};
      };
      canvas_settings: {
        Row: {
          id: string;
          user_id: string;
          ical_url: string;
          last_sync_at: string | null;
          last_background_sync_at: string | null;
          last_background_attempt_at: string | null;
          course_count: number;
          sync_lease_token: string | null;
          sync_lease_expires_at: string | null;
          sync_revision: number;
          sync_enabled: boolean;
          auto_import_assignments: boolean;
          auto_sync_interval: number;
          time_zone: string;
          sync_interval_migrated: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          ical_url: string;
          last_sync_at?: string | null;
          last_background_sync_at?: string | null;
          last_background_attempt_at?: string | null;
          course_count?: number;
          sync_lease_token?: string | null;
          sync_lease_expires_at?: string | null;
          sync_revision?: number;
          sync_enabled?: boolean;
          auto_import_assignments?: boolean;
          auto_sync_interval?: number;
          time_zone?: string;
          sync_interval_migrated?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['canvas_settings']['Insert']>;
      };
      canvas_provider_request_limits: {
        Row: {
          user_id: string;
          validation_last_started_at: string | null;
          validation_claim_token: string | null;
          validation_claim_expires_at: string | null;
          manual_sync_last_started_at: string | null;
          manual_sync_claim_token: string | null;
          manual_sync_claim_expires_at: string | null;
        };
        Insert: {
          user_id: string;
          validation_last_started_at?: string | null;
          validation_claim_token?: string | null;
          validation_claim_expires_at?: string | null;
          manual_sync_last_started_at?: string | null;
          manual_sync_claim_token?: string | null;
          manual_sync_claim_expires_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['canvas_provider_request_limits']['Insert']>;
      };
      timer_states: {
        Row: {
          id: string;
          user_id: string;
          timer_type: 'pomodoro' | 'stopwatch';
          mode: 'focus' | 'shortBreak' | 'longBreak';
          is_running: boolean;
          pomodoro_started_at: string | null;
          stopwatch_started_at: string | null;
          time_left: number;
          stopwatch_time: number;
          subject_id: string | null;
          sessions_completed: number;
          sound_enabled: boolean;
          pomodoro_started: boolean;
          stopwatch_started: boolean;
          pending_session: Json | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          timer_type?: 'pomodoro' | 'stopwatch';
          mode?: 'focus' | 'shortBreak' | 'longBreak';
          is_running?: boolean;
          pomodoro_started_at?: string | null;
          stopwatch_started_at?: string | null;
          time_left?: number;
          stopwatch_time?: number;
          subject_id?: string | null;
          sessions_completed?: number;
          sound_enabled?: boolean;
          pomodoro_started?: boolean;
          stopwatch_started?: boolean;
          pending_session?: Json | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['timer_states']['Insert']>;
      };
      planner_preferences: {
        Row: {
          id: string;
          user_id: string;
          revision: number;
          time_zone: string;
          horizon_days: number;
          slot_minutes: 15;
          max_block_minutes: number;
          wake_time: string;
          school_start_time: string;
          school_home_time: string;
          bedtime: string;
          school_days: number[];
          weekend_available_start: string;
          weekend_available_end: string;
          max_daily_minutes: number;
          min_break_minutes: number;
          estimate_cache: Json;
          feedback_multipliers: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          revision?: number;
          time_zone?: string;
          horizon_days?: number;
          slot_minutes?: 15;
          max_block_minutes?: number;
          wake_time?: string;
          school_start_time?: string;
          school_home_time?: string;
          bedtime?: string;
          school_days?: number[];
          weekend_available_start?: string;
          weekend_available_end?: string;
          max_daily_minutes?: number;
          min_break_minutes?: number;
          estimate_cache?: Json;
          feedback_multipliers?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['planner_preferences']['Insert']>;
      };
      recurring_commitments: {
        Row: {
          id: string;
          user_id: string;
          client_commitment_id: string;
          title: string;
          kind: 'class' | 'school' | 'sports' | 'work' | 'appointment' | 'personal' | 'other';
          days_of_week: number[];
          start_time: string;
          end_time: string;
          start_date: string | null;
          end_date: string | null;
          time_zone: string;
          enabled: boolean;
          color: string | null;
          occurrence_overrides: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_commitment_id: string;
          title: string;
          kind?: 'class' | 'school' | 'sports' | 'work' | 'appointment' | 'personal' | 'other';
          days_of_week: number[];
          start_time: string;
          end_time: string;
          start_date?: string | null;
          end_date?: string | null;
          time_zone?: string;
          enabled?: boolean;
          color?: string | null;
          occurrence_overrides?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['recurring_commitments']['Insert']>;
      };
      planner_plans: {
        Row: {
          id: string;
          user_id: string;
          client_plan_id: string;
          status: 'active' | 'stale' | 'archived';
          generated_at: string;
          archived_at: string | null;
          horizon_start: string;
          horizon_end: string;
          prompt: string | null;
          input_fingerprint: string;
          input_snapshot: Json;
          settings_snapshot: Json;
          plan_payload: Json;
          messages: Json;
          warnings: Json;
          total_scheduled_minutes: number;
          total_unscheduled_minutes: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_plan_id: string;
          status?: 'active' | 'stale' | 'archived';
          generated_at?: string;
          archived_at?: string | null;
          horizon_start: string;
          horizon_end: string;
          prompt?: string | null;
          input_fingerprint: string;
          input_snapshot?: Json;
          settings_snapshot?: Json;
          plan_payload?: Json;
          messages?: Json;
          warnings?: Json;
          total_scheduled_minutes?: number;
          total_unscheduled_minutes?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['planner_plans']['Insert']>;
      };
      planner_blocks: {
        Row: {
          id: string;
          plan_id: string;
          user_id: string;
          client_block_id: string;
          source_kind: 'task' | 'exam_prep' | 'requested_activity';
          task_id: string | null;
          exam_id: string | null;
          activity_id: string | null;
          commitment_id: string | null;
          source_id_snapshot: string;
          title_snapshot: string;
          description_snapshot: string | null;
          subject_id: string | null;
          assignment_type: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          priority: 'high' | 'medium' | 'low';
          start_at: string;
          end_at: string;
          deadline_at: string;
          estimated_minutes: number;
          segment_index: number;
          segment_count: number;
          locked: boolean;
          status: 'planned' | 'completed' | 'skipped';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          plan_id: string;
          user_id: string;
          client_block_id: string;
          source_kind: 'task' | 'exam_prep' | 'requested_activity';
          task_id?: string | null;
          exam_id?: string | null;
          activity_id?: string | null;
          commitment_id?: string | null;
          source_id_snapshot: string;
          title_snapshot: string;
          description_snapshot?: string | null;
          subject_id?: string | null;
          assignment_type?: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          priority?: 'high' | 'medium' | 'low';
          start_at: string;
          end_at: string;
          deadline_at: string;
          estimated_minutes: number;
          segment_index?: number;
          segment_count?: number;
          locked?: boolean;
          status?: 'planned' | 'completed' | 'skipped';
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['planner_blocks']['Insert']>;
      };
      planner_feedback: {
        Row: {
          id: string;
          user_id: string;
          client_feedback_id: string;
          plan_id: string | null;
          client_plan_id: string | null;
          block_id: string | null;
          client_block_id: string | null;
          task_id: string | null;
          exam_id: string | null;
          activity_id: string | null;
          subject_id: string | null;
          assignment_type: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          predicted_minutes: number;
          actual_minutes: number | null;
          timing_rating: 'too_short' | 'accurate' | 'too_long';
          schedule_rating: number | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_feedback_id: string;
          plan_id?: string | null;
          client_plan_id?: string | null;
          block_id?: string | null;
          client_block_id?: string | null;
          task_id?: string | null;
          exam_id?: string | null;
          activity_id?: string | null;
          subject_id?: string | null;
          assignment_type?: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'project' | 'other' | null;
          predicted_minutes: number;
          actual_minutes?: number | null;
          timing_rating: 'too_short' | 'accurate' | 'too_long';
          schedule_rating?: number | null;
          note?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['planner_feedback']['Insert']>;
      };
      plan_adjustments: {
        Row: {
          id: string;
          user_id: string;
          client_adjustment_id: string;
          plan_id: string | null;
          client_plan_id: string;
          block_id: string | null;
          client_block_id: string | null;
          adjustment_type: 'move' | 'resize' | 'delete' | 'edit';
          previous_start_at: string | null;
          previous_end_at: string | null;
          new_start_at: string | null;
          new_end_at: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_adjustment_id: string;
          plan_id?: string | null;
          client_plan_id: string;
          block_id?: string | null;
          client_block_id?: string | null;
          adjustment_type: 'move' | 'resize' | 'delete' | 'edit';
          previous_start_at?: string | null;
          previous_end_at?: string | null;
          new_start_at?: string | null;
          new_end_at?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['plan_adjustments']['Insert']>;
      };
      resume_items: {
        Row: {
          id: string; user_id: string;
          category: 'skills'|'experience'|'projects'|'certifications'|'education';
          title: string; subtitle: string|null; description: string|null;
          date_label: string|null;
          level: 'beginner'|'intermediate'|'advanced'|'expert'|null;
          completed: boolean; sort_order: number;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string;
          category: 'skills'|'experience'|'projects'|'certifications'|'education';
          title: string; subtitle?: string|null; description?: string|null;
          date_label?: string|null;
          level?: 'beginner'|'intermediate'|'advanced'|'expert'|null;
          completed?: boolean; sort_order?: number;
          created_at?: string; updated_at?: string;
        };
        Update: Partial<{
          category: 'skills'|'experience'|'projects'|'certifications'|'education';
          title: string; subtitle: string|null; description: string|null;
          date_label: string|null;
          level: 'beginner'|'intermediate'|'advanced'|'expert'|null;
          completed: boolean; sort_order: number; updated_at: string;
        }>;
      };
      college_courses: {
        Row: {
          id: string; user_id: string; name: string; grade: string;
          credits: number; weighted: boolean; semester: string; created_at: string;
        };
        Insert: {
          id?: string; user_id: string; name: string; grade: string;
          credits?: number; weighted?: boolean; semester?: string; created_at?: string;
        };
        Update: Partial<{ name: string; grade: string; credits: number; weighted: boolean; semester: string; }>;
      };
      extracurriculars: {
        Row: {
          id: string; user_id: string; name: string; role: string;
          category: 'sports'|'arts'|'academic'|'volunteer'|'work'|'leadership'|'other';
          years_involved: number; hours_per_week: number; weeks_per_year: number;
          description: string; achievements: string|null; highlighted: boolean;
          sort_order: number; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; name: string; role?: string;
          category: 'sports'|'arts'|'academic'|'volunteer'|'work'|'leadership'|'other';
          years_involved?: number; hours_per_week?: number; weeks_per_year?: number;
          description?: string; achievements?: string|null; highlighted?: boolean;
          sort_order?: number; created_at?: string; updated_at?: string;
        };
        Update: Partial<{
          name: string; role: string;
          category: 'sports'|'arts'|'academic'|'volunteer'|'work'|'leadership'|'other';
          years_involved: number; hours_per_week: number; weeks_per_year: number;
          description: string; achievements: string|null; highlighted: boolean;
          sort_order: number; updated_at: string;
        }>;
      };
      college_applications: {
        Row: {
          id: string; user_id: string; name: string;
          app_type: 'reach'|'match'|'safety';
          deadline: string|null;
          deadline_type: 'ED'|'EA'|'RD'|'Rolling';
          status: 'researching'|'applying'|'applied'|'accepted'|'rejected'|'waitlisted'|'deferred';
          notes: string|null; scholarships: boolean;
          essays_done: number; essays_total: number;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; name: string;
          app_type: 'reach'|'match'|'safety';
          deadline?: string|null; deadline_type?: 'ED'|'EA'|'RD'|'Rolling';
          status?: 'researching'|'applying'|'applied'|'accepted'|'rejected'|'waitlisted'|'deferred';
          notes?: string|null; scholarships?: boolean;
          essays_done?: number; essays_total?: number;
          created_at?: string; updated_at?: string;
        };
        Update: Partial<{
          name: string; app_type: 'reach'|'match'|'safety';
          deadline: string|null; deadline_type: 'ED'|'EA'|'RD'|'Rolling';
          status: 'researching'|'applying'|'applied'|'accepted'|'rejected'|'waitlisted'|'deferred';
          notes: string|null; scholarships: boolean;
          essays_done: number; essays_total: number; updated_at: string;
        }>;
      };
      test_scores: {
        Row: {
          id: string; user_id: string; test_name: string;
          score: number; max_score: number; date_taken: string|null;
          notes: string|null; created_at: string;
        };
        Insert: {
          id?: string; user_id: string; test_name: string;
          score: number; max_score?: number; date_taken?: string|null;
          notes?: string|null; created_at?: string;
        };
        Update: Partial<{ test_name: string; score: number; max_score: number; date_taken: string|null; notes: string|null; }>;
      };
      recommendations: {
        Row: {
          id: string; user_id: string; recommender_name: string;
          recommender_role: string;
          status: 'not_asked'|'asked'|'confirmed'|'submitted';
          deadline: string|null; notes: string|null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; recommender_name: string;
          recommender_role?: string;
          status?: 'not_asked'|'asked'|'confirmed'|'submitted';
          deadline?: string|null; notes?: string|null;
          created_at?: string; updated_at?: string;
        };
        Update: Partial<{
          recommender_name: string; recommender_role: string;
          status: 'not_asked'|'asked'|'confirmed'|'submitted';
          deadline: string|null; notes: string|null; updated_at: string;
        }>;
      };
      study_sets: {
        Row: {
          id: string; user_id: string; exam_id: string|null;
          name: string; linked_task_ids: string[];
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; exam_id?: string|null;
          name: string; linked_task_ids?: string[];
          created_at?: string; updated_at?: string;
        };
        Update: Partial<{ exam_id: string|null; name: string; linked_task_ids: string[]; updated_at: string; }>;
      };
      flashcards: {
        Row: {
          id: string; study_set_id: string; user_id: string;
          front: string; back: string; subject: string|null;
          sort_order: number; created_at: string;
        };
        Insert: {
          id?: string; study_set_id: string; user_id: string;
          front: string; back: string; subject?: string|null;
          sort_order?: number; created_at?: string;
        };
        Update: Partial<{ front: string; back: string; subject: string|null; sort_order: number; }>;
      };
      mcq_questions: {
        Row: {
          id: string; study_set_id: string; user_id: string;
          question: string; options: string[]; correct_index: number;
          explanation: string|null; subject: string|null;
          sort_order: number; created_at: string;
        };
        Insert: {
          id?: string; study_set_id: string; user_id: string;
          question: string; options: string[]; correct_index: number;
          explanation?: string|null; subject?: string|null;
          sort_order?: number; created_at?: string;
        };
        Update: Partial<{ question: string; options: string[]; correct_index: number; explanation: string|null; subject: string|null; sort_order: number; }>;
      };
      study_set_files: {
        Row: {
          id: string; study_set_id: string; user_id: string;
          file_name: string; storage_path: string; mime_type: string;
          size_bytes: number|null; created_at: string;
        };
        Insert: {
          id?: string; study_set_id: string; user_id: string;
          file_name: string; storage_path: string; mime_type?: string;
          size_bytes?: number|null; created_at?: string;
        };
        Update: Partial<{ file_name: string; storage_path: string; mime_type: string; size_bytes: number|null; }>;
      };
      sat_act_progress: {
        Row: {
          id: string; user_id: string; test_type: 'SAT'|'ACT';
          section_name: string; progress_pct: number;
          target_score: string|null; updated_at: string;
        };
        Insert: {
          id?: string; user_id: string; test_type: 'SAT'|'ACT';
          section_name: string; progress_pct?: number;
          target_score?: string|null; updated_at?: string;
        };
        Update: Partial<{ test_type: 'SAT'|'ACT'; section_name: string; progress_pct: number; target_score: string|null; updated_at: string; }>;
      };
    }>;
    Views: { [_ in never]: never };
    Functions: {
      clear_own_timer_state: {
        Args: { expected_user_id: string };
        Returns: boolean;
      };
      replace_planner_snapshot: {
        Args: {
          p_expected_revision: number;
          p_snapshot: Json;
          p_reconcile_deletes?: boolean;
        };
        Returns: number | null;
      };
      complete_task_with_successor: {
        Args: { p_task_id: string; p_successor?: Json | null };
        Returns: Json;
      };
      claim_canvas_sync: {
        Args: { target_user_id: string };
        Returns: Array<{ lease_token: string; sync_revision: number }>;
      };
      renew_canvas_sync_lease: {
        Args: {
          target_user_id: string;
          expected_lease_token: string;
          expected_revision: number;
        };
        Returns: boolean;
      };
      complete_canvas_sync: {
        Args: {
          target_user_id: string;
          expected_lease_token: string;
          expected_revision: number;
          requested_mode: 'manual' | 'background';
          completed_sync_at: string;
          completed_course_count: number | null;
        };
        Returns: boolean;
      };
      claim_canvas_provider_request: {
        Args: { requested_kind: 'validate' | 'manual_sync' };
        Returns: Array<{
          claim_token: string | null;
          retry_after_seconds: number;
        }>;
      };
      release_canvas_provider_request: {
        Args: {
          requested_kind: 'validate' | 'manual_sync';
          expected_claim_token: string;
        };
        Returns: boolean;
      };
      release_canvas_sync_lease: {
        Args: {
          target_user_id: string;
          expected_lease_token: string;
          expected_revision: number;
        };
        Returns: boolean;
      };
      search_profiles_for_friendship: {
        Args: { search_query: string };
        Returns: Array<{
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
        }>;
      };
      get_friendships_with_profiles: {
        Args: Record<string, never>;
        Returns: Array<{
          friendship_id: string;
          friendship_status: 'pending' | 'accepted' | 'rejected';
          friendship_created_at: string;
          direction: 'sent' | 'received';
          profile_id: string;
          profile_email: string;
          profile_full_name: string | null;
          profile_avatar_url: string | null;
          profile_total_study_time: number;
          profile_tasks_completed: number;
          profile_current_streak: number;
          profile_longest_streak: number;
          profile_created_at: string;
          profile_updated_at: string;
        }>;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}

// Helper types
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Subject = Database['public']['Tables']['subjects']['Row'];
export type Task = Database['public']['Tables']['tasks']['Row'];
export type Goal = Database['public']['Tables']['goals']['Row'];
export type StudySession = Database['public']['Tables']['study_sessions']['Row'];
export type NewStudySession = Omit<StudySession, 'id' | 'created_at'> & { id?: string };
export type Exam = Database['public']['Tables']['exams']['Row'];
export type Friendship = Database['public']['Tables']['friendships']['Row'];
export type Competition = Database['public']['Tables']['competitions']['Row'];
export type Achievement = Database['public']['Tables']['achievements']['Row'];
export type CanvasSettings = Database['public']['Tables']['canvas_settings']['Row'];
export type TimerState = Database['public']['Tables']['timer_states']['Row'];

export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in_progress' | 'completed';
export type GoalType = 'short_term' | 'long_term';

// ── New feature types ──────────────────────────────────────────────

export interface ResumeItem {
  id: string;
  user_id: string;
  category: 'skills' | 'experience' | 'projects' | 'certifications' | 'education';
  title: string;
  subtitle: string | null;
  description: string | null;
  date_label: string | null;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert' | null;
  completed: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollegeCourse {
  id: string;
  user_id: string;
  name: string;
  grade: string;
  credits: number;
  weighted: boolean;
  semester: string;
  created_at: string;
}

export interface Extracurricular {
  id: string;
  user_id: string;
  name: string;
  role: string;
  category: 'sports' | 'arts' | 'academic' | 'volunteer' | 'work' | 'leadership' | 'other';
  years_involved: number;
  hours_per_week: number;
  weeks_per_year: number;
  description: string;
  achievements: string | null;
  highlighted: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CollegeApplication {
  id: string;
  user_id: string;
  name: string;
  app_type: 'reach' | 'match' | 'safety';
  deadline: string | null;
  deadline_type: 'ED' | 'EA' | 'RD' | 'Rolling';
  status: 'researching' | 'applying' | 'applied' | 'accepted' | 'rejected' | 'waitlisted' | 'deferred';
  notes: string | null;
  scholarships: boolean;
  essays_done: number;
  essays_total: number;
  created_at: string;
  updated_at: string;
}

export interface TestScore {
  id: string;
  user_id: string;
  test_name: string;
  score: number;
  max_score: number;
  date_taken: string | null;
  notes: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  user_id: string;
  recommender_name: string;
  recommender_role: string;
  status: 'not_asked' | 'asked' | 'confirmed' | 'submitted';
  deadline: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudySet {
  id: string;
  user_id: string;
  exam_id: string | null;
  name: string;
  linked_task_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Flashcard {
  id: string;
  study_set_id: string;
  user_id: string;
  front: string;
  back: string;
  subject: string | null;
  sort_order: number;
  created_at: string;
}

export interface MCQQuestion {
  id: string;
  study_set_id: string;
  user_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  subject: string | null;
  sort_order: number;
  created_at: string;
}

export interface StudySetFile {
  id: string;
  study_set_id: string;
  user_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number | null;
  created_at: string;
}

export interface SatActProgress {
  id: string;
  user_id: string;
  test_type: 'SAT' | 'ACT';
  section_name: string;
  progress_pct: number;
  target_score: string | null;
  updated_at: string;
}
