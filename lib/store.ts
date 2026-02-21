import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Task, Goal, StudySession, Exam, Subject, Profile, Achievement } from '@/lib/supabase/types';
import { supabase } from '@/lib/supabase/client';
import * as db from '@/lib/supabase/services';
import type { FriendWithProfile } from '@/lib/supabase/services';
import { toast } from 'sonner';

type Theme = 'light' | 'dark' | 'system';

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
  achievements: Achievement[];
  
  // Pomodoro state
  pomodoroSettings: {
    focusDuration: number;
    shortBreakDuration: number;
    longBreakDuration: number;
    sessionsBeforeLongBreak: number;
  };
  
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
  
  // Canvas sync actions
  removeOrphanedCanvasTasks: (currentCanvasIds: string[]) => Promise<number>;

  // Social actions
  loadFriends: () => Promise<void>;
  sendFriendRequest: (friendId: string) => Promise<boolean>;
  respondToFriendRequest: (friendshipId: string, accept: boolean) => Promise<void>;
  removeFriend: (friendshipId: string) => Promise<void>;
  loadAchievements: () => Promise<void>;
  checkAchievements: () => Promise<void>;
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
      achievements: [],
      dataLoaded: false,
      
      pomodoroSettings: {
        focusDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
      },
      
      sidebarOpen: true,
      currentView: 'dashboard',
      
      // Initialize auth state
      initializeAuth: async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          
          if (session?.user) {
            const profile = await db.getProfile(session.user.id);
            set({ 
              isAuthenticated: true, 
              user: profile,
              isLoading: false,
            });
            
            // Load user data
            await get().loadUserData(session.user.id);
          } else {
            set({ isAuthenticated: false, user: null, isLoading: false });
          }
        } catch (error) {
          console.error('Error initializing auth:', error);
          set({ isAuthenticated: false, user: null, isLoading: false });
        }
        
        // Listen for auth changes (clean up previous listener if any)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (event === 'SIGNED_IN' && session?.user) {
            const profile = await db.getProfile(session.user.id);
            set({ isAuthenticated: true, user: profile });
            await get().loadUserData(session.user.id);
          } else if (event === 'SIGNED_OUT') {
            set({ 
              isAuthenticated: false, 
              user: null,
              tasks: [],
              goals: [],
              studySessions: [],
              exams: [],
              subjects: [],
              friends: [],
              achievements: [],
              dataLoaded: false,
            });
          }
        });
      },
      
      // Load all user data from Supabase
      loadUserData: async (userId: string) => {
        try {
          const [tasks, goals, studySessions, exams, subjects, friends, achievements] = await Promise.all([
            db.getTasks(userId),
            db.getGoals(userId),
            db.getStudySessions(userId),
            db.getExams(userId),
            db.getSubjects(userId),
            db.getFriends(userId),
            db.getAchievements(userId),
          ]);
          
          set({
            tasks,
            goals,
            studySessions,
            exams,
            subjects,
            friends,
            achievements,
            dataLoaded: true,
          });
        } catch (error) {
          console.error('Error loading user data:', error);
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
          set({ 
            isAuthenticated: false, 
            user: null,
            tasks: [],
            goals: [],
            studySessions: [],
            exams: [],
            subjects: [],
            friends: [],
            achievements: [],
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
          }
        } catch (error) {
          toast.error('Failed to save study session');
        }
      },
      
      // Pomodoro actions
      updatePomodoroSettings: (settings) => {
        set((state) => ({
          pomodoroSettings: { ...state.pomodoroSettings, ...settings },
        }));
      },
      
      // Canvas sync - remove tasks that no longer exist in Canvas
      removeOrphanedCanvasTasks: async (currentCanvasIds: string[]) => {
        const user = get().user;
        if (!user) return 0;
        
        const removedCount = await db.removeOrphanedCanvasTasks(user.id, currentCanvasIds);
        
        if (removedCount > 0) {
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

      loadAchievements: async () => {
        const user = get().user;
        if (!user) return;
        const achievements = await db.getAchievements(user.id);
        set({ achievements });
      },

      checkAchievements: async () => {
        const user = get().user;
        if (!user) return;
        const { studySessions, tasks } = get();
        const stats = {
          totalStudyMinutes: studySessions.reduce((acc, s) => acc + s.duration_minutes, 0),
          completedTasks: tasks.filter((t) => t.status === 'completed').length,
          totalSessions: studySessions.length,
        };
        const newlyUnlocked = await db.checkAndUnlockAchievements(user.id, user, stats);
        if (newlyUnlocked.length > 0) {
          newlyUnlocked.forEach((a) => toast.success(`🏆 Achievement unlocked: ${a.title}`));
          await get().loadAchievements();
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
