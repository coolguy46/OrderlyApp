// Supabase Service Functions for Database Operations
import { supabase, isSupabaseAvailable } from './client';
import type { 
  Profile, 
  Subject, 
  Task, 
  Goal, 
  StudySession, 
  Exam,
  Friendship,
  Achievement,
} from './types';

// Use the supabase client with any to bypass strict typing issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Returns true if the error is a harmless request abort (e.g. React Strict Mode). */
function isAbortError(e: any): boolean {
  return (
    e?.name === 'AbortError' ||
    e?.message?.includes('signal') ||
    e?.message?.includes('aborted') ||
    e?.code === 'PGRST_REQUEST_ABORTED'
  );
}

// ============== PROFILE SERVICES ==============

export async function getProfile(userId: string): Promise<Profile | null> {
  
  
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    console.error('Error fetching profile:', error);
    return null;
  }
  return data as Profile | null;
}

export async function updateProfile(userId: string, updates: Partial<Profile>): Promise<Profile | null> {
  
  
  const { data, error } = await db
    .from('profiles')
    .update(updates)
    .eq('id', userId)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating profile:', error);
    return null;
  }
  return data as Profile | null;
}

// ============== SUBJECT SERVICES ==============

export async function getSubjects(userId: string): Promise<Subject[]> {
  
  
  const { data, error } = await db
    .from('subjects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  
  if (error) {
    console.error('Error fetching subjects:', error);
    return [];
  }
  return (data || []) as Subject[];
}

export async function createSubject(subject: Omit<Subject, 'id' | 'created_at'>): Promise<Subject | null> {
  
  
  const { data, error } = await db
    .from('subjects')
    .insert(subject)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating subject:', error);
    return null;
  }
  return data as Subject | null;
}

export async function updateSubject(id: string, updates: Partial<Subject>): Promise<Subject | null> {
  
  
  const { data, error } = await db
    .from('subjects')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating subject:', error);
    return null;
  }
  return data as Subject | null;
}

export async function deleteSubject(id: string): Promise<boolean> {
  
  
  const { error } = await db
    .from('subjects')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting subject:', error);
    return false;
  }
  return true;
}

// ============== TASK SERVICES ==============

export async function getTasks(userId: string): Promise<Task[]> {
  
  
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching tasks:', error);
    return [];
  }
  return (data || []) as Task[];
}

export async function createTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Promise<Task | null> {
  // Strip undefined values and only send fields that have values
  const cleanTask: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(task)) {
    if (value !== undefined) {
      cleanTask[key] = value;
    }
  }
  
  const { data, error } = await db
    .from('tasks')
    .insert(cleanTask)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating task:', error.message, error.details, error.hint);
    return null;
  }
  return data as Task | null;
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
  
  
  const { data, error } = await db
    .from('tasks')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating task:', error);
    return null;
  }
  return data as Task | null;
}

export async function deleteTask(id: string): Promise<boolean> {
  
  
  const { error } = await db
    .from('tasks')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting task:', error);
    return false;
  }
  return true;
}

export async function completeTask(id: string): Promise<Task | null> {
  
  
  const { data, error } = await db
    .from('tasks')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error completing task:', error);
    return null;
  }
  return data as Task | null;
}

// Get task by external ID (for Canvas integration)
export async function getTaskByExternalId(userId: string, source: string, externalId: string): Promise<Task | null> {
  
  
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .eq('source', source)
    .eq('external_id', externalId)
    .single();
  
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
    console.error('Error fetching task by external ID:', error);
  }
  return (data as Task | null) || null;
}

// Remove Canvas tasks that no longer exist in Canvas (submitted/deleted)
export async function removeOrphanedCanvasTasks(userId: string, currentCanvasIds: string[]): Promise<number> {
  
  
  // Get all Canvas tasks for this user
  const { data: existingTasks, error: fetchError } = await db
    .from('tasks')
    .select('id, external_id')
    .eq('user_id', userId)
    .eq('source', 'canvas')
    .not('external_id', 'is', null);
  
  if (fetchError) {
    console.error('Error fetching Canvas tasks:', fetchError);
    return 0;
  }
  
  if (!existingTasks || existingTasks.length === 0) return 0;
  
  // Find tasks that are no longer in Canvas
  const orphanedTaskIds = (existingTasks as any[])
    .filter((task: any) => task.external_id && !currentCanvasIds.includes(task.external_id))
    .map((task: any) => task.id);
  
  if (orphanedTaskIds.length === 0) return 0;
  
  // Delete orphaned tasks
  const { error: deleteError } = await db
    .from('tasks')
    .delete()
    .in('id', orphanedTaskIds);
  
  if (deleteError) {
    console.error('Error deleting orphaned Canvas tasks:', deleteError);
    return 0;
  }
  
  return orphanedTaskIds.length;
}

// Upsert Canvas task (insert or update based on external_id)
export async function upsertCanvasTask(task: Omit<Task, 'id' | 'created_at' | 'updated_at'>): Promise<Task | null> {
  
  
  const { data, error } = await db
    .from('tasks')
    .upsert(task, {
      onConflict: 'user_id,source,external_id',
      ignoreDuplicates: false,
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error upserting Canvas task:', error);
    return null;
  }
  return data as Task | null;
}

// ============== GOAL SERVICES ==============

export async function getGoals(userId: string): Promise<Goal[]> {
  
  
  const { data, error } = await db
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching goals:', error);
    return [];
  }
  return (data || []) as Goal[];
}

export async function createGoal(goal: Omit<Goal, 'id' | 'created_at' | 'updated_at'>): Promise<Goal | null> {
  
  
  const { data, error } = await db
    .from('goals')
    .insert(goal)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating goal:', error);
    return null;
  }
  return data as Goal | null;
}

export async function updateGoal(id: string, updates: Partial<Goal>): Promise<Goal | null> {
  
  
  const { data, error } = await db
    .from('goals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating goal:', error);
    return null;
  }
  return data as Goal | null;
}

export async function deleteGoal(id: string): Promise<boolean> {
  
  
  const { error } = await db
    .from('goals')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting goal:', error);
    return false;
  }
  return true;
}

// ============== STUDY SESSION SERVICES ==============

export async function getStudySessions(userId: string): Promise<StudySession[]> {
  
  
  const { data, error } = await db
    .from('study_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  
  if (error) {
    console.error('Error fetching study sessions:', error);
    return [];
  }
  return (data || []) as StudySession[];
}

export async function createStudySession(session: Omit<StudySession, 'id' | 'created_at'>): Promise<StudySession | null> {
  
  
  const { data, error } = await db
    .from('study_sessions')
    .insert(session)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating study session:', error);
    return null;
  }
  return data as StudySession | null;
}

// ============== EXAM SERVICES ==============

export async function getExams(userId: string): Promise<Exam[]> {
  
  
  const { data, error } = await db
    .from('exams')
    .select('*')
    .eq('user_id', userId)
    .order('exam_date', { ascending: true });
  
  if (error) {
    console.error('Error fetching exams:', error);
    return [];
  }
  return (data || []) as Exam[];
}

export async function createExam(exam: Omit<Exam, 'id' | 'created_at' | 'updated_at'>): Promise<Exam | null> {
  
  
  const { data, error } = await db
    .from('exams')
    .insert(exam)
    .select()
    .single();
  
  if (error) {
    console.error('Error creating exam:', error);
    return null;
  }
  return data as Exam | null;
}

export async function updateExam(id: string, updates: Partial<Exam>): Promise<Exam | null> {
  
  
  const { data, error } = await db
    .from('exams')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) {
    console.error('Error updating exam:', error);
    return null;
  }
  return data as Exam | null;
}

export async function deleteExam(id: string): Promise<boolean> {
  
  
  const { error } = await db
    .from('exams')
    .delete()
    .eq('id', id);
  
  if (error) {
    console.error('Error deleting exam:', error);
    return false;
  }
  return true;
}

// ============== CANVAS SETTINGS SERVICES ==============

export interface CanvasSettings {
  id: string;
  user_id: string;
  ical_url: string;
  last_sync_at: string | null;
  sync_enabled: boolean;
  auto_import_assignments: boolean;
  created_at: string;
  updated_at: string;
}

export async function getCanvasSettings(userId: string): Promise<CanvasSettings | null> {
  
  
  const { data, error } = await db
    .from('canvas_settings')
    .select('*')
    .eq('user_id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching canvas settings:', error);
  }
  return (data as CanvasSettings | null) || null;
}

export async function upsertCanvasSettings(userId: string, settings: {
  ical_url?: string;
  last_sync_at?: string | null;
  sync_enabled?: boolean;
  auto_import_assignments?: boolean;
}): Promise<CanvasSettings | null> {
  
  
  const { data, error } = await db
    .from('canvas_settings')
    .upsert({
      user_id: userId,
      ...settings,
    }, {
      onConflict: 'user_id',
    })
    .select()
    .single();
  
  if (error) {
    console.error('Error upserting canvas settings:', error);
    return null;
  }
  return data as CanvasSettings | null;
}

export async function deleteCanvasSettings(userId: string): Promise<boolean> {
  
  
  const { error } = await db
    .from('canvas_settings')
    .delete()
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error deleting canvas settings:', error);
    return false;
  }
  return true;
}

// ============== TIMER STATE SERVICES ==============

export interface TimerState {
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
  updated_at: string;
}

export async function getTimerState(userId: string): Promise<TimerState | null> {
  const { data, error } = await db
    .from('timer_states')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching timer state:', error);
  }
  return (data as TimerState | null) || null;
}

export async function upsertTimerState(userId: string, state: Omit<TimerState, 'id' | 'user_id' | 'updated_at'>): Promise<TimerState | null> {
  const { data, error } = await db
    .from('timer_states')
    .upsert({
      user_id: userId,
      ...state,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) {
    console.error('Error upserting timer state:', error);
    return null;
  }
  return data as TimerState | null;
}

export async function deleteTimerState(userId: string): Promise<boolean> {
  const { error } = await db
    .from('timer_states')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting timer state:', error);
    return false;
  }
  return true;
}

// ============== FRIENDSHIP SERVICES ==============

export interface FriendWithProfile {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  profile: Profile;
  direction: 'sent' | 'received';
}

export async function getFriends(userId: string): Promise<FriendWithProfile[]> {
  // Get friendships where user is either the sender or receiver
  const { data: sent, error: sentError } = await db
    .from('friendships')
    .select('id, status, created_at, friend_id')
    .eq('user_id', userId);

  const { data: received, error: recvError } = await db
    .from('friendships')
    .select('id, status, created_at, user_id')
    .eq('friend_id', userId);

  if (sentError || recvError) {
    console.error('Error fetching friendships:', sentError || recvError);
    return [];
  }

  const results: FriendWithProfile[] = [];

  // Fetch profiles for sent friend requests
  for (const f of (sent || [])) {
    const profile = await getProfile(f.friend_id);
    if (profile) {
      results.push({ id: f.id, status: f.status, created_at: f.created_at, profile, direction: 'sent' });
    }
  }

  // Fetch profiles for received friend requests
  for (const f of (received || [])) {
    const profile = await getProfile(f.user_id);
    if (profile) {
      results.push({ id: f.id, status: f.status, created_at: f.created_at, profile, direction: 'received' });
    }
  }

  return results;
}

export async function sendFriendRequest(userId: string, friendId: string): Promise<boolean> {
  const { error } = await db
    .from('friendships')
    .insert({ user_id: userId, friend_id: friendId, status: 'pending' });

  if (error) {
    console.error('Error sending friend request:', error);
    return false;
  }
  return true;
}

export async function respondToFriendRequest(friendshipId: string, accept: boolean): Promise<boolean> {
  const { error } = await db
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'rejected', updated_at: new Date().toISOString() })
    .eq('id', friendshipId);

  if (error) {
    console.error('Error responding to friend request:', error);
    return false;
  }
  return true;
}

export async function removeFriend(friendshipId: string): Promise<boolean> {
  const { error } = await db
    .from('friendships')
    .delete()
    .eq('id', friendshipId);

  if (error) {
    console.error('Error removing friend:', error);
    return false;
  }
  return true;
}

export async function searchUsersByEmail(query: string, currentUserId: string): Promise<Profile[]> {
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .or(`email.ilike.%${query}%,full_name.ilike.%${query}%`)
    .neq('id', currentUserId)
    .limit(10);

  if (error) {
    console.error('Error searching users:', error);
    return [];
  }
  return (data || []) as Profile[];
}

// ============== ACHIEVEMENT SERVICES ==============

interface AchievementDef {
  type: string;
  title: string;
  description: string;
  check: (profile: Profile, stats: { totalStudyMinutes: number; completedTasks: number; totalSessions: number }) => boolean;
}

export const ACHIEVEMENT_DEFINITIONS: AchievementDef[] = [
  { type: 'first_session', title: 'First Steps', description: 'Complete your first study session', check: (_, s) => s.totalSessions >= 1 },
  { type: 'tasks_5', title: 'Getting Things Done', description: 'Complete 5 tasks', check: (p) => p.tasks_completed >= 5 },
  { type: 'tasks_25', title: 'Task Master', description: 'Complete 25 tasks', check: (p) => p.tasks_completed >= 25 },
  { type: 'tasks_100', title: 'Centurion', description: 'Complete 100 tasks', check: (p) => p.tasks_completed >= 100 },
  { type: 'streak_7', title: 'Week Warrior', description: 'Maintain a 7-day streak', check: (p) => p.longest_streak >= 7 },
  { type: 'streak_30', title: 'Monthly Champion', description: 'Maintain a 30-day streak', check: (p) => p.longest_streak >= 30 },
  { type: 'hours_10', title: 'Dedicated Learner', description: 'Study for 10 hours total', check: (_, s) => s.totalStudyMinutes >= 600 },
  { type: 'hours_50', title: 'Scholar', description: 'Study for 50 hours total', check: (_, s) => s.totalStudyMinutes >= 3000 },
  { type: 'hours_100', title: 'Century Scholar', description: 'Study for 100 hours total', check: (_, s) => s.totalStudyMinutes >= 6000 },
  { type: 'sessions_50', title: 'Focused Mind', description: 'Complete 50 study sessions', check: (_, s) => s.totalSessions >= 50 },
];

export async function getAchievements(userId: string): Promise<Achievement[]> {
  const { data, error } = await db
    .from('achievements')
    .select('*')
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false });

  if (error) {
    console.error('Error fetching achievements:', error);
    return [];
  }
  return (data || []) as Achievement[];
}

export async function checkAndUnlockAchievements(
  userId: string,
  profile: Profile,
  stats: { totalStudyMinutes: number; completedTasks: number; totalSessions: number }
): Promise<Achievement[]> {
  const existing = await getAchievements(userId);
  const existingTypes = new Set(existing.map((a) => a.achievement_type));
  const newlyUnlocked: Achievement[] = [];

  for (const def of ACHIEVEMENT_DEFINITIONS) {
    if (!existingTypes.has(def.type) && def.check(profile, stats)) {
      const { data, error } = await db
        .from('achievements')
        .insert({
          user_id: userId,
          achievement_type: def.type,
          title: def.title,
          description: def.description,
        })
        .select()
        .single();

      if (!error && data) {
        newlyUnlocked.push(data as Achievement);
      }
    }
  }

  return newlyUnlocked;
}

// ============== AUTH HELPERS ==============

export async function getCurrentUser() {
  
  
  const { data: { user }, error } = await db.auth.getUser();
  if (error) {
    console.error('Error getting current user:', error);
    return null;
  }
  return user;
}

export async function signIn(email: string, password: string) {
  
  
  const { data, error } = await db.auth.signInWithPassword({
    email,
    password,
  });
  
  if (error) {
    throw error;
  }
  return data;
}

export async function signUp(email: string, password: string, fullName?: string) {
  
  
  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
      },
    },
  });
  
  if (error) {
    throw error;
  }
  return data;
}

export async function signOut() {
  
  
  const { error } = await db.auth.signOut();
  if (error) {
    throw error;
  }
}

export async function signInWithGoogle() {
  const { data, error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/callback`,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) {
    throw error;
  }
  return data;
}

export async function resetPassword(email: string) {
  
  
  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: `${typeof window !== 'undefined' ? window.location.origin : ''}/auth/reset-password`,
  });
  
  if (error) {
    throw error;
  }
}

// Subscribe to auth state changes
export function onAuthStateChange(callback: (user: any) => void) {
  if (!isSupabaseAvailable()) {
    return { data: { subscription: { unsubscribe: () => {} } } };
  }
  
  return db.auth.onAuthStateChange((event: any, session: any) => {
    callback(session?.user || null);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NEW FEATURE SERVICES
// ─────────────────────────────────────────────────────────────────────────────

import type {
  ResumeItem,
  CollegeCourse,
  Extracurricular,
  CollegeApplication,
  TestScore,
  Recommendation,
  StudySet,
  Flashcard,
  MCQQuestion,
  StudySetFile,
  SatActProgress,
} from '@/lib/supabase/types';

// Supabase client alias used throughout the new service functions
const supabaseClient = supabase;

// ── Resume Items ─────────────────────────────────────────────
export async function getResumeItems(userId: string): Promise<ResumeItem[]> {
  const { data, error } = await (supabaseClient as any)
    .from('resume_items')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getResumeItems::', error); return [];
  }
  return data ?? [];
}

export async function upsertResumeItem(
  userId: string,
  item: Omit<ResumeItem, 'id' | 'user_id' | 'created_at' | 'updated_at'> & { id?: string }
): Promise<ResumeItem | null> {
  const payload = { ...item, user_id: userId };
  const { data, error } = await (supabaseClient as any)
    .from('resume_items')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('upsertResumeItem::', error); return null;
  }
  return data;
}

export async function deleteResumeItem(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('resume_items').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteResumeItem::', error); return false;
  }
  return true;
}

// ── College Courses (GPA) ────────────────────────────────────
export async function getCollegeCourses(userId: string): Promise<CollegeCourse[]> {
  const { data, error } = await (supabaseClient as any)
    .from('college_courses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getCollegeCourses::', error); return [];
  }
  return data ?? [];
}

export async function createCollegeCourse(
  course: Omit<CollegeCourse, 'id' | 'created_at'>
): Promise<CollegeCourse | null> {
  const { data, error } = await (supabaseClient as any)
    .from('college_courses')
    .insert(course)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createCollegeCourse::', error); return null;
  }
  return data;
}

export async function updateCollegeCourse(
  id: string,
  updates: Partial<Omit<CollegeCourse, 'id' | 'user_id' | 'created_at'>>
): Promise<CollegeCourse | null> {
  const { data, error } = await (supabaseClient as any)
    .from('college_courses')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('updateCollegeCourse::', error); return null;
  }
  return data;
}

export async function deleteCollegeCourse(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('college_courses').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteCollegeCourse::', error); return false;
  }
  return true;
}

// ── Extracurriculars ─────────────────────────────────────────
export async function getExtracurriculars(userId: string): Promise<Extracurricular[]> {
  const { data, error } = await (supabaseClient as any)
    .from('extracurriculars')
    .select('*')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getExtracurriculars::', error); return [];
  }
  return data ?? [];
}

export async function createExtracurricular(
  ec: Omit<Extracurricular, 'id' | 'created_at' | 'updated_at'>
): Promise<Extracurricular | null> {
  const { data, error } = await (supabaseClient as any)
    .from('extracurriculars')
    .insert(ec)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createExtracurricular::', error); return null;
  }
  return data;
}

export async function updateExtracurricular(
  id: string,
  updates: Partial<Omit<Extracurricular, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<Extracurricular | null> {
  const { data, error } = await (supabaseClient as any)
    .from('extracurriculars')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('updateExtracurricular::', error); return null;
  }
  return data;
}

export async function deleteExtracurricular(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('extracurriculars').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteExtracurricular::', error); return false;
  }
  return true;
}

// ── College Applications ─────────────────────────────────────
export async function getCollegeApplications(userId: string): Promise<CollegeApplication[]> {
  const { data, error } = await (supabaseClient as any)
    .from('college_applications')
    .select('*')
    .eq('user_id', userId)
    .order('deadline', { ascending: true, nullsFirst: false });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getCollegeApplications::', error); return [];
  }
  return data ?? [];
}

export async function createCollegeApplication(
  app: Omit<CollegeApplication, 'id' | 'created_at' | 'updated_at'>
): Promise<CollegeApplication | null> {
  const { data, error } = await (supabaseClient as any)
    .from('college_applications')
    .insert(app)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createCollegeApplication::', error); return null;
  }
  return data;
}

export async function updateCollegeApplication(
  id: string,
  updates: Partial<Omit<CollegeApplication, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<CollegeApplication | null> {
  const { data, error } = await (supabaseClient as any)
    .from('college_applications')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('updateCollegeApplication::', error); return null;
  }
  return data;
}

export async function deleteCollegeApplication(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('college_applications').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteCollegeApplication::', error); return false;
  }
  return true;
}

// ── Test Scores ──────────────────────────────────────────────
export async function getTestScores(userId: string): Promise<TestScore[]> {
  const { data, error } = await (supabaseClient as any)
    .from('test_scores')
    .select('*')
    .eq('user_id', userId)
    .order('date_taken', { ascending: false, nullsFirst: false });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getTestScores::', error); return [];
  }
  return data ?? [];
}

export async function createTestScore(
  score: Omit<TestScore, 'id' | 'created_at'>
): Promise<TestScore | null> {
  const { data, error } = await (supabaseClient as any)
    .from('test_scores')
    .insert(score)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createTestScore::', error); return null;
  }
  return data;
}

export async function deleteTestScore(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('test_scores').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteTestScore::', error); return false;
  }
  return true;
}

// ── Recommendations ──────────────────────────────────────────
export async function getRecommendations(userId: string): Promise<Recommendation[]> {
  const { data, error } = await (supabaseClient as any)
    .from('recommendations')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getRecommendations::', error); return [];
  }
  return data ?? [];
}

export async function createRecommendation(
  rec: Omit<Recommendation, 'id' | 'created_at' | 'updated_at'>
): Promise<Recommendation | null> {
  const { data, error } = await (supabaseClient as any)
    .from('recommendations')
    .insert(rec)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createRecommendation::', error); return null;
  }
  return data;
}

export async function updateRecommendation(
  id: string,
  updates: Partial<Omit<Recommendation, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<Recommendation | null> {
  const { data, error } = await (supabaseClient as any)
    .from('recommendations')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('updateRecommendation::', error); return null;
  }
  return data;
}

export async function deleteRecommendation(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('recommendations').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteRecommendation::', error); return false;
  }
  return true;
}

// ── Study Sets ───────────────────────────────────────────────
export async function getStudySets(userId: string): Promise<StudySet[]> {
  const { data, error } = await (supabaseClient as any)
    .from('study_sets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getStudySets::', error); return [];
  }
  // cast jsonb → string[]
  return (data ?? []).map((s: any) => ({ ...s, linked_task_ids: s.linked_task_ids ?? [] }));
}

export async function createStudySet(
  set: Omit<StudySet, 'id' | 'created_at' | 'updated_at'>
): Promise<StudySet | null> {
  const { data, error } = await (supabaseClient as any)
    .from('study_sets')
    .insert(set)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createStudySet::', error); return null;
  }
  return { ...data, linked_task_ids: data.linked_task_ids ?? [] };
}

export async function updateStudySet(
  id: string,
  updates: Partial<Omit<StudySet, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
): Promise<StudySet | null> {
  const { data, error } = await (supabaseClient as any)
    .from('study_sets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('updateStudySet::', error); return null;
  }
  return { ...data, linked_task_ids: data.linked_task_ids ?? [] };
}

export async function deleteStudySet(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('study_sets').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteStudySet::', error); return false;
  }
  return true;
}

// ── Flashcards ───────────────────────────────────────────────
export async function getFlashcards(studySetId: string): Promise<Flashcard[]> {
  const { data, error } = await (supabaseClient as any)
    .from('flashcards')
    .select('*')
    .eq('study_set_id', studySetId)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getFlashcards::', error); return [];
  }
  return data ?? [];
}

export async function createFlashcard(
  card: Omit<Flashcard, 'id' | 'created_at'>
): Promise<Flashcard | null> {
  const { data, error } = await (supabaseClient as any)
    .from('flashcards')
    .insert(card)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createFlashcard::', error); return null;
  }
  return data;
}

export async function deleteFlashcard(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('flashcards').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteFlashcard::', error); return false;
  }
  return true;
}

// ── MCQ Questions ────────────────────────────────────────────
export async function getMCQQuestions(studySetId: string): Promise<MCQQuestion[]> {
  const { data, error } = await (supabaseClient as any)
    .from('mcq_questions')
    .select('*')
    .eq('study_set_id', studySetId)
    .order('sort_order', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getMCQQuestions::', error); return [];
  }
  return (data ?? []).map((q: any) => ({ ...q, options: q.options ?? [] }));
}

export async function createMCQQuestion(
  q: Omit<MCQQuestion, 'id' | 'created_at'>
): Promise<MCQQuestion | null> {
  const { data, error } = await (supabaseClient as any)
    .from('mcq_questions')
    .insert(q)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createMCQQuestion::', error); return null;
  }
  return { ...data, options: data.options ?? [] };
}

export async function deleteMCQQuestion(id: string): Promise<boolean> {
  const { error } = await (supabaseClient as any).from('mcq_questions').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteMCQQuestion::', error); return false;
  }
  return true;
}

// ── Study Set Files (metadata) ───────────────────────────────
export async function getStudySetFiles(studySetId: string): Promise<StudySetFile[]> {
  const { data, error } = await (supabaseClient as any)
    .from('study_set_files')
    .select('*')
    .eq('study_set_id', studySetId)
    .order('created_at', { ascending: true });
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getStudySetFiles::', error); return [];
  }
  return data ?? [];
}

export async function createStudySetFile(
  file: Omit<StudySetFile, 'id' | 'created_at'>
): Promise<StudySetFile | null> {
  const { data, error } = await (supabaseClient as any)
    .from('study_set_files')
    .insert(file)
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('createStudySetFile::', error); return null;
  }
  return data;
}

export async function deleteStudySetFile(id: string, storagePath: string): Promise<boolean> {
  // Remove file from Storage first
  await (supabaseClient as any).storage.from('study-materials').remove([storagePath]);
  const { error } = await (supabaseClient as any).from('study_set_files').delete().eq('id', id);
  if (error) {
    if (isAbortError(error)) return false;
    console.error('deleteStudySetFile::', error); return false;
  }
  return true;
}

/** Upload a file to the study-materials bucket and return its public URL */
export async function uploadStudyFile(
  userId: string,
  studySetId: string,
  file: File
): Promise<{ path: string; url: string } | null> {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${studySetId}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await (supabaseClient as any).storage
    .from('study-materials')
    .upload(path, file, { upsert: false });

  if (uploadError) { console.error('uploadStudyFile:', uploadError); return null; }

  const { data } = (supabaseClient as any).storage.from('study-materials').getPublicUrl(path);
  return { path, url: data.publicUrl };
}

// ── SAT/ACT Progress ─────────────────────────────────────────
export async function getSatActProgress(userId: string): Promise<SatActProgress[]> {
  const { data, error } = await (supabaseClient as any)
    .from('sat_act_progress')
    .select('*')
    .eq('user_id', userId);
  if (error) {
    if (isAbortError(error)) return [];
    console.error('getSatActProgress::', error); return [];
  }
  return data ?? [];
}

export async function upsertSatActProgress(
  userId: string,
  sectionName: string,
  testType: 'SAT' | 'ACT',
  progressPct: number,
  targetScore?: string
): Promise<SatActProgress | null> {
  const { data, error } = await (supabaseClient as any)
    .from('sat_act_progress')
    .upsert({
      user_id: userId,
      section_name: sectionName,
      test_type: testType,
      progress_pct: progressPct,
      target_score: targetScore ?? null,
    }, { onConflict: 'user_id,section_name' })
    .select()
    .single();
  if (error) {
    if (isAbortError(error)) return null;
    console.error('upsertSatActProgress::', error); return null;
  }
  return data;
}
