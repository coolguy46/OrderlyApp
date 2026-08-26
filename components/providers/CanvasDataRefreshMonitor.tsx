'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import * as db from '@/lib/supabase/services';

const CHECK_INTERVAL_MS = 30_000;
const VALID_SYNC_INTERVALS = new Set([5, 15, 30, 60]);

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
      let settings = await db.getCanvasSettings(userId);

      // Older releases kept the selected interval only in localStorage. Carry
      // it into Supabase from any Orderly page—not just Integrations—using the
      // same compare-and-set claim as the settings screen.
      if (settings) {
        const legacyKey = `canvas_sync_interval_${userId}`;
        const legacyValue = Number(localStorage.getItem(legacyKey));
        if (
          settings.sync_interval_migrated !== true
          && VALID_SYNC_INTERVALS.has(legacyValue)
        ) {
          const migrated = await db.migrateCanvasSyncInterval(
            userId,
            legacyValue,
            Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
          );
          if (migrated?.sync_interval_migrated === true) {
            settings = migrated;
            localStorage.removeItem(legacyKey);
          }
        } else if (settings.sync_interval_migrated === true) {
          localStorage.removeItem(legacyKey);
        }
      }

      const latestSync = settings?.last_sync_at ?? null;

      if (lastSeenSyncRef.current === undefined) {
        // The first settings read can race the app's initial task load. If a
        // server sync has ever completed, perform one coalesced refresh before
        // accepting the baseline so a just-finished import cannot be missed.
        if (latestSync) await refreshData();
        lastSeenSyncRef.current = latestSync;
        return;
      }

      if (latestSync !== lastSeenSyncRef.current) {
        await refreshData();
        // Advance the marker only after the refresh has been accepted. Store
        // refreshes are queued when another load is active, so this update can
        // no longer consume a Canvas change without reloading application data.
        lastSeenSyncRef.current = latestSync;
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
