import { create } from 'zustand';

let finishAuth: (() => void) | null = null;
let pendingAuth: Promise<void> | null = null;
let authObservers = 0;
let initializationRequests = 0;
let setupComplete = false;
let setupChecks = 0;
const redirects: string[] = [];
const router = { replace: (path: string) => { redirects.push(path); } };

export function useRouter() { return router; }
export function usePathname() { return '/tasks'; }
export async function getSetupCompletion() { setupChecks += 1; return setupComplete; }
export async function markSetupComplete() { setupChecks += 1; return true; }

export const useAppStore = create<{
  user: { id: string } | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;
  dataLoaded: boolean;
  dataLoadError: string | null;
  subjects: never[];
  initializeAuth: () => Promise<void>;
  refreshData: () => Promise<void>;
}>(() => ({
  user: null, isAuthenticated: false, isLoading: true, authError: null,
  dataLoaded: false, dataLoadError: null, subjects: [],
  initializeAuth: () => {
    authObservers += 1;
    if (!pendingAuth) {
      initializationRequests += 1;
      pendingAuth = new Promise(resolve => { finishAuth = resolve; });
    }
    return pendingAuth;
  },
  refreshData: async () => {},
}));

Object.assign(window, { authFixture: {
  state: () => ({ authObservers, initializationRequests, redirects, setupChecks }),
  resolveAuth: (outcome: 'signed-out' | 'complete' | 'incomplete' | 'error') => {
    const signedIn = outcome === 'complete' || outcome === 'incomplete';
    setupComplete = outcome === 'complete';
    useAppStore.setState({ user: signedIn ? { id: `auth-fixture-${outcome}` } : null,
      isAuthenticated: signedIn, isLoading: false, dataLoaded: signedIn,
      authError: outcome === 'error' ? 'Test authentication unavailable' : null });
    finishAuth?.();
  },
} });
