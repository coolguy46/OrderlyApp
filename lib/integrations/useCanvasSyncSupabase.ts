import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasAssignment, hydrateCanvasDueDate } from './canvas';
import * as db from '@/lib/supabase/services';
import { isCurrentAccountRequest } from '@/lib/store-account-safety';

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
const UNOWNED_LEGACY_CANVAS_KEYS = ['canvas_sync_settings', 'canvas_assignments'] as const;

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

function emptyCanvasSettings(defaultInterval: number): CanvasSettings {
  return {
    icalUrl: '',
    lastSyncAt: null,
    lastBackgroundSyncAt: null,
    syncEnabled: true,
    autoSyncInterval: defaultInterval,
  };
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
  const [syncingRequest, setSyncingRequest] = useState<{
    userId: string;
    generation: number;
  } | null>(null);
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
  const [stateOwnerId, setStateOwnerId] = useState<string | null>(null);
  const [accountSession, setAccountSession] = useState({ userId, generation: 0 });
  if (accountSession.userId !== userId) {
    setAccountSession({ userId, generation: accountSession.generation + 1 });
  }

  // Refs for cross-request coordination
  const icalUrlRef = useRef('');
  const syncingRequestRef = useRef<{ userId: string; generation: number } | null>(null);
  const settingsMutationVersionRef = useRef(0);
  const activeUserIdRef = useRef(userId);
  const accountGenerationRef = useRef(0);

  useEffect(() => {
    activeUserIdRef.current = userId;
    accountGenerationRef.current = accountSession.generation;
  }, [accountSession.generation, userId]);

  // Early versions cached the private feed URL and assignment data in global
  // browser keys with no account owner. They cannot be attributed safely on a
  // shared browser, so remove them instead of importing them into this user.
  useEffect(() => {
    UNOWNED_LEGACY_CANVAS_KEYS.forEach(key => localStorage.removeItem(key));
  }, []);

  // Supabase is the source of truth for Canvas settings. Polling keeps this
  // page aligned with background syncs that finish while it is already open.
  useEffect(() => {
    let cancelled = false;

    // Do not show settings or assignments from the previously signed-in user
    // while this user's database row is loading.
    icalUrlRef.current = '';
    const loadSettings = async (initialLoad = false) => {
      if (!userId) {
        if (!cancelled) {
          setAssignments([]);
          setSettings(emptyCanvasSettings(defaultInterval));
          setNewAssignmentsCount(0);
          setRemovedAssignmentsCount(0);
          setStateOwnerId(null);
          setIsLoading(false);
        }
        return;
      }

      const mutationVersion = settingsMutationVersionRef.current;
      try {
        let canvasSettings = await db.getCanvasSettings(userId);
        if (cancelled || mutationVersion !== settingsMutationVersionRef.current) return;
        if (!canvasSettings) {
          setAssignments([]);
          setSettings(emptyCanvasSettings(defaultInterval));
          setNewAssignmentsCount(0);
          setRemovedAssignmentsCount(0);
          setStateOwnerId(userId);
          return;
        }

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
        setStateOwnerId(userId);
      } catch (err) {
        console.error('Error loading Canvas settings:', err);
        if (initialLoad && !cancelled) {
          setAssignments([]);
          setSettings(emptyCanvasSettings(defaultInterval));
          setNewAssignmentsCount(0);
          setRemovedAssignmentsCount(0);
          setError(err instanceof Error ? err.message : 'Could not load Canvas settings.');
          setStateOwnerId(userId);
        }
      } finally {
        if (initialLoad && !cancelled) setIsLoading(false);
      }
    };

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

  const stateBelongsToUser = stateOwnerId === userId;
  const visibleSettings = stateBelongsToUser
    ? settings
    : emptyCanvasSettings(defaultInterval);
  const visibleAssignments = stateBelongsToUser ? assignments : [];
  const visibleIsLoading = userId ? !stateBelongsToUser || isLoading : false;
  const visibleError = stateBelongsToUser ? error : null;
  const nextSyncAt = !visibleSettings.syncEnabled
    || !visibleSettings.icalUrl
    || visibleIsLoading
    || !userId
    ? null
    : visibleSettings.lastBackgroundSyncAt
      ? new Date(
        visibleSettings.lastBackgroundSyncAt.getTime()
        + visibleSettings.autoSyncInterval * 60 * 1000
      )
      : new Date(0);

  // Sync function
  const syncNow = useCallback(async () => {
    const requestUserId = userId;
    const requestGeneration = accountSession.generation;
    const currentIcalUrl = stateOwnerId === requestUserId
      ? (icalUrlRef.current || settings.icalUrl)
      : '';
    const activeSync = syncingRequestRef.current;
    if (
      !currentIcalUrl
      || !requestUserId
      || (activeSync?.userId === requestUserId && activeSync.generation === requestGeneration)
    ) return;

    const requestIdentity = { userId: requestUserId, generation: requestGeneration };
    syncingRequestRef.current = requestIdentity;
    setSyncingRequest(requestIdentity);
    setError(null);

    try {
      const response = await fetch('/api/canvas/sync', { method: 'POST' });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync Canvas calendar');
      }
      if (!isCurrentAccountRequest(
        activeUserIdRef.current,
        accountGenerationRef.current,
        requestUserId,
        requestGeneration,
      )) return;

      // Convert date strings to Date objects in the user's timezone.
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const hydratedAssignments: CanvasAssignment[] = data.assignments.map((a: CanvasAssignment) => ({
        ...a,
        dueDate: hydrateCanvasDueDate(a, browserTimeZone),
        startDate: a.startDate ? new Date(a.startDate) : undefined,
        endDate: a.endDate ? new Date(a.endDate) : undefined,
      }));

      const removedCount = Number(data.removed) || 0;
      setRemovedAssignmentsCount(removedCount);

      setAssignments(hydratedAssignments);
      setNewAssignmentsCount(Number(data.imported) || 0);
      
      // A manual sync is successful only after its assignments have actually
      // been imported. This prevents last_sync_at from advancing on partial work.
      await onSyncComplete?.(hydratedAssignments, removedCount);
      if (!isCurrentAccountRequest(
        activeUserIdRef.current,
        accountGenerationRef.current,
        requestUserId,
        requestGeneration,
      )) return;

      const reportedLastSync = data.lastSyncAt ? new Date(data.lastSyncAt) : new Date();
      const now = Number.isNaN(reportedLastSync.getTime()) ? new Date() : reportedLastSync;
      settingsMutationVersionRef.current += 1;
      setSettings(prev => ({
        ...prev,
        lastSyncAt: now,
        lastBackgroundSyncAt: data.lastBackgroundSyncAt
          ? new Date(data.lastBackgroundSyncAt)
          : prev.lastBackgroundSyncAt,
      }));
    } catch (err) {
      if (!isCurrentAccountRequest(
        activeUserIdRef.current,
        accountGenerationRef.current,
        requestUserId,
        requestGeneration,
      )) return;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onSyncError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      const currentSync = syncingRequestRef.current;
      if (
        currentSync?.userId === requestUserId
        && currentSync.generation === requestGeneration
      ) {
        syncingRequestRef.current = null;
        if (isCurrentAccountRequest(
          activeUserIdRef.current,
          accountGenerationRef.current,
          requestUserId,
          requestGeneration,
        )) setSyncingRequest(null);
      }
    }
  }, [accountSession.generation, settings.icalUrl, stateOwnerId, userId, onSyncComplete, onSyncError]);

  // Action functions
  const setIcalUrl = useCallback(async (url: string) => {
    const normalizedUrl = url.trim();
    if (!userId || !normalizedUrl) return false;
    const requestGeneration = accountSession.generation;
    const currentSettings = stateOwnerId === userId
      ? settings
      : emptyCanvasSettings(defaultInterval);
    const setCurrentError = (message: string) => {
      if (
        activeUserIdRef.current === userId
        && accountGenerationRef.current === requestGeneration
      ) setError(message);
    };
    setError(null);

    settingsMutationVersionRef.current += 1;
    try {
      const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const legacyKey = `canvas_sync_interval_${userId}`;
      const legacyInterval = readLegacySyncInterval(userId);
      let persisted = await db.getCanvasSettings(userId);

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
        if (!persisted || persisted.sync_interval_migrated !== true) {
          setCurrentError('Could not migrate the Canvas sync interval. Please try again.');
          return false;
        }
      }

      if (!persisted) {
        persisted = await db.initializeCanvasSettings(userId, {
          ical_url: normalizedUrl,
          sync_enabled: currentSettings.syncEnabled,
          auto_sync_interval: legacyInterval ?? currentSettings.autoSyncInterval,
          sync_interval_migrated: true,
          time_zone: browserTimeZone,
        });
        if (!persisted) {
          setCurrentError('Could not connect the Canvas calendar. Please try again.');
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
        if (!persisted || persisted.sync_interval_migrated !== true) {
          setCurrentError('Could not migrate the Canvas sync interval. Please try again.');
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
      if (!saved) {
        setCurrentError('Could not connect the Canvas calendar. Please try again.');
        return false;
      }

      if (saved.sync_interval_migrated === true) {
        localStorage.removeItem(legacyKey);
      }
      if (
        activeUserIdRef.current !== userId
        || accountGenerationRef.current !== requestGeneration
      ) return false;
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
      setStateOwnerId(userId);
      return true;
    } catch (err) {
      console.error('Error connecting Canvas calendar:', err);
      setCurrentError('Could not connect the Canvas calendar. Please try again.');
      return false;
    } finally {
      // Invalidate a settings poll that began while this write was in flight.
      settingsMutationVersionRef.current += 1;
    }
  }, [accountSession.generation, defaultInterval, settings, stateOwnerId, userId]);

  const toggleAutoSync = useCallback(async () => {
    if (!userId) return;
    const requestGeneration = accountSession.generation;
    const newSyncEnabled = !(stateOwnerId === userId
      ? settings.syncEnabled
      : emptyCanvasSettings(defaultInterval).syncEnabled);

    setError(null);
    settingsMutationVersionRef.current += 1;
    const saved = await db.upsertCanvasSettings(userId, { sync_enabled: newSyncEnabled });
    settingsMutationVersionRef.current += 1;
    if (!saved && activeUserIdRef.current === userId && accountGenerationRef.current === requestGeneration) {
      setError('Could not update Canvas auto-sync. Please try again.');
      return;
    }
    if (!saved || activeUserIdRef.current !== userId || accountGenerationRef.current !== requestGeneration) return;
    setSettings(prev => ({ ...prev, syncEnabled: saved.sync_enabled }));
    setStateOwnerId(userId);
  }, [accountSession.generation, defaultInterval, settings.syncEnabled, stateOwnerId, userId]);

  const setSyncInterval = useCallback(async (minutes: number) => {
    const normalizedMinutes = normalizeSyncInterval(minutes, defaultInterval);
    if (!userId) return;
    const requestGeneration = accountSession.generation;

    setError(null);
    settingsMutationVersionRef.current += 1;
    const saved = await db.upsertCanvasSettings(userId, {
      auto_sync_interval: normalizedMinutes,
      sync_interval_migrated: true,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
    settingsMutationVersionRef.current += 1;
    if (!saved && activeUserIdRef.current === userId && accountGenerationRef.current === requestGeneration) {
      setError('Could not save the Canvas sync interval. Please try again.');
      return;
    }
    if (!saved || activeUserIdRef.current !== userId || accountGenerationRef.current !== requestGeneration) return;
    setSettings(prev => ({
      ...prev,
      autoSyncInterval: normalizeSyncInterval(saved.auto_sync_interval, normalizedMinutes),
    }));
    setStateOwnerId(userId);
    localStorage.removeItem(`canvas_sync_interval_${userId}`);
  }, [accountSession.generation, defaultInterval, userId]);

  const clearData = useCallback(async () => {
    const requestUserId = userId;
    const requestGeneration = accountSession.generation;
    if (userId) {
      settingsMutationVersionRef.current += 1;
      const deleted = await db.deleteCanvasSettings(userId);
      settingsMutationVersionRef.current += 1;
      if (!deleted) {
        if (
          activeUserIdRef.current === requestUserId
          && accountGenerationRef.current === requestGeneration
        ) setError('Could not disconnect Canvas. Please try again.');
        return;
      }
      localStorage.removeItem(`canvas_sync_interval_${userId}`);
    }

    if (
      activeUserIdRef.current !== requestUserId
      || accountGenerationRef.current !== requestGeneration
    ) return;

    setAssignments([]);
    icalUrlRef.current = '';
    setSettings(emptyCanvasSettings(defaultInterval));
    setStateOwnerId(userId);
    setError(null);
    setNewAssignmentsCount(0);
    setRemovedAssignmentsCount(0);
  }, [accountSession.generation, userId, defaultInterval]);

  return {
    assignments: visibleAssignments,
    isLoading: visibleIsLoading,
    isSyncing: syncingRequest?.userId === userId
      && syncingRequest.generation === accountSession.generation,
    error: visibleError,
    lastSyncAt: visibleSettings.lastSyncAt,
    nextSyncAt,
    settings: visibleSettings,
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
