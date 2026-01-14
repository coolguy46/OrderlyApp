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
