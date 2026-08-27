'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import * as db from '@/lib/supabase/services';
import { Loader2 } from 'lucide-react';
import {
  SETUP_COMPLETED_STORAGE_NAMESPACE,
} from '@/lib/setup-completion';
import {
  discardUnownedLegacyStorageValue,
  userScopedStorageKey,
} from '@/lib/user-scoped-storage';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/auth/callback',
  '/landing',
  '/privacy',
  '/terms',
];

// Routes that are accessible when authenticated but exempt from setup redirect
const SETUP_EXEMPT_ROUTES = ['/setup', '/auth/reset-password'];

// A recovery session is authenticated, but it must remain on the reset form.
// Only these entry pages redirect an already signed-in user to the dashboard.
const AUTH_ENTRY_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
];

interface AuthGuardProps {
  children: React.ReactNode;
}

type SetupResolutionStatus = 'idle' | 'checking' | 'complete' | 'incomplete' | 'error';

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    initializeAuth,
    dataLoaded,
    dataLoadError,
    refreshData,
    subjects,
  } = useAppStore();
  const [initialized, setInitialized] = useState(false);
  const [setupResolution, setSetupResolution] = useState<{
    userId: string | null;
    status: SetupResolutionStatus;
  }>({ userId: null, status: 'idle' });
  const [setupRetryNonce, setSetupRetryNonce] = useState(0);
  const initCalledRef = useRef(false);
  const setupChecksRef = useRef(new Map<string, Promise<boolean>>());
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route));
  const isSetupExempt = SETUP_EXEMPT_ROUTES.some(route => pathname.startsWith(route));

  useEffect(() => {
    // Prevent double-call in React 18 Strict Mode
    if (initCalledRef.current) return;
    initCalledRef.current = true;

    const init = async () => {
      await initializeAuth();
      setInitialized(true);
    };
    init();
    // intentionally no deps — run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialized || authLoading) return;

    // Routes where authenticated users should be redirected to dashboard
    const isAuthEntryRoute = AUTH_ENTRY_ROUTES.some(route => pathname.startsWith(route));

    if (!isAuthenticated && !isPublicRoute) {
      router.push('/landing');
    } else if (isAuthenticated && isAuthEntryRoute) {
      router.push('/');
    }
  }, [isAuthenticated, pathname, router, initialized, authLoading, isPublicRoute]);

  useEffect(() => {
    if (
      !initialized
      || authLoading
      || !isAuthenticated
      || !dataLoaded
      || !user
      || isSetupExempt
    ) return;

    let cancelled = false;
    discardUnownedLegacyStorageValue(localStorage, SETUP_COMPLETED_STORAGE_NAMESPACE);
    const setupStorageKey = userScopedStorageKey(SETUP_COMPLETED_STORAGE_NAMESPACE, user.id);
    let locallyComplete = false;
    try {
      locallyComplete = setupStorageKey
        ? localStorage.getItem(setupStorageKey) === 'true'
        : false;
    } catch {
      // Durable Auth metadata remains available when browser storage is blocked.
    }

    const hasCompletionHint = locallyComplete || subjects.length > 0;
    let setupCheck = setupChecksRef.current.get(user.id);
    if (!setupCheck) {
      // A scoped marker or existing subject is a compatibility hint from an
      // older release. Backfill it to durable Auth metadata. Accounts without
      // a hint must read the durable value before entering the app.
      setupCheck = hasCompletionHint
        ? db.markSetupComplete(user.id)
        : db.getSetupCompletion(user.id);
      setupChecksRef.current.set(user.id, setupCheck);
    }

    void setupCheck.then((complete) => {
      if (cancelled) return;
      if (complete) {
        try {
          if (setupStorageKey) localStorage.setItem(setupStorageKey, 'true');
        } catch {
          // The durable server value already succeeded; the cache is optional.
        }
        setSetupResolution({ userId: user.id, status: 'complete' });
        return;
      }

      // A compatibility hint still allows the current account through if its
      // metadata backfill returned false. New setup completions never use this
      // path because the setup form requires the durable write to succeed.
      if (hasCompletionHint) {
        setupChecksRef.current.delete(user.id);
        setSetupResolution({ userId: user.id, status: 'complete' });
        return;
      }

      // A later setup submission can change this value while AuthGuard stays
      // mounted, so never cache an incomplete result across the setup route.
      setupChecksRef.current.delete(user.id);
      setSetupResolution({ userId: user.id, status: 'incomplete' });
      router.replace('/setup');
    }).catch((error) => {
      setupChecksRef.current.delete(user.id);
      if (cancelled) return;
      console.error(`Could not verify setup completion (${error instanceof Error ? error.name : 'UnknownError'})`);
      // Do not mistake a transient Auth failure for an incomplete account.
      setSetupResolution({ userId: user.id, status: hasCompletionHint ? 'complete' : 'error' });
    });

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    dataLoaded,
    initialized,
    isAuthenticated,
    isSetupExempt,
    router,
    subjects.length,
    setupRetryNonce,
    user,
  ]);

  // Show loading spinner while checking auth
  // Public pages must stay reachable when Supabase is slow or offline. Auth
  // still initializes in the background so signed-in entry-page redirects
  // work as soon as the session is known.
  if ((!initialized || authLoading) && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // Show loading while redirecting
  if (!isAuthenticated && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Redirecting...</p>
        </div>
      </div>
    );
  }

  const isAuthEntryRoute = AUTH_ENTRY_ROUTES.some(route => pathname.startsWith(route));
  if (isAuthenticated && isAuthEntryRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  const needsSetupResolution = isAuthenticated
    && dataLoaded
    && Boolean(user)
    && !isSetupExempt;
  const currentSetupStatus = setupResolution.userId === user?.id
    ? setupResolution.status
    : 'idle';
  if (needsSetupResolution && currentSetupStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div
          role="alert"
          className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-amber-500/30 bg-amber-950/20 p-6 text-center"
        >
          <p className="font-semibold">Orderly could not load your setup status.</p>
          <p className="text-sm text-muted-foreground">
            Your account was not changed. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => {
              if (user) setupChecksRef.current.delete(user.id);
              setSetupResolution({ userId: user?.id || null, status: 'idle' });
              setSetupRetryNonce(value => value + 1);
            }}
            className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (
    needsSetupResolution
    && (currentSetupStatus === 'idle'
      || currentSetupStatus === 'checking'
      || currentSetupStatus === 'incomplete')
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">
            {currentSetupStatus === 'incomplete' ? 'Starting setup...' : 'Loading your account...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isAuthenticated && dataLoadError && (
        <div
          role="alert"
          className="sticky top-0 z-[100] flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-950/95 px-4 py-2 text-sm text-amber-100 shadow-lg backdrop-blur"
        >
          <span>{dataLoadError}</span>
          <button
            type="button"
            onClick={() => void refreshData()}
            className="shrink-0 rounded-md border border-amber-300/40 px-2.5 py-1 font-semibold transition-colors hover:bg-amber-200/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-200"
          >
            Retry
          </button>
        </div>
      )}
      {children}
    </>
  );
}
