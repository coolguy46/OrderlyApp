'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';
import { setupCompletionKey } from '@/lib/auth/lifecycle';

// Routes that don't require authentication
const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/callback',
  '/landing',
  '/privacy',
  '/terms',
];

// Routes that are accessible when authenticated but exempt from setup redirect
const SETUP_EXEMPT_ROUTES = ['/setup'];

interface AuthGuardProps {
  children: React.ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    isAuthenticated,
    isLoading: authLoading,
    authError,
    initializeAuth,
    dataLoaded,
    subjects,
    user,
  } = useAppStore();
  const [initialized, setInitialized] = useState(false);
  const initCalledRef = useRef(false);
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route));

  useEffect(() => {
    // Prevent double-call in React 18 Strict Mode
    if (initCalledRef.current) return;
    initCalledRef.current = true;

    let cancelled = false;
    void initializeAuth().finally(() => {
      if (!cancelled) setInitialized(true);
    });

    return () => {
      cancelled = true;
    };
    // intentionally no deps — run once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // A SIGNED_IN event is authoritative even if the initial getSession call
    // is still settling. Do not hold a successful login behind that older
    // request.
    if ((!initialized && !isAuthenticated) || authLoading) return;
    if (authError && !isAuthenticated) return;

    const isSetupExempt = SETUP_EXEMPT_ROUTES.some(route => pathname.startsWith(route));

    // Routes where authenticated users should be redirected to dashboard
    const isAuthRoute = pathname.startsWith('/auth/');

    if (!isAuthenticated && !isPublicRoute) {
      router.replace('/landing');
    } else if (isAuthenticated && isAuthRoute) {
      router.replace('/');
    } else if (isAuthenticated && user && !isSetupExempt && dataLoaded) {
      // Setup completion belongs to an account, not to the browser. Migrate
      // the legacy global flag only for an existing account with subjects so
      // a brand-new account on the same device cannot skip onboarding.
      const scopedKey = setupCompletionKey(user.id);
      let setupComplete = localStorage.getItem(scopedKey);
      if (!setupComplete && localStorage.getItem('orderly-setup-complete') && subjects.length > 0) {
        localStorage.setItem(scopedKey, 'true');
        setupComplete = 'true';
      }
      if (!setupComplete && subjects.length === 0) {
        router.replace('/setup');
      }
    }
  }, [
    isAuthenticated,
    pathname,
    router,
    initialized,
    authLoading,
    authError,
    dataLoaded,
    subjects,
    user,
    isPublicRoute,
  ]);

  // Public auth/marketing/legal pages must remain interactive while the
  // session check is in flight. They do not need a network round trip before
  // their buttons can work.
  if (isPublicRoute && (!initialized || authLoading)) {
    return <>{children}</>;
  }

  // Show a recoverable error rather than an infinite loading screen when the
  // auth service is unavailable on a protected route.
  if (initialized && authError && !isAuthenticated && !isPublicRoute) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">We could not check your session</h1>
          <p className="mt-2 text-sm text-muted-foreground">{authError}</p>
          <button
            type="button"
            className="mt-5 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-600"
            onClick={() => {
              setInitialized(false);
              void initializeAuth().finally(() => setInitialized(true));
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // Show loading spinner while checking auth on protected pages.
  if ((!initialized || authLoading) && !isAuthenticated) {
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

  if (isAuthenticated && pathname.startsWith('/auth/')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm text-muted-foreground">Redirecting to dashboard...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
