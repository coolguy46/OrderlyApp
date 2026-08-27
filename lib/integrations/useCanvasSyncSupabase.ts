import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasAssignment, hydrateCanvasDueDate } from './canvas';
import {
  CANVAS_CONNECT_DEADLINE_MS,
  CANVAS_CONNECT_TIMEOUT_MESSAGE,
  CANVAS_MANUAL_SYNC_CLIENT_DEADLINE_MS,
  CANVAS_SYNC_TIMEOUT_MESSAGE,
  CanvasOperationTimeoutError,
  readCanvasSyncResponse,
  withCanvasDeadline,
} from './canvas-sync-reliability';
import * as db from '@/lib/supabase/services';

interface CanvasSettings {
  icalUrl: string;
  lastSyncAt: Date | null;
  lastBackgroundSyncAt: Date | null;
  syncEnabled: boolean;
  autoSyncInterval: number; // in minutes
}

interface UseCanvasSyncOptions {
  userId: string | null;
  onSyncComplete?: (assignments: CanvasAssignment[], removedCount: number) => void | Promise<void>;
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
  setIcalUrl: (url: string) => Promise<boolean>;
  toggleAutoSync: () => Promise<void>;
  setSyncInterval: (minutes: number) => Promise<void>;
  clearData: () => Promise<void>;
  newAssignmentsCount: number;
  removedAssignmentsCount: number;
}

const VALID_SYNC_INTERVALS = [5, 15, 30, 60] as const;

function normalizeSyncInterval(value: unknown, fallback: number): number {
  const interval = Number(value);
  return VALID_SYNC_INTERVALS.includes(interval as (typeof VALID_SYNC_INTERVALS)[number])
    ? interval
    : fallback;
}

function readLegacySyncInterval(userId: string): number | null {
  const stored = localStorage.getItem(`canvas_sync_interval_${userId}`);
  if (stored === null) return null;
  const interval = Number(stored);
  return VALID_SYNC_INTERVALS.includes(interval as (typeof VALID_SYNC_INTERVALS)[number])
    ? interval
    : null;
}

function isSerializedCanvasAssignment(value: unknown): value is CanvasAssignment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const assignment = value as Record<string, unknown>;
  const optionalDateValues = ['dueDate', 'startDate', 'endDate', 'dueDateOnly'];

  return typeof assignment.id === 'string'
    && typeof assignment.courseName === 'string'
    && typeof assignment.title === 'string'
    && typeof assignment.hasDueTime === 'boolean'
    && typeof assignment.type === 'string'
    && typeof assignment.status === 'string'
    && optionalDateValues.every(key =>
      assignment[key] === undefined || typeof assignment[key] === 'string'
    );
}

function responseCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
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
    lastBackgroundSyncAt: null,
    syncEnabled: true,
    autoSyncInterval: defaultInterval,
  });
  const [nextSyncAt, setNextSyncAt] = useState<Date | null>(null);

  // Refs for cross-request coordination
  const icalUrlRef = useRef('');
  const syncingRef = useRef(false);
  const connectingRef = useRef(false);
  const settingsMutationVersionRef = useRef(0);

  // Supabase is the source of truth for Canvas settings. Polling keeps this
  // page aligned with background syncs that finish while it is already open.
  useEffect(() => {
    let cancelled = false;

    // Do not show settings or assignments from the previously signed-in user
    // while this user's database row is loading.
    icalUrlRef.current = '';
    setAssignments([]);
    setSettings({
      icalUrl: '',
      lastSyncAt: null,
      lastBackgroundSyncAt: null,
      syncEnabled: true,
      autoSyncInterval: defaultInterval,
    });
    setNextSyncAt(null);

    const loadSettings = async (initialLoad = false) => {
      if (!userId) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      const mutationVersion = settingsMutationVersionRef.current;
      try {
        let canvasSettings = await db.getCanvasSettings(userId);
        if (cancelled || mutationVersion !== settingsMutationVersionRef.current) return;
        if (!canvasSettings) return;

        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const legacyKey = `canvas_sync_interval_${userId}`;

        const legacyInterval = readLegacySyncInterval(userId);
        if (canvasSettings.sync_interval_migrated !== true && legacyInterval !== null) {
          const migrated = await db.migrateCanvasSyncInterval(
            userId,
            legacyInterval,
            browserTimeZone
          );
          if (!migrated || migrated.sync_interval_migrated !== true) {
            throw new Error('Could not migrate the Canvas sync interval.');
          }
          canvasSettings = migrated;
          // The legacy value is disposable only after the database confirms
          // that this user has completed the one-time migration.
          localStorage.removeItem(legacyKey);
        } else if (canvasSettings.sync_interval_migrated === true) {
          // A true database flag means another browser may already have
          // migrated this account. Its value wins over this browser's cache.
          localStorage.removeItem(legacyKey);
        }

        if (canvasSettings.time_zone !== browserTimeZone) {
          const saved = await db.upsertCanvasSettings(userId, { time_zone: browserTimeZone });
          if (!saved) throw new Error('Could not save the Canvas sync timezone.');
          canvasSettings = saved;
        }

        if (cancelled || mutationVersion !== settingsMutationVersionRef.current) return;
        const autoSyncInterval = normalizeSyncInterval(
          canvasSettings.auto_sync_interval,
          defaultInterval
        );
        icalUrlRef.current = canvasSettings.ical_url;
        setSettings({
          icalUrl: canvasSettings.ical_url,
          lastSyncAt: canvasSettings.last_sync_at ? new Date(canvasSettings.last_sync_at) : null,
          lastBackgroundSyncAt: canvasSettings.last_background_sync_at
            ? new Date(canvasSettings.last_background_sync_at)
            : null,
          syncEnabled: canvasSettings.sync_enabled,
          autoSyncInterval,
        });
      } catch (err) {
        console.error('Error loading Canvas settings:', err);
        if (initialLoad && !cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load Canvas settings.');
        }
      } finally {
        if (initialLoad && !cancelled) setIsLoading(false);
      }
    };

    setIsLoading(true);
    setError(null);
    void loadSettings(true);

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSettings();
    }, 30_000);
    const handleFocus = () => void loadSettings();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void loadSettings();
    };
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [userId, defaultInterval]);

  // Sync function
  const syncNow = useCallback(async () => {
    const currentIcalUrl = icalUrlRef.current || settings.icalUrl;
    if (!currentIcalUrl || syncingRef.current || !userId) return;

    syncingRef.current = true;
    setIsSyncing(true);
    setError(null);

    let completedSync: { assignments: CanvasAssignment[]; removedCount: number } | null = null;
    try {
      const data = await withCanvasDeadline(async signal => {
        const response = await fetch('/api/canvas/sync', {
          method: 'POST',
          cache: 'no-store',
          signal,
        });
        return readCanvasSyncResponse(response);
      }, CANVAS_MANUAL_SYNC_CLIENT_DEADLINE_MS, CANVAS_SYNC_TIMEOUT_MESSAGE);

      // Convert date strings to Date objects in the user's timezone.
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const hydratedAssignments: CanvasAssignment[] = data.assignments.map(value => {
        if (!isSerializedCanvasAssignment(value)) {
          throw new Error('Canvas sync returned an invalid assignment. Please try again.');
        }
        const assignment = value as CanvasAssignment;
        return {
          ...assignment,
          dueDate: hydrateCanvasDueDate(assignment, browserTimeZone),
          startDate: assignment.startDate ? new Date(assignment.startDate) : undefined,
          endDate: assignment.endDate ? new Date(assignment.endDate) : undefined,
        };
      });

      const removedCount = responseCount(data.removed);
      setRemovedAssignmentsCount(removedCount);

      setAssignments(hydratedAssignments);
      setNewAssignmentsCount(responseCount(data.imported));

      const reportedLastSync = typeof data.lastSyncAt === 'string'
        ? new Date(data.lastSyncAt)
        : new Date();
      const now = Number.isNaN(reportedLastSync.getTime()) ? new Date() : reportedLastSync;
      const reportedBackgroundSync = typeof data.lastBackgroundSyncAt === 'string'
        ? new Date(data.lastBackgroundSyncAt)
        : null;
      settingsMutationVersionRef.current += 1;
      setSettings(prev => ({
        ...prev,
        lastSyncAt: now,
        lastBackgroundSyncAt: reportedBackgroundSync
          && !Number.isNaN(reportedBackgroundSync.getTime())
          ? reportedBackgroundSync
          : prev.lastBackgroundSyncAt,
      }));
      completedSync = { assignments: hydratedAssignments, removedCount };
    } catch (err) {
      const errorMessage = err instanceof CanvasOperationTimeoutError
        ? err.message
        : err instanceof TypeError
          ? 'Could not reach Canvas sync. Check your connection and try again.'
          : err instanceof Error
            ? err.message
            : 'Could not sync Canvas. Please try again.';
      setError(errorMessage);
      onSyncError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      syncingRef.current = false;
      setIsSyncing(false);
    }

    // Updating the rest of the app is useful follow-up work, but it must never
    // keep this button spinning after the Canvas request itself has settled.
    if (completedSync && onSyncComplete) {
      const { assignments: completedAssignments, removedCount } = completedSync;
      void Promise.resolve()
        .then(() => onSyncComplete(completedAssignments, removedCount))
        .catch(refreshError => {
          console.error('Canvas synced, but app data could not be refreshed:', refreshError);
        });
    }
  }, [settings.icalUrl, userId, onSyncComplete, onSyncError]);

  // Automatic synchronization is owned by the server scheduler. The client
  // only displays the next due time and offers an explicit Sync Now action.
  useEffect(() => {
    if (!settings.syncEnabled || !settings.icalUrl || isLoading || !userId) {
      setNextSyncAt(null);
      return;
    }
    if (!settings.lastBackgroundSyncAt) {
      setNextSyncAt(new Date(0));
      return;
    }
    setNextSyncAt(new Date(
      settings.lastBackgroundSyncAt.getTime() + settings.autoSyncInterval * 60 * 1000
    ));
  }, [settings.syncEnabled, settings.icalUrl, settings.autoSyncInterval, settings.lastBackgroundSyncAt, isLoading, userId]);

  // Action functions
  const setIcalUrl = useCallback(async (url: string) => {
    setError(null);
    const normalizedUrl = url.trim();
    if (!userId || !normalizedUrl || connectingRef.current) return false;

    connectingRef.current = true;
    settingsMutationVersionRef.current += 1;
    try {
      return await withCanvasDeadline(async signal => {
        const assertStillConnecting = () => {
          if (signal.aborted) {
            throw new CanvasOperationTimeoutError(CANVAS_CONNECT_TIMEOUT_MESSAGE);
          }
        };
        const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const legacyKey = `canvas_sync_interval_${userId}`;
        const legacyInterval = readLegacySyncInterval(userId);
        let persisted = await db.getCanvasSettings(userId);
        assertStillConnecting();

        if (
          persisted &&
          persisted.sync_interval_migrated !== true &&
          legacyInterval !== null
        ) {
          persisted = await db.migrateCanvasSyncInterval(
            userId,
            legacyInterval,
            browserTimeZone
          );
          assertStillConnecting();
          if (!persisted || persisted.sync_interval_migrated !== true) {
            setError('Could not migrate the Canvas sync interval. Please try again.');
            return false;
          }
        }

        if (!persisted) {
          persisted = await db.initializeCanvasSettings(userId, {
            ical_url: normalizedUrl,
            sync_enabled: settings.syncEnabled,
            auto_sync_interval: legacyInterval ?? settings.autoSyncInterval,
            sync_interval_migrated: true,
            time_zone: browserTimeZone,
          });
          assertStillConnecting();
          if (!persisted) {
            setError('Could not connect the Canvas calendar. Please try again.');
            return false;
          }
        }

        // If another first-time flow inserted an unmigrated row during the race,
        // claim it now before saving the connection. The compare-and-set still
        // ensures only one browser can choose the initial interval.
        if (persisted.sync_interval_migrated !== true && legacyInterval !== null) {
          persisted = await db.migrateCanvasSyncInterval(
            userId,
            legacyInterval,
            browserTimeZone
          );
          assertStillConnecting();
          if (!persisted || persisted.sync_interval_migrated !== true) {
            setError('Could not migrate the Canvas sync interval. Please try again.');
            return false;
          }
        }

        // Existing rows keep their database interval. This is important for old
        // browser sessions whose React state still contains the former default.
        // The URL/timezone patch cannot overwrite the interval chosen by the
        // browser that won the one-time migration race.
        const saved = await db.upsertCanvasSettings(userId, {
          ical_url: normalizedUrl,
          time_zone: browserTimeZone,
        });
        assertStillConnecting();
        if (!saved) {
          setError('Could not connect the Canvas calendar. Please try again.');
          return false;
        }

        if (saved.sync_interval_migrated === true) {
          localStorage.removeItem(legacyKey);
        }
        icalUrlRef.current = saved.ical_url;
        setSettings(prev => ({
          ...prev,
          icalUrl: saved.ical_url,
          syncEnabled: saved.sync_enabled,
          autoSyncInterval: normalizeSyncInterval(
            saved.auto_sync_interval,
            prev.autoSyncInterval
          ),
        }));
        return true;
      }, CANVAS_CONNECT_DEADLINE_MS, CANVAS_CONNECT_TIMEOUT_MESSAGE);
    } catch (err) {
      console.error('Error connecting Canvas calendar:', err);
      setError(err instanceof CanvasOperationTimeoutError
        ? err.message
        : 'Could not connect the Canvas calendar. Please try again.');
      return false;
    } finally {
      connectingRef.current = false;
      // Invalidate a settings poll that began while this write was in flight.
      settingsMutationVersionRef.current += 1;
    }
  }, [userId, settings.syncEnabled, settings.autoSyncInterval]);

  const toggleAutoSync = useCallback(async () => {
    const newSyncEnabled = !settings.syncEnabled;
    if (!userId) return;

    setError(null);
    settingsMutationVersionRef.current += 1;
    const saved = await db.upsertCanvasSettings(userId, { sync_enabled: newSyncEnabled });
    settingsMutationVersionRef.current += 1;
    if (!saved) {
      setError('Could not update Canvas auto-sync. Please try again.');
      return;
    }
    setSettings(prev => ({ ...prev, syncEnabled: saved.sync_enabled }));
  }, [userId, settings.syncEnabled]);

  const setSyncInterval = useCallback(async (minutes: number) => {
    const normalizedMinutes = normalizeSyncInterval(minutes, defaultInterval);
    if (!userId) return;

    setError(null);
    settingsMutationVersionRef.current += 1;
    const saved = await db.upsertCanvasSettings(userId, {
      auto_sync_interval: normalizedMinutes,
      sync_interval_migrated: true,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    settingsMutationVersionRef.current += 1;
    if (!saved) {
      setError('Could not save the Canvas sync interval. Please try again.');
      return;
    }
    setSettings(prev => ({
      ...prev,
      autoSyncInterval: normalizeSyncInterval(saved.auto_sync_interval, normalizedMinutes),
    }));
    localStorage.removeItem(`canvas_sync_interval_${userId}`);
  }, [defaultInterval, userId]);

  const clearData = useCallback(async () => {
    if (userId) {
      settingsMutationVersionRef.current += 1;
      const deleted = await db.deleteCanvasSettings(userId);
      settingsMutationVersionRef.current += 1;
      if (!deleted) {
        setError('Could not disconnect Canvas. Please try again.');
        return;
      }
      localStorage.removeItem(`canvas_sync_interval_${userId}`);
    }

    setAssignments([]);
    icalUrlRef.current = '';
    setSettings({
      icalUrl: '',
      lastSyncAt: null,
      lastBackgroundSyncAt: null,
      syncEnabled: true,
      autoSyncInterval: defaultInterval,
    });
    setError(null);
    setNextSyncAt(null);
    setNewAssignmentsCount(0);
    setRemovedAssignmentsCount(0);
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

  if (diff <= 0) return 'Waiting for background sync…';

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
