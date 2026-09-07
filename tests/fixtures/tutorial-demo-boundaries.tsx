// Screenshot-only network and routing boundaries; no production requests.
import type { ReactNode } from 'react';
export function MainLayout({ children }: { children: ReactNode }) { return <>{children}</>; }
export function useRouter() { return { push() {}, replace() {}, refresh() {}, prefetch() {} }; }
export function usePathname() { return '/study'; }
export function useSearchParams() { return new URLSearchParams(); }
export const supabase = { auth: { getUser: async () => ({ data: { user: null }, error: null }) } };
export const getTimerState = async () => null;
export const upsertTimerState = async () => null;
export const deleteTimerState = async () => true;
export function useCanvasSyncSupabase() {
  return { isLoading: false, isSyncing: false, error: null, lastSyncAt: null, nextSyncAt: null,
    settings: { icalUrl: '', syncEnabled: false, autoSyncInterval: 15 },
    syncNow: async () => false, setIcalUrl: async () => false, toggleAutoSync() {}, setSyncInterval() {}, clearData() {} };
}
export function formatTimeUntilSync() { return 'Not connected'; }
export function formatLastSync() { return 'Never'; }
