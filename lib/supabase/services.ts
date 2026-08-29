// Supabase Service Functions for Database Operations
import {
  supabase,
  isSupabaseAvailable,
  supabasePublishableKey,
  supabaseUrl,
} from './client';
import type { 
  Profile, 
  Subject, 
  Task, 
  Goal, 
  StudySession, 
  Exam,
  Friendship,
} from './types';
import { AUTH_ACTION_TIMEOUT_MS, authCallbackUrl, withTimeout } from '@/lib/auth/lifecycle';
import { deleteOwnedTaskWithToken } from './task-compensation';

// Use the supabase client with any to bypass strict typing issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ReadOptions {
  /** Startup hydration uses this so a failed query cannot look like empty data. */
  throwOnError?: boolean;
}

function readFailure<T>(
  context: string,
  error: unknown,
  fallback: T,
  options?: ReadOptions,
): T {
  console.error(context, error);
  if (options?.throwOnError) throw error;
  return fallback;
}

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

export async function getProfile(userId: string, options?: ReadOptions): Promise<Profile | null> {
  
  
  const { data, error } = await db
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error) {
    return readFailure('Error fetching profile:', error, null, options);
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

export async function getSubjects(userId: string, options?: ReadOptions): Promise<Subject[]> {
  
  
  const { data, error } = await db
    .from('subjects')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  
  if (error) {
    return readFailure('Error fetching subjects:', error, [], options);
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

export async function getTasks(userId: string, options?: ReadOptions): Promise<Task[]> {
  
  
  const { data, error } = await db
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return readFailure('Error fetching tasks:', error, [], options);
  }
  return (data || []) as Task[];
}

type CreateTaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at'> & { id?: string };

export async function createTask(task: CreateTaskInput): Promise<Task | null> {
  // Strip undefined values and only send fields that have values
  const cleanTask: Record<string, unknown> = {
    // The browser owns the ID so an interrupted response can still be
    // compensated precisely. Upserting this stable ID also makes a retried
    // request idempotent instead of creating a second remote row.
    id: task.id || crypto.randomUUID(),
  };
  for (const [key, value] of Object.entries(task)) {
    if (value !== undefined) {
      cleanTask[key] = value;
    }
  }
  
  const { data, error } = await db
    .from('tasks')
    .upsert(cleanTask, { onConflict: 'id' })
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
    .eq('id', id)
    .select('id');
  
  if (error) {
    console.error('Error deleting task:', error);
    return false;
  }
  // DELETE is idempotent. Supabase returns an empty representation when a
  // retry finds the row already gone; that is a completed cleanup, not a
  // failure that should remain queued forever.
  return true;
}

/**
 * Compensates a reversible task creation after the active browser account has
 * changed. The short-lived access token belongs to the account that created
 * the row, so RLS still verifies ownership instead of allowing a new account
 * to delete another user's data.
 */
export async function deleteTaskWithAccessToken(
  id: string,
  ownerUserId: string,
  accessToken: string,
): Promise<boolean> {
  if (!isSupabaseAvailable() || !accessToken) return false;
  return deleteOwnedTaskWithToken({
    supabaseUrl,
    publishableKey: supabasePublishableKey,
    taskId: id,
    ownerUserId,
    accessToken,
  });
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

export async function getGoals(userId: string, options?: ReadOptions): Promise<Goal[]> {
  
  
  const { data, error } = await db
    .from('goals')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) {
    return readFailure('Error fetching goals:', error, [], options);
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

export async function getStudySessions(userId: string, options?: ReadOptions): Promise<StudySession[]> {
  
  
  const { data, error } = await db
    .from('study_sessions')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false });
  
  if (error) {
    return readFailure('Error fetching study sessions:', error, [], options);
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

export async function getExams(userId: string, options?: ReadOptions): Promise<Exam[]> {
  
  
  const { data, error } = await db
    .from('exams')
    .select('*')
    .eq('user_id', userId)
    .order('exam_date', { ascending: true });
  
  if (error) {
    return readFailure('Error fetching exams:', error, [], options);
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
  last_background_sync_at: string | null;
  sync_enabled: boolean;
  auto_import_assignments: boolean;
  auto_sync_interval?: number;
  sync_interval_migrated: boolean;
  time_zone?: string;
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
  last_background_sync_at?: string | null;
  sync_enabled?: boolean;
  auto_import_assignments?: boolean;
  auto_sync_interval?: number;
  sync_interval_migrated?: boolean;
  time_zone?: string;
}): Promise<CanvasSettings | null> {
  // Most callers send a partial settings patch. PostgreSQL validates NOT NULL
  // columns before ON CONFLICT can update an existing row, so a traditional
  // partial upsert can fail merely because `ical_url` was omitted. Update an
  // existing row first, and only insert when this is genuinely a new user.
  const { data: updated, error: updateError } = await db
    .from('canvas_settings')
    .update(settings)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  if (updateError) {
    console.error('Error updating canvas settings:', updateError);
    return null;
  }
  if (updated) return updated as CanvasSettings;

  if (!settings.ical_url) {
    console.error('Cannot create Canvas settings without an iCal URL.');
    return null;
  }

  const { data: inserted, error: insertError } = await db
    .from('canvas_settings')
    .insert({ user_id: userId, ...settings })
    .select('*')
    .single();

  if (!insertError) return inserted as CanvasSettings;

  // Another request may have inserted the row after our update found none.
  // Retry the requested patch against that winning row.
  if (insertError.code === '23505') {
    const { data: retried, error: retryError } = await db
      .from('canvas_settings')
      .update(settings)
      .eq('user_id', userId)
      .select('*')
      .single();
    if (!retryError) return retried as CanvasSettings;
    console.error('Error retrying canvas settings update:', retryError);
    return null;
  }

  console.error('Error inserting canvas settings:', insertError);
  return null;
}

/**
 * Creates the initial settings row without overwriting a row created by a
 * competing browser. This protects the first database-backed interval from a
 * stale session during the one-time localStorage migration.
 */
export async function initializeCanvasSettings(userId: string, settings: {
  ical_url: string;
  last_sync_at?: string | null;
  last_background_sync_at?: string | null;
  sync_enabled?: boolean;
  auto_import_assignments?: boolean;
  auto_sync_interval?: number;
  sync_interval_migrated?: boolean;
  time_zone?: string;
}): Promise<CanvasSettings | null> {
  const { data, error } = await db
    .from('canvas_settings')
    .insert({ user_id: userId, ...settings })
    .select('*')
    .single();

  if (!error) return data as CanvasSettings;
  if (error.code === '23505') return getCanvasSettings(userId);

  console.error('Error initializing canvas settings:', error);
  return null;
}

/**
 * Claims the one-time browser-to-database interval migration for a user.
 *
 * The `sync_interval_migrated = false` filter makes this a compare-and-set:
 * when two old browser sessions race, only the first one may copy its legacy
 * localStorage preference. Every later session reads the already-authoritative
 * database value instead of overwriting it.
 */
export async function migrateCanvasSyncInterval(
  userId: string,
  legacyInterval: number,
  timeZone: string
): Promise<CanvasSettings | null> {
  const updates: {
    sync_interval_migrated: boolean;
    time_zone: string;
    auto_sync_interval?: number;
  } = {
    sync_interval_migrated: true,
    time_zone: timeZone,
    auto_sync_interval: legacyInterval,
  };

  const { data, error } = await db
    .from('canvas_settings')
    .update(updates)
    .eq('user_id', userId)
    .eq('sync_interval_migrated', false)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('Error migrating Canvas sync interval:', error);
    return null;
  }

  // No returned row means another browser already won the migration race.
  // Read that winner's value and keep it authoritative.
  return (data as CanvasSettings | null) || getCanvasSettings(userId);
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

export async function getFriends(userId: string, options?: ReadOptions): Promise<FriendWithProfile[]> {
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
    return readFailure('Error fetching friendships:', sentError || recvError, [], options);
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
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const { data, error } = await withTimeout(
    db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authCallbackUrl(process.env.NEXT_PUBLIC_SITE_URL, currentOrigin),
      },
    }) as Promise<{ data: unknown; error: Error | null }>,
    AUTH_ACTION_TIMEOUT_MS,
    'Google sign in',
  );

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
