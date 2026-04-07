export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          avatar_url: string | null;
          total_study_time: number;
          tasks_completed: number;
          current_streak: number;
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
        };
        Update: {
          subject_id?: string | null;
          title?: string;
          description?: string | null;
          exam_date?: string;
          location?: string | null;
          preparation_progress?: number;
          updated_at?: string;
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
    };
  };
}

// Helper types
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type Subject = Database['public']['Tables']['subjects']['Row'];
export type Task = Database['public']['Tables']['tasks']['Row'];
export type Goal = Database['public']['Tables']['goals']['Row'];
export type StudySession = Database['public']['Tables']['study_sessions']['Row'];
export type Exam = Database['public']['Tables']['exams']['Row'];
export type Friendship = Database['public']['Tables']['friendships']['Row'];
export type Competition = Database['public']['Tables']['competitions']['Row'];
export type Achievement = Database['public']['Tables']['achievements']['Row'];

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
