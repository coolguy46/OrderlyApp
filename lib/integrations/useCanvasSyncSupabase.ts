import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasAssignment, hydrateCanvasDueDate } from './canvas';
import * as db from '@/lib/supabase/services';

interface CanvasSettings {
  icalUrl: string;
  lastSyncAt: Date | null;
  syncEnabled: boolean;
  autoSyncInterval: number; // in minutes
}

interface UseCanvasSyncOptions {
  userId: string | null;
  onSyncComplete?: (assignments: CanvasAssignment[], removedCount: number) => void;
  onSyncError?: (error: Error) => void;
  defaultInterval?: number; // minutes
}

interface UseCanvasSyncResult {
  assignments: CanvasAssignment[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;
  lastSyncAt: Date | null;
  nextSyncAt: Date | null;
  settings: CanvasSettings;
  syncNow: () => Promise<void>;
  setIcalUrl: (url: string) => Promise<void>;
  toggleAutoSync: () => Promise<void>;
  setSyncInterval: (minutes: number) => void;
  clearData: () => Promise<void>;
  newAssignmentsCount: number;
  removedAssignmentsCount: number;
}

/**
 * Custom hook for managing Canvas calendar sync with Supabase persistence
 */
export function useCanvasSyncSupabase(options: UseCanvasSyncOptions): UseCanvasSyncResult {
  const {
    userId,
    onSyncComplete,
    onSyncError,
    defaultInterval = 15,
  } = options;

  // State
  const [assignments, setAssignments] = useState<CanvasAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAssignmentsCount, setNewAssignmentsCount] = useState(0);
  const [removedAssignmentsCount, setRemovedAssignmentsCount] = useState(0);
  const [settings, setSettings] = useState<CanvasSettings>({
    icalUrl: '',
    lastSyncAt: null,
    syncEnabled: true,
    autoSyncInterval: defaultInterval,
  });
  const [nextSyncAt, setNextSyncAt] = useState<Date | null>(null);

  // Refs for interval management
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const syncNowRef = useRef<() => Promise<void>>(async () => {});
  const icalUrlRef = useRef('');
  const lastAttemptAtRef = useRef<number | null>(null);
  const [schedulerVersion, setSchedulerVersion] = useState(0);

  // Load settings from Supabase on mount
  useEffect(() => {
    const loadSettings = async () => {
      if (!userId) {
        setIsLoading(false);
        return;
      }

      try {
        const canvasSettings = await db.getCanvasSettings(userId);
        if (canvasSettings) {
          const savedInterval = Number(localStorage.getItem(`canvas_sync_interval_${userId}`));
          const databaseInterval = Number(canvasSettings.auto_sync_interval);
          const autoSyncInterval = [5, 15, 30, 60].includes(savedInterval)
            ? savedInterval
            : [5, 15, 30, 60].includes(databaseInterval) ? databaseInterval : defaultInterval;
          icalUrlRef.current = canvasSettings.ical_url;
          setSettings({
            icalUrl: canvasSettings.ical_url,
            lastSyncAt: canvasSettings.last_sync_at ? new Date(canvasSettings.last_sync_at) : null,
            syncEnabled: canvasSettings.sync_enabled,
            autoSyncInterval,
          });

          // Once the database migration is present, carry forward an existing
          // browser preference and record the timezone used by background sync.
          if (canvasSettings.auto_sync_interval !== undefined) {
            const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            if (databaseInterval !== autoSyncInterval || canvasSettings.time_zone !== browserTimeZone) {
              void db.upsertCanvasSettings(userId, {
                auto_sync_interval: autoSyncInterval,
                time_zone: browserTimeZone,
              });
            }
          }
        }
      } catch (err) {
        console.error('Error loading Canvas settings:', err);
      }
      setIsLoading(false);
    };

    loadSettings();
  }, [userId, defaultInterval]);

  // Save settings to Supabase
  const saveSettings = useCallback(async (newSettings: Partial<CanvasSettings>) => {
    if (!userId) return;

    try {
      await db.upsertCanvasSettings(userId, {
        ical_url: newSettings.icalUrl ?? settings.icalUrl,
        last_sync_at: newSettings.lastSyncAt?.toISOString() ?? settings.lastSyncAt?.toISOString() ?? null,
        sync_enabled: newSettings.syncEnabled ?? settings.syncEnabled,
      });
    } catch (err) {
      console.error('Error saving Canvas settings:', err);
    }
  }, [userId, settings]);

  // Sync function
  const syncNow = useCallback(async () => {
    const currentIcalUrl = icalUrlRef.current || settings.icalUrl;
    if (!currentIcalUrl || isSyncing || !userId) return;

    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/canvas/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icalUrl: currentIcalUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync Canvas calendar');
      }

      // Convert date strings to Date objects in the user's timezone.
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const hydratedAssignments: CanvasAssignment[] = data.assignments.map((a: CanvasAssignment) => ({
        ...a,
        dueDate: hydrateCanvasDueDate(a, browserTimeZone),
        startDate: a.startDate ? new Date(a.startDate) : undefined,
        endDate: a.endDate ? new Date(a.endDate) : undefined,
      }));

      // Get all Canvas assignment IDs from the current sync
      const currentCanvasIds = hydratedAssignments.map(a => a.id);

      // Remove tasks that no longer exist in Canvas (submitted/deleted)
      const removedCount = await db.removeOrphanedCanvasTasks(userId, currentCanvasIds);
      setRemovedAssignmentsCount(removedCount);

      setAssignments(hydratedAssignments);
      setNewAssignmentsCount(hydratedAssignments.length);
      
      const now = new Date();
      const updatedSettings = {
        ...settings,
        lastSyncAt: now,
      };
      setSettings(updatedSettings);
      
      // Save to Supabase
      await saveSettings({ lastSyncAt: now });

      // Calculate next sync time
      if (settings.syncEnabled) {
        const next = new Date(now.getTime() + settings.autoSyncInterval * 60 * 1000);
        setNextSyncAt(next);
      }

      onSyncComplete?.(hydratedAssignments, removedCount);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onSyncError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsSyncing(false);
      lastAttemptAtRef.current = Date.now();
      setSchedulerVersion(version => version + 1);
    }
  }, [settings, isSyncing, userId, saveSettings, onSyncComplete, onSyncError]);

  // Keep the scheduler independent from syncNow's changing React closure.
  // Otherwise toggling isSyncing recreates syncNow and restarts the timer.
  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  // Schedule the next sync for the exact remaining delay. A fixed setInterval
  // caused the countdown to reach zero before the interval actually fired.
  useEffect(() => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = null;
    }

    if (settings.syncEnabled && settings.icalUrl && !isLoading && userId) {
      const intervalMs = settings.autoSyncInterval * 60 * 1000;
      const now = new Date();
      const lastSuccessfulSync = settings.lastSyncAt
        ? new Date(settings.lastSyncAt).getTime()
        : 0;
      const scheduleFrom = Math.max(lastSuccessfulSync, lastAttemptAtRef.current || 0);
      const nextTimestamp = scheduleFrom > 0 ? scheduleFrom + intervalMs : now.getTime();
      const delay = Math.max(0, nextTimestamp - now.getTime());

      setNextSyncAt(new Date(now.getTime() + delay));
      syncTimeoutRef.current = setTimeout(() => {
        void syncNowRef.current();
      }, delay);
    } else {
      setNextSyncAt(null);
    }

    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, [settings.syncEnabled, settings.icalUrl, settings.autoSyncInterval, settings.lastSyncAt, isLoading, userId, schedulerVersion]);

  // Action functions
  const setIcalUrl = useCallback(async (url: string) => {
    icalUrlRef.current = url;
    setSettings(prev => ({ ...prev, icalUrl: url }));
    setError(null);
    
    if (userId && url) {
      await db.upsertCanvasSettings(userId, {
        ical_url: url,
        sync_enabled: settings.syncEnabled,
      });
    }
  }, [userId, settings.syncEnabled]);

  const toggleAutoSync = useCallback(async () => {
    const newSyncEnabled = !settings.syncEnabled;
    setSettings(prev => ({ ...prev, syncEnabled: newSyncEnabled }));
    
    if (userId) {
      await db.upsertCanvasSettings(userId, {
        sync_enabled: newSyncEnabled,
      });
    }
  }, [userId, settings.syncEnabled]);

  const setSyncInterval = useCallback((minutes: number) => {
    const normalizedMinutes = [5, 15, 30, 60].includes(minutes) ? minutes : defaultInterval;
    setSettings(prev => ({ ...prev, autoSyncInterval: normalizedMinutes }));
    if (userId) {
      localStorage.setItem(`canvas_sync_interval_${userId}`, String(normalizedMinutes));
      void db.upsertCanvasSettings(userId, {
        auto_sync_interval: normalizedMinutes,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
    }
    lastAttemptAtRef.current = Date.now();
    setSchedulerVersion(version => version + 1);
  }, [defaultInterval, userId]);

  const clearData = useCallback(async () => {
    setAssignments([]);
    icalUrlRef.current = '';
    setSettings({
      icalUrl: '',
      lastSyncAt: null,
      syncEnabled: true,
      autoSyncInterval: defaultInterval,
    });
    setError(null);
    setNextSyncAt(null);
    setNewAssignmentsCount(0);
    setRemovedAssignmentsCount(0);
    
    if (userId) {
      await db.deleteCanvasSettings(userId);
      localStorage.removeItem(`canvas_sync_interval_${userId}`);
    }
  }, [userId, defaultInterval]);

  return {
    assignments,
    isLoading,
    isSyncing,
    error,
    lastSyncAt: settings.lastSyncAt,
    nextSyncAt,
    settings,
    syncNow,
    setIcalUrl,
    toggleAutoSync,
    setSyncInterval,
    clearData,
    newAssignmentsCount,
    removedAssignmentsCount,
  };
}

/**
 * Format time until next sync
 */
export function formatTimeUntilSync(nextSyncAt: Date | null): string {
  if (!nextSyncAt) return 'Auto-sync disabled';

  const now = new Date();
  const diff = nextSyncAt.getTime() - now.getTime();

  if (diff <= 0) return 'Syncing...';

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (minutes > 0) {
    return `Next sync in ${minutes}m ${seconds}s`;
  }
  return `Next sync in ${seconds}s`;
}

/**
 * Format last sync time
 */
export function formatLastSync(lastSyncAt: Date | null): string {
  if (!lastSyncAt) return 'Never synced';

  const now = new Date();
  const diff = now.getTime() - lastSyncAt.getTime();

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `Last synced ${hours}h ${minutes % 60}m ago`;
  }
  if (minutes > 0) {
    return `Last synced ${minutes}m ago`;
  }
  if (seconds > 10) {
    return `Last synced ${seconds}s ago`;
  }
  return 'Just synced';
}
