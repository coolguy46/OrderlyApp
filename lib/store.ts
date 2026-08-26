import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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
  
  // Auth actions
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string, fullName?: string) => Promise<boolean>;
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
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
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
            const profile = await db.getProfile(session.user.id);
            set({
              isAuthenticated: true,
              user: profile,
              isLoading: false,
            });
            await get().loadUserData(session.user.id);
          } else {
            set({ isAuthenticated: false, user: null, isLoading: false });
          }
        } catch (error: any) {
          // Ignore aborted-signal errors (React Strict Mode artefact)
          if (error?.name === 'AbortError' || error?.message?.includes('signal')) {
            console.warn('Auth init aborted (harmless in dev):', error.message);
            set({ isLoading: false });
            initializationDone = false; // allow retry
            return;
          }
          console.error('Error initializing auth:', error);
          set({ isLoading: false });
        }

        // Listen for auth changes — register only once
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          const currentUser = get().user;

          if (event === 'SIGNED_IN' && session?.user) {
            // Skip redundant reload if it's the same user and data is already loaded
            if (currentUser?.id === session.user.id && get().dataLoaded) return;

            // Small delay to allow the profile trigger to create the profile (OAuth)
            let profile = await db.getProfile(session.user.id);
            if (!profile) {
              await new Promise(resolve => setTimeout(resolve, 1500));
              profile = await db.getProfile(session.user.id);
            }
            set({ isAuthenticated: true, user: profile, isLoading: false });
            await get().loadUserData(session.user.id);

          } else if (event === 'TOKEN_REFRESHED') {
            // Token refreshed silently — no state change needed
          } else if (event === 'INITIAL_SESSION') {
            // Already handled above via getSession()
          } else if (event === 'SIGNED_OUT') {
            initializationDone = false; // allow re-init after next login
            set({
              isAuthenticated: false,
              user: null,
              tasks: [],
              goals: [],
              studySessions: [],
              exams: [],
              subjects: [],
              friends: [],
              dataLoaded: false,
              isLoading: false,
            });
          }
        });
        authSubscription = subscription;
      },
      
      // Load all user data from Supabase
      loadUserData: async (userId: string) => {
        const requestedUserId = userId;
        const queuedLoad = dataLoadQueue.then(async () => {
          try {
            const [tasks, goals, studySessions, exams, subjects, friends] = await Promise.all([
              db.getTasks(requestedUserId),
              db.getGoals(requestedUserId),
              db.getStudySessions(requestedUserId),
              db.getExams(requestedUserId),
              db.getSubjects(requestedUserId),
              db.getFriends(requestedUserId),
            ]);

            // A sign-out or account switch may finish while the queries are in
            // flight. Never publish one user's data into another session.
            if (get().user?.id === requestedUserId) {
              set({ tasks, goals, studySessions, exams, subjects, friends, dataLoaded: true });
            }
          } catch (error: any) {
            if (error?.name === 'AbortError' || error?.message?.includes('signal')) {
              console.warn('Data load aborted (retrying next interaction):', error.message);
            } else {
              console.error('Error loading user data:', error);
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
            const profile = await db.getProfile(user.id);
            set({ isAuthenticated: true, user: profile });
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
          const { user } = await db.signUp(email, password, fullName);
          if (user) {
            // Wait a moment for the trigger to create the profile
            await new Promise(resolve => setTimeout(resolve, 1000));
            const profile = await db.getProfile(user.id);
            set({ isAuthenticated: true, user: profile });
            await get().loadUserData(user.id);
            return true;
          }
          return false;
        } catch (error) {
          console.error('Registration error:', error);
          throw error;
        }
      },
      
      logout: async () => {
        try {
          await db.signOut();
          initializationDone = false; // allow re-init after next login
          set({ 
            isAuthenticated: false, 
            user: null,
            tasks: [],
            goals: [],
            studySessions: [],
            exams: [],
            subjects: [],
            friends: [],
            dataLoaded: false,
          });
        } catch (error) {
          console.error('Logout error:', error);
        }
      },
      
      // Theme actions
      setTheme: (theme) => set({ theme }),
      
      // Actions
      setUser: (user) => set({ user }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setCurrentView: (view) => set({ currentView: view }),
      
      // Task actions
      addTask: async (taskData) => {
        const user = get().user;
        if (!user) return null;
        
        try {
          const newTask = await db.createTask({
            ...taskData,
            user_id: user.id,
          });
          
          if (newTask) {
            set((state) => ({ tasks: [newTask, ...state.tasks] }));
            toast.success('Task created');
          } else {
            toast.error('Failed to create task');
          }
          
          return newTask;
        } catch (error) {
          toast.error('Failed to create task');
          return null;
        }
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
      
      deleteTask: async (id) => {
        try {
          const success = await db.deleteTask(id);
          if (success) {
            set((state) => ({
              tasks: state.tasks.filter((task) => task.id !== id),
            }));
            const userId = get().user?.id;
            if (userId) useScheduleStore.getState().removeTaskSchedule(userId, id);
            toast.success('Task deleted');
          }
        } catch (error) {
          toast.error('Failed to delete task');
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
