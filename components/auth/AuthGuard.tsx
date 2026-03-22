'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAppStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';

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
  const { isAuthenticated, isLoading: authLoading, initializeAuth, dataLoaded, subjects } = useAppStore();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    // Initialize auth on mount
    const init = async () => {
      await initializeAuth();
      setInitialized(true);
    };
    init();
  }, [initializeAuth]);

  useEffect(() => {
    if (!initialized || authLoading) return;

    const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route));
    const isSetupExempt = SETUP_EXEMPT_ROUTES.some(route => pathname.startsWith(route));

    // Routes where authenticated users should be redirected to dashboard
    const isAuthRoute = pathname.startsWith('/auth/');

    if (!isAuthenticated && !isPublicRoute) {
      router.push('/landing');
    } else if (isAuthenticated && isAuthRoute) {
      router.push('/');
    } else if (isAuthenticated && !isSetupExempt && dataLoaded) {
      // Redirect new users to setup if they haven't completed it
      const setupComplete = localStorage.getItem('orderly-setup-complete');
      if (!setupComplete && subjects.length === 0) {
        router.push('/setup');
      }
    }
  }, [isAuthenticated, pathname, router, initialized, authLoading, dataLoaded, subjects]);

  // Show loading spinner while checking auth
  if (!initialized || authLoading) {
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
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname.startsWith(route));
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
