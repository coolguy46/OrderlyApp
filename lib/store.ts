import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@supabase/supabase-js';
import type { Task, Goal, StudySession, Exam, Subject, Profile } from '@/lib/supabase/types';
import { supabase } from '@/lib/supabase/client';
import * as db from '@/lib/supabase/services';
import type { FriendWithProfile } from '@/lib/supabase/services';
import { toast } from 'sonner';
import { useScheduleStore } from '@/lib/schedule/store';
import {
  addLocalDays,
  isLocalDate,
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
} from '@/lib/schedule/selectors';
import type { LocalDate, ScheduleRecurrence } from '@/lib/schedule/types';
import {
  AUTH_ACTION_TIMEOUT_MS,
  AUTH_PROFILE_TIMEOUT_MS,
  AUTH_SESSION_TIMEOUT_MS,
  USER_DATA_TIMEOUT_MS,
  errorMessage,
  isAbortLikeError,
  profileFromAuthUser,
  withTimeout,
} from '@/lib/auth/lifecycle';
import type { RegistrationResult } from '@/lib/auth/lifecycle';

// Module-level subscription ref to prevent duplicate listeners
let authSubscription: { unsubscribe: () => void } | null = null;

function nextScheduleDate(
  currentDate: LocalDate,
  recurrence: ScheduleRecurrence,
  recurrenceDays: number[] | null | undefined,
): LocalDate {
  if (recurrence === 'daily') return addLocalDays(currentDate, 1);
  if (recurrence === 'weekly') {
    const days = [...new Set(recurrenceDays || [])]
      .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
    if (days.length === 0) return addLocalDays(currentDate, 7);
    for (let offset = 1; offset <= 7; offset += 1) {
      const candidate = addLocalDays(currentDate, offset);
      if (days.includes(new Date(`${candidate}T12:00:00Z`).getUTCDay())) return candidate;
    }
  }
  if (recurrence === 'monthly') {
    const [year, month, day] = currentDate.split('-').map(Number);
    const targetMonthStart = new Date(Date.UTC(year, month, 1));
    const targetYear = targetMonthStart.getUTCFullYear();
    const targetMonth = targetMonthStart.getUTCMonth();
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)))
      .toISOString()
      .slice(0, 10);
  }
  return currentDate;
}
// Auth initialization is shared across Strict Mode mounts. A boolean alone is
// not enough: a second caller must await the first caller's in-flight work.
let initializationPromise: Promise<void> | null = null;
let initializationDone = false;
let authEventGeneration = 0;

// User hydration runs outside Supabase auth callbacks and is coalesced per
// account. Auth callbacks are awaited by Supabase, so they must stay quick.
const userHydrationPromises = new Map<string, Promise<void>>();

// Full data refreshes may overlap, but an older response must never replace a
// newer one. This avoids the old global queue where one stuck request blocked
// every later refresh (including a different account).
let dataLoadSequence = 0;
const latestDataLoadByUser = new Map<string, number>();

interface ReversibleTaskReceipt {
  ownerUserId: string;
  accessToken: string;
}

const reversibleTaskReceipts = new Map<string, ReversibleTaskReceipt>();
const PENDING_TASK_CLEANUP_KEY = 'orderly-pending-task-cleanups';

function pendingTaskCleanups(): Record<string, string[]> {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PENDING_TASK_CLEANUP_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([userId, ids]) => [
      userId,
      Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
    ]));
  } catch {
    return {};
  }
}

function writePendingTaskCleanups(value: Record<string, string[]>) {
  if (typeof window === 'undefined') return;
  try {
    const compact = Object.fromEntries(Object.entries(value).filter(([, ids]) => ids.length > 0));
    if (Object.keys(compact).length === 0) window.localStorage.removeItem(PENDING_TASK_CLEANUP_KEY);
    else window.localStorage.setItem(PENDING_TASK_CLEANUP_KEY, JSON.stringify(compact));
  } catch {
    // Storage can be unavailable in private browsing. Immediate token-based
    // compensation still runs before this fallback is needed.
  }
}

function queuePendingTaskCleanup(ownerUserId: string, taskId: string) {
  const pending = pendingTaskCleanups();
  pending[ownerUserId] = Array.from(new Set([...(pending[ownerUserId] || []), taskId]));
  writePendingTaskCleanups(pending);
}

async function compensateInterruptedTaskCreation(
  ownerUserId: string,
  taskId: string,
  accessToken: string,
) {
  let deleted = false;
  try {
    deleted = await db.deleteTaskWithAccessToken(taskId, ownerUserId, accessToken);
  } catch {
    deleted = false;
  }
  if (!deleted) queuePendingTaskCleanup(ownerUserId, taskId);
}

async function retryPendingTaskCleanups(ownerUserId: string) {
  const pending = pendingTaskCleanups();
  const taskIds = pending[ownerUserId] || [];
  if (taskIds.length === 0) return;
  const remaining: string[] = [];
  for (const taskId of taskIds) {
    if (!await db.deleteTask(taskId)) remaining.push(taskId);
  }
  pending[ownerUserId] = remaining;
  writePendingTaskCleanups(pending);
}

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  
  // Theme
  theme: Theme;
  
  // User
  user: Profile | null;
  
  // Data
  subjects: Subject[];
  tasks: Task[];
  goals: Goal[];
  studySessions: StudySession[];
  exams: Exam[];
  friends: FriendWithProfile[];
  
  // Pomodoro state
  pomodoroSettings: {
    focusDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    sessionsBeforeLongBreak: number;
  };
  
  // Active study tracking (real-time)
  activeStudySeconds: number;
  activeStudySubjectId: string | null;
  
  // UI state
  sidebarOpen: boolean;
  currentView: string;
  
  // Data loading state
  dataLoaded: boolean;
  dataLoadError: string | null;
  
  // Auth actions
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, fullName?: string) => Promise<RegistrationResult>;
  logout: () => Promise<void>;
  initializeAuth: () => Promise<void>;
  
  // Theme actions
  setTheme: (theme: Theme) => void;
  
  // Data loading
  loadUserData: (userId: string) => Promise<void>;
  refreshData: () => Promise<void>;
  
  // Actions
  setUser: (user: Profile | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setCurrentView: (view: string) => void;
  
  // Task actions
  addTask: (
    task: Omit<Task, 'id' | 'created_at' | 'updated_at'>,
    options?: { reversible?: boolean },
  ) => Promise<Task | null>;
  finalizeTaskCreations: (taskIds: readonly string[]) => void;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string, options?: { silent?: boolean }) => Promise<boolean>;
  completeTask: (id: string) => Promise<void>;
  
  // Goal actions
  addGoal: (goal: Omit<Goal, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<void>;
  deleteGoal: (id: string) => Promise<void>;
  
  // Exam actions
  addExam: (exam: Omit<Exam, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  updateExam: (id: string, updates: Partial<Exam>) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;
  
  // Subject actions
  addSubject: (subject: Omit<Subject, 'id' | 'created_at'>) => Promise<void>;
  updateSubject: (id: string, updates: Partial<Subject>) => Promise<void>;
  deleteSubject: (id: string) => Promise<void>;
  
  // Study session actions
  addStudySession: (session: Omit<StudySession, 'id' | 'created_at'>) => Promise<void>;
  
  // Pomodoro actions
  updatePomodoroSettings: (settings: Partial<AppState['pomodoroSettings']>) => void;
  
  // Active study actions
  setActiveStudy: (seconds: number, subjectId: string | null) => void;
  clearActiveStudy: () => void;
  
  // Canvas sync actions
  removeOrphanedCanvasTasks: (currentCanvasIds: string[]) => Promise<number>;

  // Social actions
  loadFriends: () => Promise<void>;
  sendFriendRequest: (friendId: string) => Promise<boolean>;
  respondToFriendRequest: (friendshipId: string, accept: boolean) => Promise<void>;
  removeFriend: (friendshipId: string) => Promise<void>;
  updateUserProfile: (updates: Partial<Profile>) => Promise<void>;
}

function clearAuthenticatedState() {
  useAppStore.setState({
    isAuthenticated: false,
    user: null,
    tasks: [],
    goals: [],
    studySessions: [],
    exams: [],
    subjects: [],
    friends: [],
    dataLoaded: false,
    dataLoadError: null,
    authError: null,
    isLoading: false,
  });
}

function establishAuthenticatedState(authUser: User) {
  useAppStore.setState((state) => {
    const isSameUser = state.user?.id === authUser.id;
    return {
      isAuthenticated: true,
      user: isSameUser && state.user ? state.user : profileFromAuthUser(authUser),
      isLoading: false,
      authError: null,
      ...(isSameUser
        ? {}
        : {
            tasks: [],
            goals: [],
            studySessions: [],
            exams: [],
            subjects: [],
            friends: [],
            dataLoaded: false,
            dataLoadError: null,
          }),
    };
  });
}

async function hydrateAuthenticatedUser(authUser: User): Promise<void> {
  const existing = userHydrationPromises.get(authUser.id);
  if (existing) return existing;

  const hydration = (async () => {
    try {
      await withTimeout(
        retryPendingTaskCleanups(authUser.id),
        AUTH_PROFILE_TIMEOUT_MS,
        'Interrupted task cleanup',
      );
    } catch (error) {
      // Cleanup is retried on the next sign-in. It must never hold the app's
      // normal data hydration hostage when the network is unhealthy.
      console.error('Deferred task cleanup failed:', error);
    }
    const profilePromise = withTimeout(
      db.getProfile(authUser.id),
      AUTH_PROFILE_TIMEOUT_MS,
      'Profile load',
    );
    const dataPromise = useAppStore.getState().loadUserData(authUser.id);
    const [profileResult, dataResult] = await Promise.allSettled([profilePromise, dataPromise]);

    if (profileResult.status === 'fulfilled' && profileResult.value) {
      if (useAppStore.getState().user?.id === authUser.id) {
        useAppStore.setState({ user: profileResult.value });
      }
    } else if (profileResult.status === 'rejected') {
      console.error('Authenticated profile hydration failed:', profileResult.reason);
    }

    // loadUserData publishes a visible error state before rejecting. Logging
    // here preserves the background failure without producing an unhandled
    // promise rejection.
    if (dataResult.status === 'rejected') {
      console.error('Authenticated data hydration failed:', dataResult.reason);
    }
  })().finally(() => {
    if (userHydrationPromises.get(authUser.id) === hydration) {
      userHydrationPromises.delete(authUser.id);
    }
  });

  userHydrationPromises.set(authUser.id, hydration);
  return hydration;
}

function deferAuthenticatedUserHydration(authUser: User) {
  setTimeout(() => {
    void hydrateAuthenticatedUser(authUser);
  }, 0);
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      isLoading: true,
      authError: null,
      theme: 'light',
      user: null,
      subjects: [],
      tasks: [],
      goals: [],
      studySessions: [],
      exams: [],
      friends: [],
      dataLoaded: false,
      dataLoadError: null,
      
      pomodoroSettings: {
        focusDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
      },
      
      activeStudySeconds: 0,
      activeStudySubjectId: null,
      
      sidebarOpen: true,
      currentView: 'dashboard',
      
      // Initialize auth state
      initializeAuth: async () => {
        if (initializationDone) return;
        if (initializationPromise) return initializationPromise;

        set({ isLoading: true, authError: null });

        // Supabase awaits auth callbacks in registration order. Keep this
        // listener synchronous and defer all network hydration so sign-in and
        // sign-up buttons are never held behind unrelated database reads.
        if (!authSubscription) {
          const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (
              (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')
              && session?.user
            ) {
              authEventGeneration += 1;
              const alreadyHydrated = get().user?.id === session.user.id && get().dataLoaded;
              establishAuthenticatedState(session.user);
              if (!alreadyHydrated) deferAuthenticatedUserHydration(session.user);
            } else if (event === 'SIGNED_OUT' || (event === 'INITIAL_SESSION' && !session)) {
              authEventGeneration += 1;
              clearAuthenticatedState();
            }
          });
          authSubscription = subscription;
        }

        const generationAtStart = authEventGeneration;

        initializationPromise = (async () => {
          try {
            const { data: { session }, error: sessionError } = await withTimeout(
              supabase.auth.getSession(),
              AUTH_SESSION_TIMEOUT_MS,
              'Session check',
            );
            if (sessionError) throw sessionError;

            // The listener may have received a newer sign-in/out event while
            // getSession was in flight. Never overwrite that newer state.
            if (generationAtStart === authEventGeneration) {
              if (session?.user) {
                establishAuthenticatedState(session.user);
                deferAuthenticatedUserHydration(session.user);
              } else {
                clearAuthenticatedState();
              }
            }
            initializationDone = true;
          } catch (error) {
            // If an auth event won the race, its state is authoritative and a
            // stale session request failure should not flash an error.
            if (generationAtStart !== authEventGeneration) {
              initializationDone = true;
              return;
            }

            if (isAbortLikeError(error)) {
              console.warn('Auth initialization was interrupted:', errorMessage(error));
            } else {
              console.error('Error initializing auth:', error);
            }
            set({
              authError: errorMessage(error, 'Unable to check your session.'),
              isLoading: false,
            });
            initializationDone = false;
          } finally {
            initializationPromise = null;
          }
        })();

        return initializationPromise;
      },
      
      // Load all user data from Supabase
      loadUserData: async (userId: string) => {
        const requestId = ++dataLoadSequence;
        latestDataLoadByUser.set(userId, requestId);
        if (get().user?.id === userId) set({ dataLoadError: null });

        const strictRead = { throwOnError: true } as const;
        const [tasks, goals, studySessions, exams, subjects] = await Promise.allSettled([
          withTimeout(db.getTasks(userId, strictRead), USER_DATA_TIMEOUT_MS, 'Task load'),
          withTimeout(db.getGoals(userId, strictRead), USER_DATA_TIMEOUT_MS, 'Goal load'),
          withTimeout(db.getStudySessions(userId, strictRead), USER_DATA_TIMEOUT_MS, 'Study session load'),
          withTimeout(db.getExams(userId, strictRead), USER_DATA_TIMEOUT_MS, 'Exam load'),
          withTimeout(db.getSubjects(userId, strictRead), USER_DATA_TIMEOUT_MS, 'Subject load'),
        ]);

        const results = [tasks, goals, studySessions, exams, subjects];
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(result => errorMessage(result.reason));
        const failureMessage = failures.length > 0
          ? `Some account data could not be loaded: ${failures.join('; ')}`
          : null;

        const isLatestRequest = latestDataLoadByUser.get(userId) === requestId;
        if (get().user?.id === userId && isLatestRequest) {
          const updates: Partial<AppState> = {
            dataLoaded: failures.length === 0,
            dataLoadError: failureMessage,
          };
          if (tasks.status === 'fulfilled') updates.tasks = tasks.value;
          if (goals.status === 'fulfilled') updates.goals = goals.value;
          if (studySessions.status === 'fulfilled') updates.studySessions = studySessions.value;
          if (exams.status === 'fulfilled') updates.exams = exams.value;
          if (subjects.status === 'fulfilled') updates.subjects = subjects.value;
          set(updates);
        }

        if (failureMessage) {
          const error = new Error(failureMessage);
          if (failures.some(message => message.toLowerCase().includes('abort'))) {
            console.warn('Account data load was interrupted:', failureMessage);
          } else {
            console.error('Error loading account data:', error);
          }
          throw error;
        }
      },
      
      // Refresh data from database
      refreshData: async () => {
        const user = get().user;
        if (user) {
          await get().loadUserData(user.id);
        }
      },
      
      // Auth actions
      login: async (email: string, password: string) => {
        try {
          const { user } = await withTimeout(
            db.signIn(email, password),
            AUTH_ACTION_TIMEOUT_MS,
            'Sign in',
          );
          if (user) {
            establishAuthenticatedState(user);
            deferAuthenticatedUserHydration(user);
            return true;
          }
          return false;
        } catch (error) {
          console.error('Login error:', error);
          throw error;
        }
      },
      
      register: async (email: string, password: string, fullName?: string) => {
        try {
          const { user, session } = await withTimeout(
            db.signUp(email, password, fullName),
            AUTH_ACTION_TIMEOUT_MS,
            'Account creation',
          );
          if (session?.user) {
            establishAuthenticatedState(session.user);
            deferAuthenticatedUserHydration(session.user);
            return 'authenticated';
          }
          if (user) {
            // Email-confirmation projects return a user but no usable session.
            // Do not pretend the account is signed in or send it into an auth
            // redirect loop.
            clearAuthenticatedState();
            return 'confirmation-required';
          }
          return 'failed';
        } catch (error) {
          console.error('Registration error:', error);
          throw error;
        }
      },
      
      logout: async () => {
        try {
          await withTimeout(db.signOut(), AUTH_ACTION_TIMEOUT_MS, 'Sign out');
          authEventGeneration += 1;
          clearAuthenticatedState();
        } catch (error) {
          console.error('Logout error:', error);
          toast.error(errorMessage(error, 'Could not sign out. Please try again.'));
        }
      },
      
      // Theme actions
      setTheme: (theme) => set({ theme }),
      
      // Actions
      setUser: (user) => set({ user }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setCurrentView: (view) => set({ currentView: view }),
      
      // Task actions
      addTask: async (taskData, options) => {
        const user = get().user;
        if (!user) return null;

        let reversibleAccessToken = '';
        if (options?.reversible) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user.id !== user.id) return null;
          reversibleAccessToken = session.access_token;
        }

        // Generate the remote primary key before the request. If the insert is
        // committed but its response is lost, compensation can still target
        // the exact row instead of leaving an unidentifiable orphan behind.
        const taskId = crypto.randomUUID();
        
        try {
          const newTask = await db.createTask({
            ...taskData,
            user_id: user.id,
            id: taskId,
          });

          if (!newTask && options?.reversible && reversibleAccessToken) {
            await compensateInterruptedTaskCreation(user.id, taskId, reversibleAccessToken);
          }
          
          if (newTask && options?.reversible && reversibleAccessToken) {
            reversibleTaskReceipts.set(newTask.id, {
              ownerUserId: user.id,
              accessToken: reversibleAccessToken,
            });
          }

          if (newTask && get().user?.id === user.id) {
            set((state) => ({ tasks: [newTask, ...state.tasks] }));
            toast.success('Task created');
          } else if (!newTask && get().user?.id === user.id) {
            toast.error('Failed to create task');
          }
          
          return newTask;
        } catch (error) {
          if (options?.reversible && reversibleAccessToken) {
            await compensateInterruptedTaskCreation(user.id, taskId, reversibleAccessToken);
          }
          toast.error('Failed to create task');
          return null;
        }
      },

      finalizeTaskCreations: (taskIds) => {
        for (const taskId of taskIds) reversibleTaskReceipts.delete(taskId);
      },
      
      updateTask: async (id, updates) => {
        const result = await db.updateTask(id, updates);
        if (result) {
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === id ? { ...task, ...result } : task
            ),
          }));
        }
      },
      
      deleteTask: async (id, options) => {
        const activeUserId = get().user?.id || null;
        const receipt = reversibleTaskReceipts.get(id);
        const ownerUserId = receipt?.ownerUserId || activeUserId;
        try {
          const success = receipt && activeUserId !== receipt.ownerUserId
            ? await db.deleteTaskWithAccessToken(id, receipt.ownerUserId, receipt.accessToken)
            : await db.deleteTask(id);
          if (success) {
            reversibleTaskReceipts.delete(id);
            if (ownerUserId && get().user?.id === ownerUserId) {
              set((state) => ({
                tasks: state.tasks.filter((task) => task.id !== id),
              }));
              useScheduleStore.getState().removeTaskSchedule(ownerUserId, id);
              if (!options?.silent) toast.success('Task deleted');
            }
            return true;
          }
          if (receipt) queuePendingTaskCleanup(receipt.ownerUserId, id);
          if (!options?.silent && get().user?.id === ownerUserId) toast.error('Failed to delete task');
          return false;
        } catch (error) {
          if (receipt) queuePendingTaskCleanup(receipt.ownerUserId, id);
          if (!options?.silent && get().user?.id === ownerUserId) toast.error('Failed to delete task');
          return false;
        }
      },
      
      completeTask: async (id) => {
        try {
          const result = await db.completeTask(id);
          const user = get().user;
          
          if (result) {
            set((state) => ({
              tasks: state.tasks.map((task) =>
                task.id === id ? result : task
              ),
            }));
            toast.success('Task completed! 🎉');
            
            // Auto-create next occurrence for recurring tasks
            const completedTask = get().tasks.find((t) => t.id === id) || result;
            if (completedTask.recurrence && completedTask.recurrence !== 'none') {
              const scheduleState = useScheduleStore.getState();
              const completedSchedule = scheduleState.entriesByUser[completedTask.user_id]?.[id] || null;
              const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
              const currentDue = completedTask.due_date ? new Date(completedTask.due_date) : new Date();
              let nextDue: Date;
              switch (completedTask.recurrence) {
                case 'daily':
                  nextDue = new Date(currentDue);
                  nextDue.setDate(nextDue.getDate() + 1);
                  break;
                case 'weekly': {
                  const days = completedTask.recurrence_days;
                  if (days && days.length > 0) {
                    // Find the next matching weekday
                    nextDue = new Date(currentDue);
                    nextDue.setDate(nextDue.getDate() + 1); // start from tomorrow
                    for (let i = 0; i < 7; i++) {
                      if (days.includes(nextDue.getDay())) break;
                      nextDue.setDate(nextDue.getDate() + 1);
                    }
                  } else {
                    nextDue = new Date(currentDue);
                    nextDue.setDate(nextDue.getDate() + 7);
                  }
                  break;
                }
                case 'monthly':
                  nextDue = new Date(currentDue);
                  nextDue.setMonth(nextDue.getMonth() + 1);
                  break;
                default:
                  nextDue = currentDue;
              }

              const scheduleRecurrence: ScheduleRecurrence = completedSchedule?.recurrence
                && completedSchedule.recurrence !== 'none'
                ? completedSchedule.recurrence
                : completedTask.recurrence;
              const currentScheduleDate = completedSchedule?.scheduledDate
                && isLocalDate(completedSchedule.scheduledDate)
                ? completedSchedule.scheduledDate
                : localDateFromIso(currentDue.toISOString(), timeZone);
              const nextScheduleDateKey = currentScheduleDate
                ? nextScheduleDate(
                    currentScheduleDate,
                    scheduleRecurrence,
                    completedSchedule?.recurrenceDays || completedTask.recurrence_days,
                  )
                : null;
              const boundedSeriesFinished = Boolean(
                completedSchedule?.recurrenceEndDate
                && nextScheduleDateKey
                && nextScheduleDateKey > completedSchedule.recurrenceEndDate,
              );

              if (!boundedSeriesFinished) {
                const nextTask = await db.createTask({
                  user_id: completedTask.user_id,
                  title: completedTask.title,
                  description: completedTask.description,
                  priority: completedTask.priority,
                  status: 'pending',
                  subject_id: completedTask.subject_id,
                  // A repeating scheduled activity without a deadline should
                  // stay deadline-free when its next occurrence is created.
                  due_date: completedTask.due_date || !completedSchedule
                    ? nextDue.toISOString()
                    : null,
                  due_time: completedTask.due_time || null,
                  recurrence: completedTask.recurrence,
                  recurrence_days: completedTask.recurrence_days || null,
                  completed_at: null,
                });

                if (nextTask) {
                  set((state) => ({ tasks: [nextTask, ...state.tasks] }));

                  if (completedSchedule && nextScheduleDateKey) {
                    const startTime = completedSchedule.startAt
                      ? localTimeFromIso(completedSchedule.startAt, timeZone)
                      : null;
                    const nextStartAt = startTime
                      ? localDateTimeToIso(nextScheduleDateKey, `${startTime}:00`, timeZone)
                      : null;
                    scheduleState.upsertTaskSchedule(completedTask.user_id, nextTask.id, {
                      scheduledDate: nextScheduleDateKey,
                      startAt: nextStartAt,
                      durationSeconds: completedSchedule.durationSeconds,
                      recurrence: scheduleRecurrence,
                      recurrenceDays: completedSchedule.recurrenceDays || completedTask.recurrence_days,
                      recurrenceEndDate: completedSchedule.recurrenceEndDate,
                    });
                    for (const [sourceDate, override] of Object.entries(completedSchedule.occurrenceOverrides)) {
                      if (sourceDate >= nextScheduleDateKey) {
                        scheduleState.setOccurrenceOverride(
                          completedTask.user_id,
                          nextTask.id,
                          sourceDate,
                          override,
                        );
                      }
                    }
                  }

                  toast.success(`Next ${completedTask.recurrence} task created`);
                }
              }
            }
            
            // Update user stats
            if (user) {
              const updatedProfile = await db.updateProfile(user.id, {
                tasks_completed: user.tasks_completed + 1,
              });
              if (updatedProfile) {
                set({ user: updatedProfile });
              }
            }
          }
        } catch (error) {
          toast.error('Failed to complete task');
        }
      },
      
      // Goal actions
      addGoal: async (goalData) => {
        const user = get().user;
        if (!user) return;
        
        try {
          const newGoal = await db.createGoal({
            ...goalData,
            user_id: user.id,
          });
          
          if (newGoal) {
            set((state) => ({ goals: [newGoal, ...state.goals] }));
            toast.success('Goal created');
          }
        } catch (error) {
          toast.error('Failed to create goal');
        }
      },
      
      updateGoal: async (id, updates) => {
        const result = await db.updateGoal(id, updates);
        if (result) {
          set((state) => ({
            goals: state.goals.map((goal) =>
              goal.id === id ? { ...goal, ...result } : goal
            ),
          }));
        }
      },
      
      deleteGoal: async (id) => {
        try {
          const success = await db.deleteGoal(id);
          if (success) {
            set((state) => ({
              goals: state.goals.filter((goal) => goal.id !== id),
            }));
            toast.success('Goal deleted');
          }
        } catch (error) {
          toast.error('Failed to delete goal');
        }
      },
      
      // Exam actions
      addExam: async (examData) => {
        const user = get().user;
        if (!user) return;
        
        try {
          const newExam = await db.createExam({
            ...examData,
            user_id: user.id,
          });
          
          if (newExam) {
            set((state) => ({ exams: [...state.exams, newExam] }));
            toast.success('Exam added');
          }
        } catch (error) {
          toast.error('Failed to add exam');
        }
      },
      
      updateExam: async (id, updates) => {
        const result = await db.updateExam(id, updates);
        if (result) {
          set((state) => ({
            exams: state.exams.map((exam) =>
              exam.id === id ? { ...exam, ...result } : exam
            ),
          }));
        }
      },
      
      deleteExam: async (id) => {
        try {
          const success = await db.deleteExam(id);
          if (success) {
            set((state) => ({
              exams: state.exams.filter((exam) => exam.id !== id),
            }));
            toast.success('Exam deleted');
          }
        } catch (error) {
          toast.error('Failed to delete exam');
        }
      },
      
      // Subject actions
      addSubject: async (subjectData) => {
        const user = get().user;
        if (!user) return;
        
        try {
          const newSubject = await db.createSubject({
            ...subjectData,
            user_id: user.id,
          });
          
          if (newSubject) {
            set((state) => ({ subjects: [...state.subjects, newSubject] }));
            toast.success('Subject created');
          }
        } catch (error) {
          toast.error('Failed to create subject');
        }
      },
      
      updateSubject: async (id, updates) => {
        const result = await db.updateSubject(id, updates);
        if (result) {
          set((state) => ({
            subjects: state.subjects.map((subject) =>
              subject.id === id ? { ...subject, ...result } : subject
            ),
          }));
        }
      },
      
      deleteSubject: async (id) => {
        try {
          const success = await db.deleteSubject(id);
          if (success) {
            set((state) => ({
              subjects: state.subjects.filter((subject) => subject.id !== id),
            }));
            toast.success('Subject deleted');
          }
        } catch (error) {
          toast.error('Failed to delete subject');
        }
      },
      
      // Study session actions
      addStudySession: async (sessionData) => {
        const user = get().user;
        if (!user) return;
        
        try {
          const newSession = await db.createStudySession({
            ...sessionData,
            user_id: user.id,
          });
          
          if (newSession) {
            set((state) => ({
              studySessions: [newSession, ...state.studySessions],
            }));
            toast.success('Study session saved! 📚');
            
            // Update user's total study time
            const updatedProfile = await db.updateProfile(user.id, {
              total_study_time: user.total_study_time + sessionData.duration_minutes,
            });
            if (updatedProfile) {
              set({ user: updatedProfile });
            }
          } else {
            // DB insert returned null - save locally so analytics still work
            console.error('Study session DB insert returned null - saving locally');
            const fallbackSession = {
              id: crypto.randomUUID(),
              ...sessionData,
              user_id: user.id,
              created_at: new Date().toISOString(),
            };
            set((state) => ({
              studySessions: [fallbackSession, ...state.studySessions],
            }));
            toast.warning('Session saved locally (database sync failed)');
          }
        } catch (error) {
          console.error('Failed to save study session:', error);
          // Still save locally as fallback
          const fallbackSession = {
            id: crypto.randomUUID(),
            ...sessionData,
            user_id: user.id,
            created_at: new Date().toISOString(),
          };
          set((state) => ({
            studySessions: [fallbackSession, ...state.studySessions],
          }));
          toast.error('Session saved locally (database error)');
        }
      },
      
      // Pomodoro actions
      updatePomodoroSettings: (settings) => {
        set((state) => ({
          pomodoroSettings: { ...state.pomodoroSettings, ...settings },
        }));
      },
      
      // Active study actions
      setActiveStudy: (seconds, subjectId) => {
        set({ activeStudySeconds: seconds, activeStudySubjectId: subjectId });
      },
      clearActiveStudy: () => {
        set({ activeStudySeconds: 0, activeStudySubjectId: null });
      },
      
      // Canvas sync - remove tasks that no longer exist in Canvas
      removeOrphanedCanvasTasks: async (currentCanvasIds: string[]) => {
        const user = get().user;
        if (!user) return 0;
        const staleTaskIds = get().tasks
          .filter((task) => task.source === 'canvas' && task.external_id && !currentCanvasIds.includes(task.external_id))
          .map((task) => task.id);
        
        const removedCount = await db.removeOrphanedCanvasTasks(user.id, currentCanvasIds);
        
        if (removedCount > 0) {
          useScheduleStore.getState().clearTaskSchedules(user.id, staleTaskIds);
          // Refresh tasks from database
          const tasks = await db.getTasks(user.id);
          set({ tasks });
        }
        
        return removedCount;
      },

      // Social actions
      loadFriends: async () => {
        const user = get().user;
        if (!user) return;
        const friends = await db.getFriends(user.id);
        set({ friends });
      },

      sendFriendRequest: async (friendId: string) => {
        const user = get().user;
        if (!user) return false;
        try {
          const success = await db.sendFriendRequest(user.id, friendId);
          if (success) {
            toast.success('Friend request sent!');
            await get().loadFriends();
          }
          return success;
        } catch (error) {
          toast.error('Failed to send friend request');
          return false;
        }
      },

      respondToFriendRequest: async (friendshipId: string, accept: boolean) => {
        try {
          const success = await db.respondToFriendRequest(friendshipId, accept);
          if (success) {
            toast.success(accept ? 'Friend request accepted!' : 'Friend request declined');
            await get().loadFriends();
          }
        } catch (error) {
          toast.error('Failed to respond to request');
        }
      },

      removeFriend: async (friendshipId: string) => {
        try {
          const success = await db.removeFriend(friendshipId);
          if (success) {
            toast.success('Friend removed');
            set((state) => ({
              friends: state.friends.filter((f) => f.id !== friendshipId),
            }));
          }
        } catch (error) {
          toast.error('Failed to remove friend');
        }
      },

      updateUserProfile: async (updates: Partial<Profile>) => {
        const user = get().user;
        if (!user) return;
        try {
          const updatedProfile = await db.updateProfile(user.id, updates);
          if (updatedProfile) {
            set({ user: updatedProfile });
            toast.success('Profile updated');
          }
        } catch (error) {
          toast.error('Failed to update profile');
        }
      },
    }),
    {
      name: 'orderly-app-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist UI preferences and settings locally
        theme: state.theme,
        pomodoroSettings: state.pomodoroSettings,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);
