'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import * as db from '@/lib/supabase/services';

const CHECK_INTERVAL_MS = 30_000;

/**
 * Keeps an already-open Orderly tab aligned with Canvas changes imported by
 * the server-side background job. The background job records last_sync_at;
 * this monitor only reloads application data when that marker changes.
 */
export function CanvasDataRefreshMonitor() {
  const userId = useAppStore(state => state.user?.id ?? null);
  const refreshData = useAppStore(state => state.refreshData);
  const lastSeenSyncRef = useRef<string | null | undefined>(undefined);
  const checkingRef = useRef(false);

  const checkForCanvasChanges = useCallback(async () => {
    if (!userId || checkingRef.current || document.visibilityState === 'hidden') return;

    checkingRef.current = true;
    try {
      const settings = await db.getCanvasSettings(userId);
      const latestSync = settings?.last_sync_at ?? null;

      if (lastSeenSyncRef.current === undefined) {
        lastSeenSyncRef.current = latestSync;
        return;
      }

      if (latestSync !== lastSeenSyncRef.current) {
        lastSeenSyncRef.current = latestSync;
        await refreshData();
      }
    } catch (error) {
      console.error('Could not check for Canvas background updates:', error);
    } finally {
      checkingRef.current = false;
    }
  }, [refreshData, userId]);

  useEffect(() => {
    lastSeenSyncRef.current = undefined;
    if (!userId) return;

    void checkForCanvasChanges();
    const interval = window.setInterval(() => {
      void checkForCanvasChanges();
    }, CHECK_INTERVAL_MS);

    const handleFocus = () => void checkForCanvasChanges();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void checkForCanvasChanges();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForCanvasChanges, userId]);

  return null;
}
