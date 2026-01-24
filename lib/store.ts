import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Task, Goal, StudySession, Exam, Subject, Profile } from '@/lib/supabase/types';
import { supabase } from '@/lib/supabase/client';
import * as db from '@/lib/supabase/services';

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
        
        // Listen for auth changes
        supabase.auth.onAuthStateChange(async (event, session) => {
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
              dataLoaded: false,
            });
          }
        });
      },
      
      // Load all user data from Supabase
      loadUserData: async (userId: string) => {
        try {
          const [tasks, goals, studySessions, exams, subjects] = await Promise.all([
            db.getTasks(userId),
            db.getGoals(userId),
            db.getStudySessions(userId),
            db.getExams(userId),
            db.getSubjects(userId),
          ]);
          
          set({
            tasks,
            goals,
            studySessions,
            exams,
            subjects,
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
        
        const newTask = await db.createTask({
          ...taskData,
          user_id: user.id,
        });
        
        if (newTask) {
          set((state) => ({ tasks: [newTask, ...state.tasks] }));
        }
        
        return newTask;
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
        const success = await db.deleteTask(id);
        if (success) {
          set((state) => ({
            tasks: state.tasks.filter((task) => task.id !== id),
          }));
        }
      },
      
      completeTask: async (id) => {
        const result = await db.completeTask(id);
        const user = get().user;
        
        if (result) {
          set((state) => ({
            tasks: state.tasks.map((task) =>
              task.id === id ? result : task
            ),
          }));
          
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
      },
      
      // Goal actions
      addGoal: async (goalData) => {
        const user = get().user;
        if (!user) return;
        
        const newGoal = await db.createGoal({
          ...goalData,
          user_id: user.id,
        });
        
        if (newGoal) {
          set((state) => ({ goals: [newGoal, ...state.goals] }));
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
        const success = await db.deleteGoal(id);
        if (success) {
          set((state) => ({
            goals: state.goals.filter((goal) => goal.id !== id),
          }));
        }
      },
      
      // Exam actions
      addExam: async (examData) => {
        const user = get().user;
        if (!user) return;
        
        const newExam = await db.createExam({
          ...examData,
          user_id: user.id,
        });
        
        if (newExam) {
          set((state) => ({ exams: [...state.exams, newExam] }));
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
        const success = await db.deleteExam(id);
        if (success) {
          set((state) => ({
            exams: state.exams.filter((exam) => exam.id !== id),
          }));
        }
      },
      
      // Subject actions
      addSubject: async (subjectData) => {
        const user = get().user;
        if (!user) return;
        
        const newSubject = await db.createSubject({
          ...subjectData,
          user_id: user.id,
        });
        
        if (newSubject) {
          set((state) => ({ subjects: [...state.subjects, newSubject] }));
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
        const success = await db.deleteSubject(id);
        if (success) {
          set((state) => ({
            subjects: state.subjects.filter((subject) => subject.id !== id),
          }));
        }
      },
      
      // Study session actions
      addStudySession: async (sessionData) => {
        const user = get().user;
        if (!user) return;
        
        const newSession = await db.createStudySession({
          ...sessionData,
          user_id: user.id,
        });
        
        if (newSession) {
          set((state) => ({
            studySessions: [newSession, ...state.studySessions],
          }));
          
          // Update user's total study time
          const updatedProfile = await db.updateProfile(user.id, {
            total_study_time: user.total_study_time + sessionData.duration_minutes,
          });
          if (updatedProfile) {
            set({ user: updatedProfile });
          }
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
