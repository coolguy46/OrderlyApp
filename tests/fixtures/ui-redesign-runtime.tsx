/* eslint-disable @typescript-eslint/no-explicit-any -- Synthetic visual-only network/routing boundary. */
import { forwardRef } from 'react';
import { demoOwner, useAppStore, usePlannerStore, useScheduleStore } from './tutorial-demo-stores';
export { demoOwner, useAppStore, usePlannerStore, useScheduleStore };

export const mutationCalls: string[] = [];
export const navigationCalls: string[] = [];
const blockedMutation = async () => { mutationCalls.push('unexpected fixture mutation'); return false; };
useAppStore.setState({
  isLoading: false, activeTaskId: null, activeSubjectId: null,
  setSidebarOpen: (sidebarOpen: boolean) => useAppStore.setState({ sidebarOpen }),
  setTheme: (theme: string) => useAppStore.setState({ theme }),
  setPomodoroSettings() {}, login: blockedMutation, register: blockedMutation,
  addTask: blockedMutation, updateTask: blockedMutation, completeTask: blockedMutation, deleteTask: blockedMutation,
  addGoal: blockedMutation, updateGoal: blockedMutation, deleteGoal: blockedMutation,
  addExam: blockedMutation, updateExam: blockedMutation, deleteExam: blockedMutation,
  addSubject: blockedMutation, deleteSubject: blockedMutation, addStudySession: blockedMutation,
  updateUserProfile: blockedMutation, logout: blockedMutation,
});
usePlannerStore.setState({ refreshPlanStaleness: () => null, replaceUserSchedules() {} });

const router = { push(href: string) { navigationCalls.push(href); }, replace() {}, refresh() {}, prefetch() {} };
export function useRouter() { return router; }
export function usePathname() { return window.location.pathname; }
export function useSearchParams() { return new URLSearchParams(window.location.search); }
export const supabase = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
export const getTimerState = async () => null;
export const upsertTimerState = blockedMutation;
export const deleteTimerState = blockedMutation;
export const signInWithGoogle = blockedMutation;
export const resetPassword = blockedMutation;
export const getCanvasSettings = async () => null;
export const upsertCanvasSettings = blockedMutation;
export function useCanvasSyncSupabase() {
  return { isLoading: false, isSyncing: false, error: null, lastSyncAt: null, nextSyncAt: null,
    settings: { icalUrl: '', syncEnabled: false, autoSyncInterval: 15 },
    syncNow: blockedMutation, setIcalUrl: blockedMutation, toggleAutoSync: blockedMutation,
    setSyncInterval: blockedMutation, clearData: blockedMutation };
}
export function formatTimeUntilSync() { return 'Not connected'; }
export function formatLastSync() { return 'Never'; }

// Next routing and image optimization are framework boundaries; actual page,
// navigation, editor and component markup remains unchanged in the bundle.
const NextElement = forwardRef<HTMLElement, any>(function NextElement(props, ref) {
  const { children, href, src, priority: _priority, fill: _fill, unoptimized: _unoptimized, prefetch: _prefetch, ...rest } = props;
  void _priority; void _fill; void _unoptimized; void _prefetch;
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- Faithful synthetic Next Image boundary.
  if (src) return <img ref={ref as any} src={typeof src === 'string' ? src : src.src} {...rest} />;
  return <a ref={ref as any} href={href} {...rest}>{children}</a>;
});
export default NextElement;

Object.assign(window, { uiRedesignFixture: {
  mutationCalls, navigationCalls,
  setTheme(theme: string) {
    useAppStore.setState({ theme });
    document.documentElement.classList.toggle('dark', theme === 'dark');
  },
} });
