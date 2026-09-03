import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { User } from '@supabase/supabase-js';
import type { Task, Goal, StudySession, NewStudySession, Exam, Subject, Profile } from '@/lib/supabase/types';
import { isSupabaseAvailable, supabase } from '@/lib/supabase/client';
import * as db from '@/lib/supabase/services';
import type { FriendWithProfile } from '@/lib/supabase/services';
import type { EditableProfileFields } from '@/lib/supabase/services';
import { toast } from 'sonner';
import { useScheduleStore } from '@/lib/schedule/store';
import { usePlannerStore } from '@/lib/planner/store';
import { scheduleEntriesFromTasks } from '@/lib/schedule/persistence';
import { loadPlannerPersistenceSnapshot } from '@/lib/planner/persistence-client';
import { removeUserScopedStorageValues } from '@/lib/user-scoped-storage';
import {
  isLocalDate,
  localDateFromIso,
  localDateTimeToIso,
  localTimeFromIso,
  nextLocalRecurrenceDate,
} from '@/lib/schedule/selectors';
import type { ScheduleRecurrence } from '@/lib/schedule/types';
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
import {
  isCurrentAccountRequest,
  isRepeatingTaskSeries,
  prependUniqueRecordById,
  registrationOutcomeFromSignUp,
  runBestEffortAccountCleanup,
  transitionAccountSessionFence,
} from '@/lib/store-account-safety';
import { resolveTaskCompletionTimeZone } from '@/lib/task-completion-time-zone';

// Module-level subscription ref to prevent duplicate listeners
let authSubscription: { unsubscribe: () => void } | null = null;
// Avoid duplicate completion work in a single browser process. The database
// transaction and row lock in services.ts are the cross-tab/source-of-truth guard.
const taskCompletionsInFlight = new Set<string>();
let accountSessionFence = { userId: null as string | null, generation: 0 };

function transitionAccountSession(userId: string | null): void {
  accountSessionFence = transitionAccountSessionFence(accountSessionFence, userId);
  useScheduleStore.getState().setActiveUser(userId);
  usePlannerStore.getState().setActiveUser(
    userId,
    userId && typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined,
  );
}

// Auth initialization is shared across Strict Mode mounts. A boolean alone is
// not enough: a second caller must await the first caller's in-flight work.
let initializationPromise: Promise<void> | null = null;

function isStoreRequestCurrent(
  activeStoreUserId: string | null,
  requestUserId: string,
  requestGeneration: number,
): boolean {
  return activeStoreUserId === requestUserId && isCurrentAccountRequest(
    accountSessionFence.userId,
    accountSessionFence.generation,
    requestUserId,
    requestGeneration,
  );
}

function requestErrorDetails(error: unknown): { name?: string; message?: string } {
  return error && typeof error === 'object'
    ? error as { name?: string; message?: string }
    : {};
}

function clearLocalAccountData(userId: string | null | undefined): void {
  if (!userId) return;
  const cleanupSteps: Array<() => void> = [
    () => usePlannerStore.getState().clearUserPlannerData(userId),
    () => useScheduleStore.getState().clearTaskSchedules(userId),
  ];
  if (typeof window !== 'undefined') {
    cleanupSteps.push(
      () => removeUserScopedStorageValues(window.localStorage, userId),
      () => window.localStorage.removeItem(`canvas_sync_interval_${userId}`),
    );
  }
  runBestEffortAccountCleanup(cleanupSteps, (error, index) => {
    console.warn(`Local account cleanup step ${index + 1} failed:`, error);
  });
}

function emptyAccountSnapshot() {
  return {
    tasks: [] as Task[],
    goals: [] as Goal[],
    studySessions: [] as StudySession[],
    exams: [] as Exam[],
    subjects: [] as Subject[],
    friends: [] as FriendWithProfile[],
    dataLoaded: false,
    dataLoadError: null,
    activeStudySeconds: 0,
    activeStudySubjectId: null,
  };
}

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
  updateTask: (id: string, updates: Partial<Task>) => Promise<boolean>;
  deleteTask: (id: string, options?: { silent?: boolean }) => Promise<boolean>;
  completeTask: (id: string) => Promise<boolean>;
  
  // Goal actions
  addGoal: (goal: Omit<Goal, 'id' | 'created_at' | 'updated_at'>) => Promise<boolean>;
  updateGoal: (id: string, updates: Partial<Goal>) => Promise<boolean>;
  deleteGoal: (id: string) => Promise<void>;
  
  // Exam actions
  addExam: (exam: Omit<Exam, 'id' | 'created_at' | 'updated_at'>) => Promise<boolean>;
  updateExam: (id: string, updates: Partial<Exam>) => Promise<boolean>;
  deleteExam: (id: string) => Promise<void>;
  
  // Subject actions
  addSubject: (subject: Omit<Subject, 'id' | 'created_at'>) => Promise<Subject | null>;
  updateSubject: (id: string, updates: Partial<Subject>) => Promise<void>;
  deleteSubject: (id: string) => Promise<void>;
  
  // Study session actions
  addStudySession: (session: NewStudySession) => Promise<boolean>;
  
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
  updateUserProfile: (updates: Partial<EditableProfileFields>) => Promise<Profile | null>;
}

function clearAuthenticatedState() {
  const previousUserId = useAppStore.getState().user?.id;
  transitionAccountSession(null);
  clearLocalAccountData(previousUserId);
  useAppStore.setState({
    isAuthenticated: false,
    user: null,
    ...emptyAccountSnapshot(),
    authError: null,
    isLoading: false,
  });
}

function establishAuthenticatedState(authUser: User) {
  const previousUserId = useAppStore.getState().user?.id;
  transitionAccountSession(authUser.id);
  if (previousUserId && previousUserId !== authUser.id) {
    clearLocalAccountData(previousUserId);
  }
  useAppStore.setState((state) => {
    const isSameUser = state.user?.id === authUser.id;
    return {
      isAuthenticated: true,
      user: isSameUser && state.user ? state.user : profileFromAuthUser(authUser),
      isLoading: false,
      authError: null,
      ...(isSameUser
        ? {}
        : emptyAccountSnapshot()),
    };
  });
}

async function hydrateAuthenticatedUser(authUser: User, requestGeneration: number): Promise<void> {
  const hydrationKey = `${authUser.id}:${requestGeneration}`;
  const existing = userHydrationPromises.get(hydrationKey);
  if (existing) return existing;

  const requestIsCurrent = () => isStoreRequestCurrent(
    useAppStore.getState().user?.id || null,
    authUser.id,
    requestGeneration,
  );
  if (!requestIsCurrent()) return;

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
    if (!requestIsCurrent()) return;
    const profilePromise = withTimeout(
      db.getProfile(authUser.id),
      AUTH_PROFILE_TIMEOUT_MS,
      'Profile load',
    );
    const dataPromise = useAppStore.getState().loadUserData(authUser.id);
    const [profileResult, dataResult] = await Promise.allSettled([profilePromise, dataPromise]);

    if (profileResult.status === 'fulfilled' && profileResult.value) {
      if (requestIsCurrent()) {
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
    if (userHydrationPromises.get(hydrationKey) === hydration) {
      userHydrationPromises.delete(hydrationKey);
    }
  });

  userHydrationPromises.set(hydrationKey, hydration);
  return hydration;
}

function deferAuthenticatedUserHydration(authUser: User) {
  const requestGeneration = accountSessionFence.generation;
  setTimeout(() => {
    void hydrateAuthenticatedUser(authUser, requestGeneration);
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

        // A missing backend configuration must behave like a signed-out app.
        // In particular, do not initialize auth against a placeholder origin.
        if (!isSupabaseAvailable()) {
          clearAuthenticatedState();
          initializationDone = true;
          return;
        }

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
        const requestedUserId = userId;
        const requestGeneration = accountSessionFence.generation;
        const requestId = ++dataLoadSequence;
        latestDataLoadByUser.set(requestedUserId, requestId);
        const requestIsCurrent = () => (
          isStoreRequestCurrent(
            get().user?.id || null,
            requestedUserId,
            requestGeneration,
          )
          && latestDataLoadByUser.get(requestedUserId) === requestId
        );
        if (!requestIsCurrent()) return;
        set({ dataLoadError: null });

        // A local schedule/planner edit may complete its server write while
        // this older SELECT is still in flight. Monotonic revisions prevent
        // that stale response from replacing the just-saved local state.
        const scheduleRevisionAtStart = useScheduleStore.getState()
          .nextRevisionByUser[requestedUserId] || 0;
        const plannerRevisionAtStart = usePlannerStore.getState()
          .nextRevisionByUser[requestedUserId] || 0;

        const plannerSnapshotRequest = withTimeout(
          loadPlannerPersistenceSnapshot(requestedUserId),
          USER_DATA_TIMEOUT_MS,
          'Planner load',
        ).catch((error: unknown) => {
          // Planner tables are an additive deployment. A failed planner read
          // must not erase the local/offline cache or block core account data.
          console.warn('Could not hydrate planner data; keeping the local cache.', error);
          return null;
        });
        const strictRead = { throwOnError: true } as const;
        const [tasks, goals, studySessions, exams, subjects] = await Promise.allSettled([
          withTimeout(db.getTasks(requestedUserId, strictRead), USER_DATA_TIMEOUT_MS, 'Task load'),
          withTimeout(db.getGoals(requestedUserId, strictRead), USER_DATA_TIMEOUT_MS, 'Goal load'),
          withTimeout(
            db.getStudySessions(requestedUserId, strictRead),
            USER_DATA_TIMEOUT_MS,
            'Study session load',
          ),
          withTimeout(db.getExams(requestedUserId, strictRead), USER_DATA_TIMEOUT_MS, 'Exam load'),
          withTimeout(db.getSubjects(requestedUserId, strictRead), USER_DATA_TIMEOUT_MS, 'Subject load'),
        ]);
        const plannerSnapshot = await plannerSnapshotRequest;

        const results = [tasks, goals, studySessions, exams, subjects];
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map(result => errorMessage(result.reason));
        const failureMessage = failures.length > 0
          ? `Some account data could not be loaded: ${failures.join('; ')}`
          : null;

        // A sign-out, account switch, or newer refresh may finish while these
        // requests are in flight. Never publish stale data into a later state.
        if (requestIsCurrent()) {
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

          const scheduleState = useScheduleStore.getState();
          if (tasks.status === 'fulfilled') {
            if (
              (scheduleState.nextRevisionByUser[requestedUserId] || 0)
              === scheduleRevisionAtStart
            ) {
              scheduleState.hydrateUserSchedules(
                requestedUserId,
                scheduleEntriesFromTasks(tasks.value, requestedUserId),
              );
            } else {
              scheduleState.retryPendingSchedules(requestedUserId);
            }
          } else {
            scheduleState.retryPendingSchedules(requestedUserId);
          }

          const plannerState = usePlannerStore.getState();
          if (plannerSnapshot) {
            if (
              (plannerState.nextRevisionByUser[requestedUserId] || 0)
              === plannerRevisionAtStart
            ) {
              plannerState.hydrateUserPlannerData(requestedUserId, plannerSnapshot);
            } else {
              plannerState.retryPendingPlannerData(requestedUserId);
            }
          } else {
            plannerState.retryPendingPlannerData(requestedUserId);
          }
        }

        if (failureMessage) {
          const loadError = new Error(failureMessage);
          const requestError = requestErrorDetails(loadError);
          if (
            failures.some(message => message.toLowerCase().includes('abort'))
            || requestError.name === 'AbortError'
            || requestError.message?.includes('signal')
          ) {
            console.warn('Account data load was interrupted:', failureMessage);
          } else {
            console.error('Error loading account data:', loadError);
          }
          throw loadError;
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
          const outcome = registrationOutcomeFromSignUp(user, session);
          if (outcome === 'authenticated' && session?.user) {
            establishAuthenticatedState(session.user);
            deferAuthenticatedUserHydration(session.user);
          } else if (outcome === 'confirmation-required') {
            // Email-confirmation projects return a user but no usable session.
            // Do not pretend the account is signed in or send it into an auth
            // redirect loop.
            clearAuthenticatedState();
          }
          return outcome;
        } catch (error) {
          console.error('Registration error:', error);
          throw error;
        }
      },
      
      logout: async () => {
        try {
          await withTimeout(db.signOut(), AUTH_ACTION_TIMEOUT_MS, 'Sign out');
        } catch (error) {
          console.error('Remote logout error:', error);
          toast.error('Orderly could not contact the server, but this device was signed out.');
        } finally {
          // Local account data is sensitive and must be cleared even if the
          // remote sign-out request fails or the device is offline.
          authEventGeneration += 1;
          clearAuthenticatedState();
          initializationDone = false; // allow re-init after next login
        }
      },
      
      // Theme actions
      setTheme: (theme) => set({ theme }),
      
      // Actions
      setUser: (user) => {
        transitionAccountSession(user?.id || null);
        set({ user });
      },
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setCurrentView: (view) => set({ currentView: view }),
      
      // Task actions
      addTask: async (taskData, options) => {
        const user = get().user;
        if (!user) return null;
        const accountId = user.id;
        let reversibleAccessToken = '';
        // Generate the remote primary key before the request. If the insert is
        // committed but its response is lost, compensation can still target
        // the exact row instead of leaving an unidentifiable orphan behind.
        const taskId = crypto.randomUUID();
        
        try {
          if (options?.reversible) {
            const { data: { session }, error: sessionError } = await withTimeout(
              supabase.auth.getSession(),
              AUTH_SESSION_TIMEOUT_MS,
              'Task authorization',
            );
            if (sessionError) throw sessionError;
            if (session?.user.id !== accountId) return null;
            reversibleAccessToken = session.access_token;
          }

          const newTask = await db.createTask({
            ...taskData,
            user_id: accountId,
            id: taskId,
          });

          if (!newTask && options?.reversible && reversibleAccessToken) {
            await compensateInterruptedTaskCreation(accountId, taskId, reversibleAccessToken);
          }

          // The request may resolve after sign-out or an account switch. It is
          // valid for the original account, but must never enter the new
          // account's in-memory snapshot or produce a misleading toast there.
          if (get().user?.id !== accountId) {
            if (newTask && options?.reversible && reversibleAccessToken) {
              await compensateInterruptedTaskCreation(
                accountId,
                newTask.id,
                reversibleAccessToken,
              );
            }
            return null;
          }
          
          if (newTask && options?.reversible && reversibleAccessToken) {
            reversibleTaskReceipts.set(newTask.id, {
              ownerUserId: accountId,
              accessToken: reversibleAccessToken,
            });
          }

          if (newTask) {
            set((state) => ({ tasks: prependUniqueRecordById(state.tasks, newTask) }));
            toast.success('Task created');
          } else {
            toast.error('Failed to create task');
          }
          
          return newTask;
        } catch {
          if (options?.reversible && reversibleAccessToken) {
            await compensateInterruptedTaskCreation(accountId, taskId, reversibleAccessToken);
          }
          if (get().user?.id === accountId) toast.error('Failed to create task');
          return null;
        }
      },

      finalizeTaskCreations: (taskIds) => {
        for (const taskId of taskIds) reversibleTaskReceipts.delete(taskId);
      },
      
      updateTask: async (id, updates) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before updating a task');
          return false;
        }
        const existingTask = get().tasks.find(task => task.id === id && task.user_id === accountId);
        if (!existingTask) {
          toast.error('Task not found');
          return false;
        }
        const scheduleRecurrence = useScheduleStore.getState()
          .entriesByUser[accountId]?.[id]?.recurrence;
        if (
          existingTask.status === 'completed'
          && updates.status
          && updates.status !== 'completed'
          && isRepeatingTaskSeries(existingTask, scheduleRecurrence)
        ) {
          toast.error('A completed repeating occurrence cannot be reopened because its next occurrence already exists.');
          return false;
        }
        try {
          const result = await db.updateTask(id, updates);
          if (get().user?.id !== accountId) return false;
          if (!result) {
            toast.error('Failed to update task');
            return false;
          }
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === id ? { ...task, ...result } : task
            ),
          }));
          return true;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to update task');
          return false;
        }
      },
      
      deleteTask: async (id, options) => {
        const activeUserId = get().user?.id || null;
        const receipt = reversibleTaskReceipts.get(id);
        const ownerUserId = receipt?.ownerUserId || activeUserId;
        if (!ownerUserId) {
          if (!options?.silent) toast.error('Sign in before deleting a task');
          return false;
        }
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
        } catch {
          if (receipt) queuePendingTaskCleanup(receipt.ownerUserId, id);
          if (!options?.silent && get().user?.id === ownerUserId) toast.error('Failed to delete task');
          return false;
        }
      },
      
      completeTask: async (id) => {
        if (taskCompletionsInFlight.has(id)) return false;
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before completing a task');
          return false;
        }
        const taskBeforeCompletion = get().tasks.find(
          task => task.id === id && task.user_id === accountId,
        );
        if (!taskBeforeCompletion) {
          toast.error('Task not found');
          return false;
        }

        taskCompletionsInFlight.add(id);
        try {
          const scheduleState = useScheduleStore.getState();
          const completedSchedule = scheduleState.entriesByUser[accountId]?.[id] || null;
          const scheduleRecurrence: ScheduleRecurrence = completedSchedule?.recurrence
            && completedSchedule.recurrence !== 'none'
            ? completedSchedule.recurrence
            : taskBeforeCompletion.recurrence;
          const deadlineRecurrence: ScheduleRecurrence = taskBeforeCompletion.recurrence !== 'none'
            ? taskBeforeCompletion.recurrence
            : scheduleRecurrence;
          const repeating = isRepeatingTaskSeries(taskBeforeCompletion, scheduleRecurrence);
          const persistedPlannerTimeZone = usePlannerStore.getState()
            .users[accountId]?.settings.timeZone;
          const browserTimeZone = typeof Intl !== 'undefined'
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : undefined;
          const timeZone = resolveTaskCompletionTimeZone(
            persistedPlannerTimeZone,
            browserTimeZone,
          );
          const parsedDue = taskBeforeCompletion.due_date
            ? new Date(taskBeforeCompletion.due_date)
            : new Date();
          const currentDue = Number.isNaN(parsedDue.getTime()) ? new Date() : parsedDue;
          const currentDueDateKey = localDateFromIso(currentDue.toISOString(), timeZone);
          const currentDueTime = localTimeFromIso(currentDue.toISOString(), timeZone) || '23:59';
          const nextDueDateKey = currentDueDateKey && repeating
            ? nextLocalRecurrenceDate(
                currentDueDateKey,
                deadlineRecurrence,
                taskBeforeCompletion.recurrence !== 'none'
                  ? taskBeforeCompletion.recurrence_days
                  : completedSchedule?.recurrenceDays,
              )
            : null;
          const nextDueIso = nextDueDateKey
            ? localDateTimeToIso(nextDueDateKey, `${currentDueTime}:00`, timeZone)
            : null;

          const currentScheduleDate = completedSchedule?.scheduledDate
            && isLocalDate(completedSchedule.scheduledDate)
            ? completedSchedule.scheduledDate
            : currentDueDateKey;
          const nextScheduleDateKey = currentScheduleDate && repeating
            ? nextLocalRecurrenceDate(
                currentScheduleDate,
                scheduleRecurrence,
                completedSchedule?.recurrenceDays || taskBeforeCompletion.recurrence_days,
              )
            : null;
          const boundedSeriesFinished = Boolean(
            completedSchedule?.recurrenceEndDate
            && nextScheduleDateKey
            && nextScheduleDateKey > completedSchedule.recurrenceEndDate,
          );

          const successorInput: db.TaskSuccessorInput | null = repeating && !boundedSeriesFinished
            ? {
                title: taskBeforeCompletion.title,
                description: taskBeforeCompletion.description,
                priority: taskBeforeCompletion.priority,
                subject_id: taskBeforeCompletion.subject_id,
                // A repeating scheduled activity without a deadline stays
                // deadline-free. Deadline-bearing series advance the deadline
                // by the same effective recurrence as the schedule.
                due_date: taskBeforeCompletion.due_date
                  ? nextDueIso
                  : completedSchedule
                    ? null
                    : nextDueIso,
                due_time: taskBeforeCompletion.due_time || null,
                recurrence: taskBeforeCompletion.recurrence,
                recurrence_days: taskBeforeCompletion.recurrence_days || null,
              }
            : null;

          if (repeating && !boundedSeriesFinished && !successorInput?.due_date && !nextScheduleDateKey) {
            toast.error('Orderly could not determine the next occurrence date. The task was not completed.');
            return false;
          }

          const result = await db.completeTask(id, successorInput);
          if (get().user?.id !== accountId) return false;
          if (!result) {
            toast.error('Failed to complete task');
            return false;
          }
          if (!result.changed) {
            toast.info('This task was already completed in another tab.');
            await get().loadUserData(accountId);
            return false;
          }

          set((state) => ({
            tasks: [
              ...(result.successorTask ? [result.successorTask] : []),
              result.completedTask,
              ...state.tasks.filter(task => (
                task.id !== id && task.id !== result.successorTask?.id
              )),
            ],
          }));

          if (result.successorTask && completedSchedule && nextScheduleDateKey) {
            const startTime = completedSchedule.startAt
              ? localTimeFromIso(completedSchedule.startAt, timeZone)
              : null;
            const nextStartAt = startTime
              ? localDateTimeToIso(nextScheduleDateKey, `${startTime}:00`, timeZone)
              : null;
            scheduleState.upsertTaskSchedule(accountId, result.successorTask.id, {
              scheduledDate: nextScheduleDateKey,
              startAt: nextStartAt,
              durationSeconds: completedSchedule.durationSeconds,
              recurrence: scheduleRecurrence,
              recurrenceDays: completedSchedule.recurrenceDays || taskBeforeCompletion.recurrence_days,
              recurrenceEndDate: completedSchedule.recurrenceEndDate,
            });
            for (const [sourceDate, override] of Object.entries(completedSchedule.occurrenceOverrides)) {
              if (sourceDate >= nextScheduleDateKey) {
                scheduleState.setOccurrenceOverride(
                  accountId,
                  result.successorTask.id,
                  sourceDate,
                  override,
                );
              }
            }
          }

          toast.success('Task completed! 🎉');
          if (result.successorTask) {
            toast.success(`Next ${scheduleRecurrence} task created`);
          }

          // Database triggers maintain profile counters atomically from the
          // task source of truth; refresh the profile after completion.
          const updatedProfile = await db.getProfile(accountId);
          if (updatedProfile && get().user?.id === accountId) {
            set({ user: updatedProfile });
          }
          return true;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to complete task');
          return false;
        } finally {
          taskCompletionsInFlight.delete(id);
        }
      },
      
      // Goal actions
      addGoal: async (goalData) => {
        const user = get().user;
        if (!user) return false;
        const accountId = user.id;
        
        try {
          const newGoal = await db.createGoal({
            ...goalData,
            user_id: accountId,
          });
          if (get().user?.id !== accountId) return false;
          
          if (newGoal) {
            set((state) => ({ goals: [newGoal, ...state.goals] }));
            toast.success('Goal created');
            return true;
          }
          toast.error('Failed to create goal');
          return false;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to create goal');
          return false;
        }
      },
      
      updateGoal: async (id, updates) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before updating a goal');
          return false;
        }
        const result = await db.updateGoal(id, updates);
        if (get().user?.id !== accountId) return false;
        if (result) {
          set((state) => ({
            goals: state.goals.map((goal) =>
              goal.id === id ? { ...goal, ...result } : goal
            ),
          }));
          return true;
        }
        toast.error('Failed to update goal');
        return false;
      },
      
      deleteGoal: async (id) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before deleting a goal');
          return;
        }
        try {
          const success = await db.deleteGoal(id);
          if (get().user?.id !== accountId) return;
          if (success) {
            set((state) => ({
              goals: state.goals.filter((goal) => goal.id !== id),
            }));
            toast.success('Goal deleted');
          } else {
            toast.error('Failed to delete goal');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to delete goal');
        }
      },
      
      // Exam actions
      addExam: async (examData) => {
        const user = get().user;
        if (!user) return false;
        const accountId = user.id;
        
        try {
          const newExam = await db.createExam({
            ...examData,
            user_id: accountId,
          });
          if (get().user?.id !== accountId) return false;
          
          if (newExam) {
            set((state) => ({ exams: [...state.exams, newExam] }));
            toast.success('Exam added');
            return true;
          }
          toast.error('Failed to add exam');
          return false;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to add exam');
          return false;
        }
      },
      
      updateExam: async (id, updates) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before updating an exam');
          return false;
        }
        const result = await db.updateExam(id, updates);
        if (get().user?.id !== accountId) return false;
        if (result) {
          set((state) => ({
            exams: state.exams.map((exam) =>
              exam.id === id ? { ...exam, ...result } : exam
            ),
          }));
          return true;
        }
        toast.error('Failed to update exam');
        return false;
      },
      
      deleteExam: async (id) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before deleting an exam');
          return;
        }
        try {
          const success = await db.deleteExam(id);
          if (get().user?.id !== accountId) return;
          if (success) {
            set((state) => ({
              exams: state.exams.filter((exam) => exam.id !== id),
            }));
            toast.success('Exam deleted');
          } else {
            toast.error('Failed to delete exam');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to delete exam');
        }
      },
      
      // Subject actions
      addSubject: async (subjectData) => {
        const user = get().user;
        if (!user) return null;
        const accountId = user.id;
        
        try {
          const newSubject = await db.createSubject({
            ...subjectData,
            user_id: accountId,
          });
          if (get().user?.id !== accountId) return null;
          
          if (newSubject) {
            set((state) => ({ subjects: [...state.subjects, newSubject] }));
            toast.success('Subject created');
            return newSubject;
          }
          toast.error('Failed to create subject');
          return null;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to create subject');
          return null;
        }
      },
      
      updateSubject: async (id, updates) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before updating a subject');
          return;
        }
        const result = await db.updateSubject(id, updates);
        if (get().user?.id !== accountId) return;
        if (result) {
          set((state) => ({
            subjects: state.subjects.map((subject) =>
              subject.id === id ? { ...subject, ...result } : subject
            ),
          }));
        } else {
          toast.error('Failed to update subject');
        }
      },
      
      deleteSubject: async (id) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before deleting a subject');
          return;
        }
        try {
          const success = await db.deleteSubject(id);
          if (get().user?.id !== accountId) return;
          if (success) {
            set((state) => ({
              subjects: state.subjects.filter((subject) => subject.id !== id),
            }));
            toast.success('Subject deleted');
          } else {
            toast.error('Failed to delete subject');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to delete subject');
        }
      },
      
      // Study session actions
      addStudySession: async (sessionData) => {
        const user = get().user;
        if (!user) {
          toast.error('Sign in before saving a study session');
          return false;
        }
        const accountId = user.id;
        
        try {
          const newSession = await db.createStudySession({
            ...sessionData,
            user_id: accountId,
          });
          if (get().user?.id !== accountId) return false;
          
          if (newSession) {
            set((state) => ({
              studySessions: prependUniqueRecordById(state.studySessions, newSession),
            }));
            toast.success('Study session saved! 📚');
            
            // Database triggers maintain total study time atomically.
            const updatedProfile = await db.getProfile(accountId);
            if (updatedProfile && get().user?.id === accountId) {
              set({ user: updatedProfile });
            }
            return true;
          } else {
            console.error('Study session database insert returned no record');
            toast.error('Could not save the study session. Please retry.');
            return false;
          }
        } catch (error) {
          console.error('Failed to save study session:', error);
          if (get().user?.id === accountId) {
            toast.error('Could not save the study session. Please retry.');
          }
          return false;
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
        const accountId = user.id;
        const staleTaskIds = get().tasks
          .filter((task) => task.source === 'canvas' && task.external_id && !currentCanvasIds.includes(task.external_id))
          .map((task) => task.id);
        
        const removedCount = await db.removeOrphanedCanvasTasks(accountId, currentCanvasIds);
        if (get().user?.id !== accountId) return 0;
        
        if (removedCount > 0) {
          useScheduleStore.getState().clearTaskSchedules(accountId, staleTaskIds);
          // Refresh tasks from database
          const tasks = await db.getTasks(accountId);
          if (get().user?.id !== accountId) return 0;
          set({ tasks });
        }
        
        return removedCount;
      },

      // Social actions
      loadFriends: async () => {
        const user = get().user;
        if (!user) return;
        const accountId = user.id;
        const requestGeneration = accountSessionFence.generation;
        const requestIsCurrent = () => isStoreRequestCurrent(
          get().user?.id || null,
          accountId,
          requestGeneration,
        );
        try {
          const friends = await db.getFriends(accountId);
          if (!requestIsCurrent()) return;
          set({ friends });
        } catch {
          // Keep the last successful list; getFriends throws on read failure so
          // an outage cannot masquerade as having no friends.
          if (requestIsCurrent()) toast.error('Failed to refresh friends');
        }
      },

      sendFriendRequest: async (friendId: string) => {
        const user = get().user;
        if (!user) return false;
        const accountId = user.id;
        try {
          const success = await db.sendFriendRequest(accountId, friendId);
          if (get().user?.id !== accountId) return false;
          if (success) {
            toast.success('Friend request sent!');
            await get().loadFriends();
          } else {
            toast.error('Failed to send friend request');
          }
          return success;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to send friend request');
          return false;
        }
      },

      respondToFriendRequest: async (friendshipId: string, accept: boolean) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before responding to a friend request');
          return;
        }
        try {
          const success = await db.respondToFriendRequest(friendshipId, accept);
          if (get().user?.id !== accountId) return;
          if (success) {
            toast.success(accept ? 'Friend request accepted!' : 'Friend request declined');
            await get().loadFriends();
          } else {
            toast.error('Failed to respond to request');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to respond to request');
        }
      },

      removeFriend: async (friendshipId: string) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before removing a friend');
          return;
        }
        try {
          const success = await db.removeFriend(friendshipId);
          if (get().user?.id !== accountId) return;
          if (success) {
            toast.success('Friend removed');
            set((state) => ({
              friends: state.friends.filter((f) => f.id !== friendshipId),
            }));
          } else {
            toast.error('Failed to remove friend');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to remove friend');
        }
      },

      updateUserProfile: async (updates: Partial<EditableProfileFields>) => {
        const user = get().user;
        if (!user) return null;
        const accountId = user.id;
        try {
          const updatedProfile = await db.updateProfile(accountId, updates);
          if (get().user?.id !== accountId) return null;
          if (updatedProfile) {
            set({ user: updatedProfile });
            toast.success('Profile updated');
            return updatedProfile;
          }
          toast.error('Failed to update profile');
          return null;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to update profile');
          return null;
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
