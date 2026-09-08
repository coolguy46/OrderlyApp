/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated synthetic browser boundary, never production data. */
import React, { type ReactNode } from 'react';
import { create } from 'zustand';
import { getDefaultPlannerSettings } from '../../lib/planner/types';

export const owner = 'feature-test-alex';
const key = 'feature-fixture-data';
const initial = {
  user: { id: owner, full_name: 'Alex Morgan', email: 'alex@example.invalid', created_at: '2026-09-01T12:00:00Z', tasks_completed: 0, total_study_time: 0 },
  tasks: [], subjects: [], studySessions: [],
  goals: [{ id: 'goal', user_id: owner, title: 'Essay outline', current_value: 1, target_value: 3, unit: 'steps', status: 'active', goal_type: 'short_term', deadline: null }],
  exams: [{ id: 'exam', user_id: owner, title: 'Biology Quiz', exam_date: '2027-01-05', source: 'manual', preparation_progress: 20, description: '<p>Cells &amp; tissues</p>' }],
};
let snapshot = initial;
try { snapshot = JSON.parse(localStorage.getItem(key) || 'null') || initial; } catch { /* synthetic only */ }
export const controls = { failSave: false, failPlanner: false, saves: 0, permissionCalls: 0 };
export const saveFixture = (patch: any) => {
  useAppStore.setState(patch);
  const current = useAppStore.getState();
  localStorage.setItem(key, JSON.stringify(Object.fromEntries(['user', 'tasks', 'subjects', 'studySessions', 'goals', 'exams'].map(key => [key, current[key]]))));
};
const mutate = async (collection: string, id: string | null, patch: any) => {
  controls.saves++;
  await new Promise(resolve => setTimeout(resolve, 60));
  if (controls.failSave) return false;
  const rows = useAppStore.getState()[collection];
  const item = { ...patch, id: id || crypto.randomUUID() };
  saveFixture({ [collection]: id ? rows.map((row: any) => row.id === id ? { ...row, ...patch } : row) : [...rows, item] });
  return item;
};
export const useAppStore = create<any>(() => ({
  ...snapshot, dataLoaded: true, isLoading: false, activeStudySeconds: 0, theme: 'dark', sidebarOpen: true,
  pomodoroSettings: { focusDuration: 25, shortBreakDuration: 5, longBreakDuration: 15, sessionsBeforeLongBreak: 4 },
  addGoal: (data: any) => mutate('goals', null, data), updateGoal: (id: string, data: any) => mutate('goals', id, data),
  deleteGoal: async (id: string) => { if (controls.failSave) return false; saveFixture({ goals: useAppStore.getState().goals.filter((row: any) => row.id !== id) }); return true; },
  addExam: (data: any) => mutate('exams', null, data), updateExam: (id: string, data: any) => mutate('exams', id, data),
  deleteExam: async (id: string) => { if (controls.failSave) return false; saveFixture({ exams: useAppStore.getState().exams.filter((row: any) => row.id !== id) }); return true; },
  updateUserProfile: async (patch: any) => { if (controls.failSave) return false; saveFixture({ user: { ...useAppStore.getState().user, ...patch } }); return true; },
  setTheme: (theme: string) => useAppStore.setState({ theme }), logout: async () => {},
}));
export const usePlannerStore = create<any>((set, get) => ({
  users: { [owner]: { settings: getDefaultPlannerSettings('America/Los_Angeles'), commitments: [] } },
  setActiveUser: (id: string) => { if (!get().users[id]) set({ users: { ...get().users, [id]: { settings: getDefaultPlannerSettings('America/Los_Angeles'), commitments: [] } } }); },
  updateSettings: (id: string, patch: any) => set({ users: { ...get().users, [id]: { ...get().users[id], settings: patch } } }),
  waitForPlannerPersistence: async () => { await new Promise(resolve => setTimeout(resolve, 100)); return !controls.failPlanner; },
  clearUserPlannerData() {},
}));
export const useScheduleStore = create<any>(() => ({ entriesByUser: {}, clearTaskSchedules() {} }));
export const useCurrentTime = () => new Date('2026-09-07T21:00:00Z');
export function MainLayout({ children }: { children: ReactNode }) { return <main>{children}</main>; }
const router = { push() {}, replace() {}, refresh() {}, prefetch() {} };
export function useRouter() { return router; }
export function usePathname() { return '/settings'; }
export function useSearchParams() { return new URLSearchParams(); }
export default function Link({ children, href, ...props }: any) { return <a href={href} {...props}>{children}</a>; }
export const supabase = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
