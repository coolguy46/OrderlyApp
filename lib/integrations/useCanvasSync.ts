import { useState, useEffect, useCallback, useRef } from 'react';
import { CanvasAssignment } from './canvas';

interface CanvasSettings {
  icalUrl: string;
  lastSyncAt: Date | null;
  syncEnabled: boolean;
  autoSyncInterval: number; // in minutes
}

interface UseCanvasSyncOptions {
  onSyncComplete?: (assignments: CanvasAssignment[]) => void;
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
  setIcalUrl: (url: string) => void;
  toggleAutoSync: () => void;
  setSyncInterval: (minutes: number) => void;
  clearData: () => void;
  newAssignmentsCount: number;
}

const STORAGE_KEY = 'canvas_sync_settings';
const ASSIGNMENTS_KEY = 'canvas_assignments';

/**
 * Custom hook for managing Canvas calendar sync with auto-refresh
 */
export function useCanvasSync(options: UseCanvasSyncOptions = {}): UseCanvasSyncResult {
  const {
    onSyncComplete,
    onSyncError,
    defaultInterval = 15, // Default: sync every 15 minutes
  } = options;

  // State
  const [assignments, setAssignments] = useState<CanvasAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newAssignmentsCount, setNewAssignmentsCount] = useState(0);
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

  // Load settings and cached assignments from localStorage
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setSettings({
          ...parsed,
          lastSyncAt: parsed.lastSyncAt ? new Date(parsed.lastSyncAt) : null,
        });
      }

      const savedAssignments = localStorage.getItem(ASSIGNMENTS_KEY);
      if (savedAssignments) {
        const parsed = JSON.parse(savedAssignments);
        // Convert date strings back to Date objects
        const hydrated = parsed.map((a: CanvasAssignment) => ({
          ...a,
          dueDate: a.dueDate ? new Date(a.dueDate) : undefined,
          startDate: a.startDate ? new Date(a.startDate) : undefined,
          endDate: a.endDate ? new Date(a.endDate) : undefined,
        }));
        setAssignments(hydrated);
      }
    } catch (err) {
      console.error('Error loading Canvas settings:', err);
    }
    setIsLoading(false);
  }, []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    if (!isLoading) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
  }, [settings, isLoading]);

  // Save assignments to localStorage
  useEffect(() => {
    if (!isLoading && assignments.length > 0) {
      localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
    }
  }, [assignments, isLoading]);

  // Sync function
  const syncNow = useCallback(async () => {
    if (!settings.icalUrl || isSyncing) return;

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

      setAssignments(hydratedAssignments);
      setNewAssignmentsCount(hydratedAssignments.length);
      
      const now = new Date();
      setSettings(prev => ({
        ...prev,
        lastSyncAt: now,
      }));

      // Calculate next sync time
      if (settings.syncEnabled) {
        const next = new Date(now.getTime() + settings.autoSyncInterval * 60 * 1000);
        setNextSyncAt(next);
      }

      // The callback will handle checking against the store for duplicates
      onSyncComplete?.(hydratedAssignments);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onSyncError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsSyncing(false);
    }
  }, [settings.icalUrl, settings.syncEnabled, settings.autoSyncInterval, isSyncing, onSyncComplete, onSyncError]);

  // Set up auto-sync interval
  useEffect(() => {
    // Clear existing intervals
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
      syncIntervalRef.current = null;
    }

    // Set up new interval if auto-sync is enabled and we have a URL
    if (settings.syncEnabled && settings.icalUrl && !isLoading) {
      const intervalMs = settings.autoSyncInterval * 60 * 1000;
      
      // Calculate next sync time
      const now = new Date();
      if (settings.lastSyncAt) {
        const timeSinceLastSync = now.getTime() - new Date(settings.lastSyncAt).getTime();
        const timeUntilNextSync = Math.max(0, intervalMs - timeSinceLastSync);
        
        // If it's been longer than the interval, sync immediately
        if (timeUntilNextSync === 0) {
          syncNow();
        } else {
          setNextSyncAt(new Date(now.getTime() + timeUntilNextSync));
        }
      } else if (settings.icalUrl) {
        // First sync
        syncNow();
      }

      // Set up regular interval
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
  }, [settings.syncEnabled, settings.icalUrl, settings.autoSyncInterval, isLoading]);

  // Update countdown timer
  useEffect(() => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
    }

    if (settings.syncEnabled && nextSyncAt) {
      countdownIntervalRef.current = setInterval(() => {
        const now = new Date();
        if (nextSyncAt && now >= nextSyncAt) {
          // Time to sync - the main interval will handle it
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
  const setIcalUrl = useCallback((url: string) => {
    setSettings(prev => ({ ...prev, icalUrl: url }));
    setError(null);
  }, []);

  const toggleAutoSync = useCallback(() => {
    setSettings(prev => ({ ...prev, syncEnabled: !prev.syncEnabled }));
  }, []);

  const setSyncInterval = useCallback((minutes: number) => {
    setSettings(prev => ({ ...prev, autoSyncInterval: Math.max(1, minutes) }));
  }, []);

  const clearData = useCallback(() => {
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
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ASSIGNMENTS_KEY);
  }, [defaultInterval]);

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
