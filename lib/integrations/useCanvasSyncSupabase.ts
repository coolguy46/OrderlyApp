import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasAssignment } from './canvas';
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
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);

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
          setSettings({
            icalUrl: canvasSettings.ical_url,
            lastSyncAt: canvasSettings.last_sync_at ? new Date(canvasSettings.last_sync_at) : null,
            syncEnabled: canvasSettings.sync_enabled,
            autoSyncInterval: defaultInterval,
          });
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
    if (!settings.icalUrl || isSyncing || !userId) return;

    setIsSyncing(true);
    setError(null);

    try {
      const response = await fetch('/api/canvas/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ icalUrl: settings.icalUrl }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sync Canvas calendar');
      }

      // Convert date strings to Date objects
      const hydratedAssignments: CanvasAssignment[] = data.assignments.map((a: CanvasAssignment) => ({
        ...a,
        dueDate: a.dueDate ? new Date(a.dueDate) : undefined,
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
    }
  }, [settings, isSyncing, userId, saveSettings, onSyncComplete, onSyncError]);

  // Set up auto-sync interval
  useEffect(() => {
    // Clear existing intervals
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Set up new interval if auto-sync is enabled and we have a URL
    if (settings.syncEnabled && settings.icalUrl && !isLoading && userId) {
      const intervalMs = settings.autoSyncInterval * 60 * 1000;
      
      // Calculate next sync time
      const now = new Date();
      if (settings.lastSyncAt) {
        const timeSinceLastSync = now.getTime() - new Date(settings.lastSyncAt).getTime();
        const timeUntilNextSync = Math.max(0, intervalMs - timeSinceLastSync);
        
        if (timeUntilNextSync === 0) {
          syncNow();
        } else {
          setNextSyncAt(new Date(now.getTime() + timeUntilNextSync));
        }
      } else if (settings.icalUrl) {
        syncNow();
      }

      syncIntervalRef.current = setInterval(() => {
        syncNow();
      }, intervalMs);
    } else {
      setNextSyncAt(null);
    }

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [settings.syncEnabled, settings.icalUrl, settings.autoSyncInterval, isLoading, userId]);

  // Update countdown timer
  useEffect(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    if (settings.syncEnabled && nextSyncAt) {
      countdownIntervalRef.current = setInterval(() => {
        const now = new Date();
        if (nextSyncAt && now >= nextSyncAt) {
          setNextSyncAt(new Date(now.getTime() + settings.autoSyncInterval * 60 * 1000));
        }
      }, 1000);
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    };
  }, [nextSyncAt, settings.syncEnabled, settings.autoSyncInterval]);

  // Action functions
  const setIcalUrl = useCallback(async (url: string) => {
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
    setSettings(prev => ({ ...prev, autoSyncInterval: Math.max(1, minutes) }));
  }, []);

  const clearData = useCallback(async () => {
    setAssignments([]);
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
