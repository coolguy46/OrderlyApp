import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Task, Goal, StudySession, NewStudySession, Exam, Subject, Profile } from '@/lib/supabase/types';
import { isSupabaseAvailable, supabase } from '@/lib/supabase/client';
import * as db from '@/lib/supabase/services';
import type { FriendWithProfile } from '@/lib/supabase/services';
import type { EditableProfileFields } from '@/lib/supabase/services';
import { readUserDataSnapshot } from '@/lib/user-data-load';
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
  isCurrentAccountRequest,
  isRepeatingTaskSeries,
  prependUniqueRecordById,
  provisionalProfileFromAuthUser,
  registrationOutcomeFromSignUp,
  type RegistrationOutcome,
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

// Serialize data loads instead of dropping refreshes that arrive while another
// load is running. Each caller awaits its own queued refresh, so a Canvas sync
// marker is never accepted before the corresponding database read completes.
let dataLoadQueue: Promise<void> = Promise.resolve();
// Guard against re-initializing in React Strict Mode
let initializationDone = false;

export type Theme = 'light' | 'dark' | 'system';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  isLoading: boolean;
  
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
  register: (email: string, password: string, fullName?: string) => Promise<RegistrationOutcome>;
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
  addTask: (task: Omit<Task, 'id' | 'created_at' | 'updated_at'>) => Promise<Task | null>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<boolean>;
  deleteTask: (id: string) => Promise<void>;
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

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      isLoading: true,
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
        // Prevent double-init from React Strict Mode
        if (initializationDone) return;
        initializationDone = true;

        // A missing backend configuration must behave like a signed-out app.
        // In particular, do not initialize auth against a placeholder origin.
        if (!isSupabaseAvailable()) {
          transitionAccountSession(null);
          set({
            isAuthenticated: false,
            user: null,
            ...emptyAccountSnapshot(),
            isLoading: false,
          });
          return;
        }

        // Clean up any existing subscription to prevent duplicate listeners
        if (authSubscription) {
          authSubscription.unsubscribe();
          authSubscription = null;
        }

        try {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();

          if (sessionError) {
            // Don't treat a session fetch error as a logout
            console.warn('Session fetch error (non-fatal):', sessionError.message);
            set({ isLoading: false });
          } else if (session?.user) {
            const previousUserId = get().user?.id;
            transitionAccountSession(session.user.id);
            if (previousUserId && previousUserId !== session.user.id) {
              clearLocalAccountData(previousUserId);
            }
            const provisionalProfile = provisionalProfileFromAuthUser(session.user);
            // Establish the authenticated identity before any profile/data
            // request. A missing profile row or temporary profile outage must
            // not leave isAuthenticated=true with user=null.
            set({
              isAuthenticated: true,
              user: provisionalProfile,
              ...emptyAccountSnapshot(),
              isLoading: false,
            });
            const profile = await db.getProfile(session.user.id);
            if (profile && get().user?.id === session.user.id) set({ user: profile });
            await get().loadUserData(session.user.id);
          } else {
            const previousUserId = get().user?.id;
            transitionAccountSession(null);
            clearLocalAccountData(previousUserId);
            set({
              isAuthenticated: false,
              user: null,
              ...emptyAccountSnapshot(),
              isLoading: false,
            });
          }
        } catch (error: unknown) {
          const requestError = requestErrorDetails(error);
          // Ignore aborted-signal errors (React Strict Mode artefact)
          if (requestError.name === 'AbortError' || requestError.message?.includes('signal')) {
            console.warn('Auth init aborted (harmless in dev):', requestError.message);
            set({ isLoading: false });
            initializationDone = false; // allow retry
            return;
          }
          console.error('Error initializing auth:', error);
          set({ isLoading: false });
        }

        // Listen for auth changes — register only once
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          const currentUser = get().user;

          if (event === 'SIGNED_IN' && session?.user) {
            transitionAccountSession(session.user.id);
            // Skip redundant reload if it's the same user and data is already loaded
            if (currentUser?.id === session.user.id && get().dataLoaded) return;

            const accountChanged = currentUser?.id !== session.user.id;
            if (accountChanged) {
              clearLocalAccountData(currentUser?.id);
              // Clear the previous account's in-memory snapshot synchronously,
              // before profile/data requests for the new account can yield.
              set({
                isAuthenticated: true,
                user: provisionalProfileFromAuthUser(session.user),
                ...emptyAccountSnapshot(),
                isLoading: false,
              });
            } else {
              set({
                isAuthenticated: true,
                user: currentUser || provisionalProfileFromAuthUser(session.user),
                isLoading: false,
              });
            }

            // Supabase recommends returning promptly from the auth callback;
            // database calls inside it can block other auth operations. The
            // account-id checks fence this detached hydration from later auth
            // changes.
            const signedInUser = session.user;
            void (async () => {
              let profile = await db.getProfile(signedInUser.id);
              if (!profile) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                if (get().user?.id !== signedInUser.id) return;
                profile = await db.getProfile(signedInUser.id);
              }
              if (get().user?.id !== signedInUser.id) return;
              if (profile) set({ user: profile });
              await get().loadUserData(signedInUser.id);
            })();

          } else if (event === 'TOKEN_REFRESHED') {
            // Token refreshed silently — no state change needed
          } else if (event === 'INITIAL_SESSION') {
            // Already handled above via getSession()
          } else if (event === 'SIGNED_OUT') {
            transitionAccountSession(null);
            clearLocalAccountData(currentUser?.id);
            initializationDone = false; // allow re-init after next login
            set({
              isAuthenticated: false,
              user: null,
              ...emptyAccountSnapshot(),
              isLoading: false,
            });
          }
        });
        authSubscription = subscription;
      },
      
      // Load all user data from Supabase
      loadUserData: async (userId: string) => {
        const requestedUserId = userId;
        const requestGeneration = accountSessionFence.generation;
        const queuedLoad = dataLoadQueue.then(async () => {
          const requestIsCurrent = () => isStoreRequestCurrent(
            get().user?.id || null,
            requestedUserId,
            requestGeneration,
          );
          if (!requestIsCurrent()) return;
          set({ dataLoadError: null });

          // A local schedule/planner edit may complete its server write while
          // this older SELECT is still in flight. Monotonic revisions prevent
          // that stale response from replacing the just-saved local state even
          // after its pending outbox entry has been acknowledged.
          const scheduleRevisionAtStart = useScheduleStore.getState()
            .nextRevisionByUser[requestedUserId] || 0;
          const plannerRevisionAtStart = usePlannerStore.getState()
            .nextRevisionByUser[requestedUserId] || 0;

          try {
            const plannerSnapshotRequest = loadPlannerPersistenceSnapshot(requestedUserId)
              .catch((error: unknown) => {
                // Planner tables are an additive deployment. A failed planner
                // read must not erase the local/offline planner cache or make
                // the rest of the account look unloaded.
                console.warn('Could not hydrate planner data; keeping the local cache.', error);
                return null;
              });
            const [snapshot, plannerSnapshot] = await Promise.all([
              readUserDataSnapshot(requestedUserId, db),
              plannerSnapshotRequest,
            ]);

            // A sign-out or account switch may finish while the queries are in
            // flight. Never publish one user's data into another session.
            if (requestIsCurrent()) {
              set({ ...snapshot, dataLoaded: true, dataLoadError: null });
              const scheduleState = useScheduleStore.getState();
              if (
                (scheduleState.nextRevisionByUser[requestedUserId] || 0)
                === scheduleRevisionAtStart
              ) {
                scheduleState.hydrateUserSchedules(
                  requestedUserId,
                  scheduleEntriesFromTasks(snapshot.tasks, requestedUserId),
                );
              } else {
                scheduleState.retryPendingSchedules(requestedUserId);
              }
              if (plannerSnapshot) {
                const plannerState = usePlannerStore.getState();
                if (
                  (plannerState.nextRevisionByUser[requestedUserId] || 0)
                  === plannerRevisionAtStart
                ) {
                  plannerState.hydrateUserPlannerData(requestedUserId, plannerSnapshot);
                } else {
                  plannerState.retryPendingPlannerData(requestedUserId);
                }
              } else {
                usePlannerStore.getState().retryPendingPlannerData(requestedUserId);
              }
            }
          } catch (error: unknown) {
            const requestError = requestErrorDetails(error);
            if (requestError.name === 'AbortError' || requestError.message?.includes('signal')) {
              console.warn('Data load aborted:', requestError.message);
            } else {
              console.error('Error loading user data:', error);
            }

            // Keep the last complete snapshot and its loaded flag. Publishing
            // any failure-shaped empty collection would look like real data.
            if (requestIsCurrent()) {
              useScheduleStore.getState().retryPendingSchedules(requestedUserId);
              usePlannerStore.getState().retryPendingPlannerData(requestedUserId);
              set({
                dataLoadError: get().dataLoaded
                  ? 'We could not refresh your data. Your last loaded data is still shown.'
                  : 'We could not load your data. Check your connection and try again.',
              });
            }
          }
        });

        dataLoadQueue = queuedLoad;
        await queuedLoad;
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
          const { user } = await db.signIn(email, password);
          if (user) {
            const previousUserId = get().user?.id;
            transitionAccountSession(user.id);
            if (previousUserId && previousUserId !== user.id) {
              clearLocalAccountData(previousUserId);
            }
            if (get().user?.id !== user.id) {
              set({
                isAuthenticated: true,
                user: provisionalProfileFromAuthUser(user),
                ...emptyAccountSnapshot(),
              });
            }
            const profile = await db.getProfile(user.id);
            if (profile && get().user?.id === user.id) set({ user: profile });
            await get().loadUserData(user.id);
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
          const { user, session } = await db.signUp(email, password, fullName);
          const outcome = registrationOutcomeFromSignUp(user, session);
          if (outcome === 'authenticated' && user) {
            const previousUserId = get().user?.id;
            transitionAccountSession(user.id);
            if (previousUserId && previousUserId !== user.id) {
              clearLocalAccountData(previousUserId);
            }
            set({
              isAuthenticated: true,
              user: provisionalProfileFromAuthUser(user),
              ...emptyAccountSnapshot(),
            });
            // Wait a moment for the trigger to create the profile
            await new Promise(resolve => setTimeout(resolve, 1000));
            const profile = await db.getProfile(user.id);
            if (profile && get().user?.id === user.id) set({ user: profile });
            await get().loadUserData(user.id);
            return outcome;
          }
          return outcome;
        } catch (error) {
          console.error('Registration error:', error);
          throw error;
        }
      },
      
      logout: async () => {
        const userId = get().user?.id;
        try {
          await db.signOut();
        } catch (error) {
          console.error('Remote logout error:', error);
          toast.error('Orderly could not contact the server, but this device was signed out.');
        } finally {
          // Local account data is sensitive and must be cleared even if the
          // remote sign-out request fails or the device is offline.
          transitionAccountSession(null);
          clearLocalAccountData(userId);
          initializationDone = false; // allow re-init after next login
          set({ 
            isAuthenticated: false, 
            user: null,
            ...emptyAccountSnapshot(),
          });
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
      addTask: async (taskData) => {
        const user = get().user;
        if (!user) return null;
        const accountId = user.id;
        
        try {
          const newTask = await db.createTask({
            ...taskData,
            user_id: accountId,
          });

          // The request may resolve after sign-out or an account switch. It is
          // valid for the original account, but must never enter the new
          // account's in-memory snapshot or produce a misleading toast there.
          if (get().user?.id !== accountId) return null;
          
          if (newTask) {
            set((state) => ({ tasks: [newTask, ...state.tasks] }));
            toast.success('Task created');
          } else {
            toast.error('Failed to create task');
          }
          
          return newTask;
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to create task');
          return null;
        }
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
      
      deleteTask: async (id) => {
        const accountId = get().user?.id;
        if (!accountId) {
          toast.error('Sign in before deleting a task');
          return;
        }
        try {
          const success = await db.deleteTask(id);
          if (get().user?.id !== accountId) return;
          if (success) {
            set((state) => ({
              tasks: state.tasks.filter((task) => task.id !== id),
            }));
            useScheduleStore.getState().removeTaskSchedule(accountId, id);
            toast.success('Task deleted');
          } else {
            toast.error('Failed to delete task');
          }
        } catch {
          if (get().user?.id === accountId) toast.error('Failed to delete task');
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
