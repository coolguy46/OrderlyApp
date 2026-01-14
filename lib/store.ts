import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Task, Goal, StudySession, Exam, Subject, Profile } from '@/lib/supabase/types';

// Demo user for local development
const DEMO_USER: Profile = {
  id: 'demo-user-id',
  email: 'demo@student.com',
  full_name: 'Demo Student',
  avatar_url: null,
  total_study_time: 1250,
  tasks_completed: 47,
  current_streak: 5,
  longest_streak: 14,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Default subjects
const DEFAULT_SUBJECTS: Subject[] = [
  { id: '1', user_id: 'demo-user-id', name: 'Mathematics', color: '#ef4444', created_at: new Date().toISOString() },
  { id: '2', user_id: 'demo-user-id', name: 'Physics', color: '#3b82f6', created_at: new Date().toISOString() },
  { id: '3', user_id: 'demo-user-id', name: 'Computer Science', color: '#8b5cf6', created_at: new Date().toISOString() },
  { id: '4', user_id: 'demo-user-id', name: 'English', color: '#10b981', created_at: new Date().toISOString() },
  { id: '5', user_id: 'demo-user-id', name: 'History', color: '#f59e0b', created_at: new Date().toISOString() },
];

// Sample tasks
const SAMPLE_TASKS: Task[] = [
  {
    id: '1',
    user_id: 'demo-user-id',
    subject_id: '1',
    title: 'Complete Calculus Assignment',
    description: 'Finish problems 1-20 from Chapter 5',
    priority: 'high',
    status: 'pending',
    due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '2',
    user_id: 'demo-user-id',
    subject_id: '3',
    title: 'Build React Project',
    description: 'Create a todo app with React and TypeScript',
    priority: 'medium',
    status: 'in_progress',
    due_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '3',
    user_id: 'demo-user-id',
    subject_id: '4',
    title: 'Read Shakespeare Essay',
    description: 'Read and annotate the assigned essay',
    priority: 'low',
    status: 'pending',
    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '4',
    user_id: 'demo-user-id',
    subject_id: '2',
    title: 'Physics Lab Report',
    description: 'Write up the pendulum experiment results',
    priority: 'high',
    status: 'pending',
    due_date: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Sample goals
const SAMPLE_GOALS: Goal[] = [
  {
    id: '1',
    user_id: 'demo-user-id',
    title: 'Study 20 hours this week',
    description: 'Focus on exam preparation',
    target_value: 1200,
    current_value: 450,
    unit: 'minutes',
    goal_type: 'short_term',
    deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '2',
    user_id: 'demo-user-id',
    title: 'Complete 50 tasks',
    description: 'Finish all assignments before semester end',
    target_value: 50,
    current_value: 32,
    unit: 'tasks',
    goal_type: 'long_term',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '3',
    user_id: 'demo-user-id',
    title: 'Maintain 7-day streak',
    description: 'Study every day for a week',
    target_value: 7,
    current_value: 5,
    unit: 'days',
    goal_type: 'short_term',
    deadline: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Sample exams
const SAMPLE_EXAMS: Exam[] = [
  {
    id: '1',
    user_id: 'demo-user-id',
    subject_id: '1',
    title: 'Calculus Midterm',
    description: 'Covers chapters 1-5',
    exam_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    location: 'Room 301',
    preparation_progress: 45,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '2',
    user_id: 'demo-user-id',
    subject_id: '2',
    title: 'Physics Final',
    description: 'Comprehensive exam',
    exam_date: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    location: 'Science Building, Room 102',
    preparation_progress: 20,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '3',
    user_id: 'demo-user-id',
    subject_id: '3',
    title: 'Programming Quiz',
    description: 'Data structures and algorithms',
    exam_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    location: 'Online',
    preparation_progress: 75,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

// Sample study sessions for analytics
const generateStudySessions = (): StudySession[] => {
  const sessions: StudySession[] = [];
  const now = new Date();
  
  for (let i = 0; i < 30; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    // Generate 1-4 sessions per day
    const sessionCount = Math.floor(Math.random() * 4) + 1;
    
    for (let j = 0; j < sessionCount; j++) {
      const startHour = 8 + Math.floor(Math.random() * 12);
      const duration = [25, 45, 60, 90][Math.floor(Math.random() * 4)];
      
      const startedAt = new Date(date);
      startedAt.setHours(startHour, 0, 0, 0);
      
      const endedAt = new Date(startedAt);
      endedAt.setMinutes(endedAt.getMinutes() + duration);
      
      sessions.push({
        id: `session-${i}-${j}`,
        user_id: 'demo-user-id',
        subject_id: DEFAULT_SUBJECTS[Math.floor(Math.random() * DEFAULT_SUBJECTS.length)].id,
        task_id: null,
        duration_minutes: duration,
        session_type: Math.random() > 0.3 ? 'pomodoro' : 'free_study',
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        notes: null,
        created_at: startedAt.toISOString(),
      });
    }
  }
  
  return sessions;
};

type Theme = 'light' | 'dark' | 'system';

interface AppState {
  // Auth
  isAuthenticated: boolean;
  
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
  
  // Auth actions
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  
  // Theme actions
  setTheme: (theme: Theme) => void;
  
  // Actions
  setUser: (user: Profile | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setCurrentView: (view: string) => void;
  
  // Task actions
  addTask: (task: Omit<Task, 'id' | 'created_at' | 'updated_at'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  
  // Goal actions
  addGoal: (goal: Omit<Goal, 'id' | 'created_at' | 'updated_at'>) => void;
  updateGoal: (id: string, updates: Partial<Goal>) => void;
  deleteGoal: (id: string) => void;
  
  // Exam actions
  addExam: (exam: Omit<Exam, 'id' | 'created_at' | 'updated_at'>) => void;
  updateExam: (id: string, updates: Partial<Exam>) => void;
  deleteExam: (id: string) => void;
  
  // Subject actions
  addSubject: (subject: Omit<Subject, 'id' | 'created_at'>) => void;
  updateSubject: (id: string, updates: Partial<Subject>) => void;
  deleteSubject: (id: string) => void;
  
  // Study session actions
  addStudySession: (session: Omit<StudySession, 'id' | 'created_at'>) => void;
  
  // Pomodoro actions
  updatePomodoroSettings: (settings: Partial<AppState['pomodoroSettings']>) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      theme: 'light',
      user: null,
      subjects: DEFAULT_SUBJECTS,
      tasks: SAMPLE_TASKS,
      goals: SAMPLE_GOALS,
      studySessions: generateStudySessions(),
      exams: SAMPLE_EXAMS,
      
      pomodoroSettings: {
        focusDuration: 25,
        shortBreakDuration: 5,
        longBreakDuration: 15,
        sessionsBeforeLongBreak: 4,
      },
      
      sidebarOpen: true,
      currentView: 'dashboard',
      
      // Auth actions
      login: async (email: string, password: string) => {
        // Simulate API call - replace with actual Supabase auth
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // For demo purposes, accept any email/password
        const user: Profile = {
          ...DEMO_USER,
          email: email,
          full_name: email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        };
        
        set({ isAuthenticated: true, user });
        return true;
      },
      
      logout: () => {
        set({ isAuthenticated: false, user: null });
      },
      
      // Theme actions
      setTheme: (theme) => set({ theme }),
      
      // Actions
      setUser: (user) => set({ user }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setCurrentView: (view) => set({ currentView: view }),
      
      // Task actions
      addTask: (task) => {
        const newTask: Task = {
          ...task,
          id: Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        set((state) => ({ tasks: [...state.tasks, newTask] }));
      },
      
      updateTask: (id, updates) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? { ...task, ...updates, updated_at: new Date().toISOString() }
              : task
          ),
        }));
      },
      
      deleteTask: (id) => {
        set((state) => ({
          tasks: state.tasks.filter((task) => task.id !== id),
        }));
      },
      
      completeTask: (id) => {
        set((state) => ({
          tasks: state.tasks.map((task) =>
            task.id === id
              ? {
                  ...task,
                  status: 'completed' as const,
                  completed_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                }
              : task
          ),
          user: state.user
            ? { ...state.user, tasks_completed: state.user.tasks_completed + 1 }
            : null,
        }));
      },
      
      // Goal actions
      addGoal: (goal) => {
        const newGoal: Goal = {
          ...goal,
          id: Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        set((state) => ({ goals: [...state.goals, newGoal] }));
      },
      
      updateGoal: (id, updates) => {
        set((state) => ({
          goals: state.goals.map((goal) =>
            goal.id === id
              ? { ...goal, ...updates, updated_at: new Date().toISOString() }
              : goal
          ),
        }));
      },
      
      deleteGoal: (id) => {
        set((state) => ({
          goals: state.goals.filter((goal) => goal.id !== id),
        }));
      },
      
      // Exam actions
      addExam: (exam) => {
        const newExam: Exam = {
          ...exam,
          id: Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        set((state) => ({ exams: [...state.exams, newExam] }));
      },
      
      updateExam: (id, updates) => {
        set((state) => ({
          exams: state.exams.map((exam) =>
            exam.id === id
              ? { ...exam, ...updates, updated_at: new Date().toISOString() }
              : exam
          ),
        }));
      },
      
      deleteExam: (id) => {
        set((state) => ({
          exams: state.exams.filter((exam) => exam.id !== id),
        }));
      },
      
      // Subject actions
      addSubject: (subject) => {
        const newSubject: Subject = {
          ...subject,
          id: Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
        };
        set((state) => ({ subjects: [...state.subjects, newSubject] }));
      },
      
      updateSubject: (id, updates) => {
        set((state) => ({
          subjects: state.subjects.map((subject) =>
            subject.id === id ? { ...subject, ...updates } : subject
          ),
        }));
      },
      
      deleteSubject: (id) => {
        set((state) => ({
          subjects: state.subjects.filter((subject) => subject.id !== id),
        }));
      },
      
      // Study session actions
      addStudySession: (session) => {
        const newSession: StudySession = {
          ...session,
          id: Math.random().toString(36).substring(2),
          created_at: new Date().toISOString(),
        };
        set((state) => ({
          studySessions: [...state.studySessions, newSession],
          user: state.user
            ? {
                ...state.user,
                total_study_time: state.user.total_study_time + session.duration_minutes,
              }
            : null,
        }));
      },
      
      // Pomodoro actions
      updatePomodoroSettings: (settings) => {
        set((state) => ({
          pomodoroSettings: { ...state.pomodoroSettings, ...settings },
        }));
      },
    }),
    {
      name: 'study-app-storage',
      partialize: (state) => ({
        tasks: state.tasks,
        goals: state.goals,
        exams: state.exams,
        subjects: state.subjects,
        studySessions: state.studySessions,
        pomodoroSettings: state.pomodoroSettings,
        user: state.user,
      }),
    }
  )
);
