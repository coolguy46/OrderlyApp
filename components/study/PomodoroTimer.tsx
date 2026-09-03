'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import { CircularProgress } from '@/components/ui/custom-progress';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import * as timerDb from '@/lib/supabase/services';
import { requestNotificationPermission, sendDesktopNotification } from '@/lib/notifications';
import { usePathname } from 'next/navigation';
import {
  discardUnownedLegacyStorageValue,
  userScopedStorageKey,
} from '@/lib/user-scoped-storage';
import { countdownSecondsAt, stopwatchSecondsAt } from '@/lib/timer-clock';
import {
  type PendingStudySession,
  type PendingStudySessionOutcome,
} from '@/lib/timer-session-recovery';
import {
  parseRecoveredTimerState,
  selectNewestRecoveredTimerState,
  type RecoveredTimerState,
} from '@/lib/timer-state-recovery';
import {
  createSerializedTimerStateWriter,
} from '@/lib/timer-state-writer';
import {
  focusTimerStateAfterBreak,
  stopwatchStudySessionTiming,
} from '@/lib/timer-transitions';
import {
  normalizeTimerSettingsInput,
  parseTimerPresets,
  sanitizePomodoroSettings,
  type PomodoroSettingsValue,
  type TimerPreset,
} from '@/lib/timer-settings';
import {
  Play,
  Pause,
  RotateCcw,
  Settings,
  Coffee,
  Brain,
  Zap,
  Volume2,
  VolumeX,
  Timer,
  Clock,
  Trash2,
  Save,
} from 'lucide-react';

type TimerMode = 'focus' | 'shortBreak' | 'longBreak';
type TimerType = 'pomodoro' | 'stopwatch';

interface PomodoroTimerProps {
  selectedSubjectId?: string | null;
  selectedTaskId?: string | null;
}

const TIMER_STATE_STORAGE_NAMESPACE = 'orderly-timer-state';
const TIMER_RESET_PENDING_STORAGE_NAMESPACE = 'orderly-timer-reset-pending';
const LEGACY_TIMER_STATE_KEY = 'orderly-timer-state';
interface PersistedTimerState {
  timerType: TimerType;
  mode: TimerMode;
  isRunning: boolean;
  pomodoroStartedAt: string | null;
  stopwatchStartedAt: string | null;
  savedAt: string;
  timeLeft: number;
  stopwatchTime: number;
  subjectId: string;
  sessionsCompleted: number;
  soundEnabled: boolean;
  pomodoroStarted: boolean;
  stopwatchStarted: boolean;
  pendingStudySession: PendingStudySession | null;
}

type TimerDatabaseState = Omit<timerDb.TimerState, 'id' | 'user_id' | 'updated_at'>;

// Notification sound using Web Audio API
const playNotificationSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);
    
    // Play a second beep
    setTimeout(() => {
      const osc2 = audioContext.createOscillator();
      const gain2 = audioContext.createGain();
      osc2.connect(gain2);
      gain2.connect(audioContext.destination);
      osc2.frequency.value = 1000;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      osc2.start(audioContext.currentTime);
      osc2.stop(audioContext.currentTime + 0.5);
    }, 300);
    
    // Play a third beep
    setTimeout(() => {
      const osc3 = audioContext.createOscillator();
      const gain3 = audioContext.createGain();
      osc3.connect(gain3);
      gain3.connect(audioContext.destination);
      osc3.frequency.value = 1200;
      osc3.type = 'sine';
      gain3.gain.setValueAtTime(0.3, audioContext.currentTime);
      gain3.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
      osc3.start(audioContext.currentTime);
      osc3.stop(audioContext.currentTime + 0.8);
    }, 600);
  } catch {
    console.log('Audio not supported');
  }
};

export function PomodoroTimer({ selectedSubjectId, selectedTaskId }: PomodoroTimerProps) {
  const { pomodoroSettings: storedPomodoroSettings, addStudySession, subjects, user, setActiveStudy, clearActiveStudy } = useAppStore();
  const pomodoroSettings = useMemo(
    () => sanitizePomodoroSettings(storedPomodoroSettings),
    [storedPomodoroSettings],
  );
  
  const [timerType, setTimerType] = useState<TimerType>('pomodoro');
  const [mode, setMode] = useState<TimerMode>('focus');
  const [timeLeft, setTimeLeft] = useState(pomodoroSettings.focusDuration * 60);
  const [stopwatchTime, setStopwatchTime] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [sessionsCompleted, setSessions] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [subjectId, setSubjectId] = useState(selectedSubjectId || '');
  const [sessionSaveFailed, setSessionSaveFailed] = useState(false);
  const [timerStateClearFailed, setTimerStateClearFailed] = useState(false);
  const [timerStateRestoreFailed, setTimerStateRestoreFailed] = useState(false);
  const [timerStateRestoreAttempt, setTimerStateRestoreAttempt] = useState(0);
  const [pendingStudySession, setPendingStudySession] = useState<PendingStudySession | null>(null);
  const hasPendingStudySession = pendingStudySession !== null;
  
  // Presets
  const [presets, setPresets] = useState<TimerPreset[]>([]);
  const [presetsLoadedForUserId, setPresetsLoadedForUserId] = useState<string | null>(null);
  const pomodoroStartRef = useRef<Date | null>(null);
  const stopwatchStartRef = useRef<Date | null>(null);
  const pomodoroDeadlineRef = useRef<number | null>(null);
  const stopwatchRunStartedAtRef = useRef<number | null>(null);
  const stopwatchRunBaseTimeRef = useRef(0);
  const completionInFlightRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const latestTimerDatabaseStateRef = useRef<TimerDatabaseState | null>(null);
  const timerStateGenerationRef = useRef<{ userId: string; generation: number } | null>(null);
  const timerStateClearInFlightRef = useRef<string | null>(null);
  const [timerStateWriter] = useState(() =>
    createSerializedTimerStateWriter<TimerDatabaseState>({
      upsert: timerDb.upsertTimerState,
      remove: timerDb.deleteTimerState,
    })
  );
  const wasEverStartedRef = useRef(false);
  const [restoredForUserId, setRestoredForUserId] = useState<string | null>(null);
  const [pomodoroStarted, setPomodoroStarted] = useState(false);
  const [stopwatchStarted, setStopwatchStarted] = useState(false);
  const timerStarted = timerType === 'pomodoro' ? pomodoroStarted : stopwatchStarted;
  const eitherStarted = pomodoroStarted || stopwatchStarted;
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  const timerStateRestorePending = Boolean(user?.id && restoredForUserId !== user.id);

  // Request desktop notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Load presets only from the active account's browser storage.
  useEffect(() => {
    const userId = user?.id || null;
    let cancelled = false;

    // Browser storage is an external source. Restore it in a cancellable
    // microtask so account changes cannot synchronously cascade through this
    // component or apply an obsolete account's presets after cleanup.
    queueMicrotask(() => {
      if (cancelled) return;

      setPresetsLoadedForUserId(null);
      setPresets([]);
      discardUnownedLegacyStorageValue(localStorage, 'timerPresets');
      const storageKey = userScopedStorageKey('timerPresets', userId);
      if (!storageKey || !userId) return;
      const savedPresets = localStorage.getItem(storageKey);
      if (savedPresets) {
        try {
          const parsed: unknown = JSON.parse(savedPresets);
          setPresets(parseTimerPresets(parsed));
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
      setPresetsLoadedForUserId(userId);
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  // Save presets to localStorage
  useEffect(() => {
    const storageKey = userScopedStorageKey('timerPresets', user?.id);
    if (storageKey && presetsLoadedForUserId === user?.id) {
      localStorage.setItem(storageKey, JSON.stringify(presets));
    }
  }, [presets, presetsLoadedForUserId, user?.id]);

  const getDuration = useCallback((timerMode: TimerMode) => {
    switch (timerMode) {
      case 'focus':
        return pomodoroSettings.focusDuration * 60;
      case 'shortBreak':
        return pomodoroSettings.shortBreakDuration * 60;
      case 'longBreak':
        return pomodoroSettings.longBreakDuration * 60;
    }
  }, [pomodoroSettings]);

  const applySavedSessionOutcome = useCallback((outcome: PendingStudySessionOutcome) => {
    setIsRunning(false);
    pomodoroDeadlineRef.current = null;
    stopwatchRunStartedAtRef.current = null;
    completionInFlightRef.current = false;

    if (outcome.kind === 'complete-focus') {
      setSessions(outcome.sessionsCompletedAfter);
      setMode(outcome.nextMode);
      setTimeLeft(getDuration(outcome.nextMode));
      setPomodoroStarted(false);
      pomodoroStartRef.current = null;
    } else if (outcome.kind === 'reset-pomodoro') {
      setPomodoroStarted(false);
      pomodoroStartRef.current = null;
      setTimeLeft(getDuration(mode));
    } else {
      setStopwatchStarted(false);
      stopwatchStartRef.current = null;
      stopwatchRunBaseTimeRef.current = 0;
      setStopwatchTime(0);
    }

    setPendingStudySession(null);
    setSessionSaveFailed(false);
    clearActiveStudy();
  }, [clearActiveStudy, getDuration, mode]);

  const savePendingStudySession = useCallback(async (pending: PendingStudySession) => {
    // Store the exact payload before awaiting the request. It includes a stable
    // UUID, so an uncertain response can be retried without duplicating time.
    setPendingStudySession(pending);
    setSessionSaveFailed(false);
    const saved = await addStudySession(pending.session);
    if (!saved) {
      setSessionSaveFailed(true);
      completionInFlightRef.current = false;
      return false;
    }

    applySavedSessionOutcome(pending.outcome);
    return true;
  }, [addStudySession, applySavedSessionOutcome]);

  const handleTimerComplete = useCallback(async () => {
    setIsRunning(false);
    pomodoroDeadlineRef.current = null;

    if (soundEnabled) {
      playNotificationSound();
    }

    const isBreak = mode !== 'focus';
    sendDesktopNotification(
      isBreak ? '☕ Break time is over! Time to focus.' : '🎉 Focus session complete!',
      {
        body: isBreak ? 'Your break is up. Start your next focus session.' : `Great work! You completed a ${getDuration('focus') / 60} minute focus session.`,
        tag: 'pomodoro-timer',
        requireInteraction: true,
      }
    );

    if (mode === 'focus') {
      const elapsedMinutes = Math.max(1, Math.round(getDuration('focus') / 60));
      const newSessions = sessionsCompleted + 1;
      const pending: PendingStudySession = {
        session: {
          id: crypto.randomUUID(),
          user_id: user?.id || '',
          subject_id: subjectId || null,
          task_id: selectedTaskId || null,
          duration_minutes: elapsedMinutes,
          session_type: 'pomodoro',
          started_at: pomodoroStartRef.current?.toISOString() || new Date().toISOString(),
          ended_at: new Date().toISOString(),
          notes: null,
        },
        outcome: {
          kind: 'complete-focus',
          sessionsCompletedAfter: newSessions,
          nextMode: newSessions % pomodoroSettings.sessionsBeforeLongBreak === 0
            ? 'longBreak'
            : 'shortBreak',
        },
        createdAt: new Date().toISOString(),
      };
      await savePendingStudySession(pending);
      return;
    } else {
      const focusState = focusTimerStateAfterBreak(getDuration('focus'));
      setMode(focusState.mode);
      setTimeLeft(focusState.timeLeft);
    }

    pomodoroStartRef.current = null;
    setPomodoroStarted(false);
    clearActiveStudy();
  }, [
    clearActiveStudy,
    getDuration,
    mode,
    pomodoroSettings.sessionsBeforeLongBreak,
    savePendingStudySession,
    selectedTaskId,
    sessionsCompleted,
    soundEnabled,
    subjectId,
    user?.id,
  ]);

  // Derive the display from an absolute wall-clock point. Browser interval
  // callbacks are intentionally treated only as repaint opportunities because
  // they can be heavily throttled while the tab is in the background.
  useEffect(() => {
    if (!isRunning) return;

    const updateFromClock = () => {
      const now = Date.now();

      if (timerType === 'pomodoro') {
        const deadline = pomodoroDeadlineRef.current;
        if (deadline === null) return;
        const nextTimeLeft = countdownSecondsAt(deadline, now);
        setTimeLeft((previous) => previous === nextTimeLeft ? previous : nextTimeLeft);

        if (nextTimeLeft === 0 && !completionInFlightRef.current) {
          completionInFlightRef.current = true;
          void handleTimerComplete();
        }
        return;
      }

      const runStartedAt = stopwatchRunStartedAtRef.current;
      if (runStartedAt === null) return;
      const nextStopwatchTime = stopwatchSecondsAt(
        stopwatchRunBaseTimeRef.current,
        runStartedAt,
        now
      );
      setStopwatchTime((previous) => previous === nextStopwatchTime ? previous : nextStopwatchTime);
    };

    updateFromClock();
    intervalRef.current = setInterval(updateFromClock, 250);
    document.addEventListener('visibilitychange', updateFromClock);
    window.addEventListener('focus', updateFromClock);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', updateFromClock);
      window.removeEventListener('focus', updateFromClock);
    };
  }, [handleTimerComplete, isRunning, timerType]);

  // Sync active study time to store for real-time analytics
  useEffect(() => {
    if (!timerStarted) {
      clearActiveStudy();
      return;
    }
    const isFocusSession = timerType === 'pomodoro' ? mode === 'focus' : true;
    if (!isFocusSession) {
      clearActiveStudy();
      return;
    }
    const elapsed = timerType === 'pomodoro' ? getDuration(mode) - timeLeft : stopwatchTime;
    setActiveStudy(elapsed, subjectId || null);
  }, [timerStarted, timerType, mode, timeLeft, stopwatchTime, subjectId, getDuration, setActiveStudy, clearActiveStudy]);

  const handleStart = () => {
    if (hasPendingStudySession || timerStateClearFailed || timerStateRestorePending) return;
    completionInFlightRef.current = false;
    if (timerType === 'pomodoro') {
      if (!pomodoroStartRef.current && mode === 'focus') {
        pomodoroStartRef.current = new Date();
      }
      pomodoroDeadlineRef.current = Date.now() + Math.max(0, timeLeft) * 1000;
      setPomodoroStarted(true);
    } else {
      if (!stopwatchStartRef.current) {
        stopwatchStartRef.current = new Date();
      }
      stopwatchRunBaseTimeRef.current = stopwatchTime;
      stopwatchRunStartedAtRef.current = Date.now();
      setStopwatchStarted(true);
    }
    setIsRunning(true);
  };

  // Helper: apply a saved timer state to component state
  const applyRestoredState = useCallback((input: unknown, expectedUserId: string) => {
    const state = parseRecoveredTimerState(input, expectedUserId);
    if (!state) return false;
    const recoveredPendingSession = state.pendingStudySession;
    const savedAtMs = new Date(state.savedAt).getTime();
    if (!Number.isFinite(savedAtMs)) return false;
    const elapsedSinceSave = Math.max(0, Math.floor((Date.now() - savedAtMs) / 1000));

    // A timer can validly run longer than two hours (the UI supports an
    // all-day focus timer and a 24-hour stopwatch). Reconcile from its saved
    // wall-clock timestamp instead of silently discarding an owned timer based
    // on age alone; the user remains in control of explicitly resetting it.

    completionInFlightRef.current = false;
    pomodoroDeadlineRef.current = null;
    stopwatchRunStartedAtRef.current = null;
    stopwatchRunBaseTimeRef.current = 0;
    setTimerType(state.timerType);
    setMode(state.mode);
    setSubjectId(state.subjectId);
    setSessions(state.sessionsCompleted);
    setSoundEnabled(state.soundEnabled);
    setPomodoroStarted(state.pomodoroStarted);
    setStopwatchStarted(state.stopwatchStarted);
    setPendingStudySession(recoveredPendingSession);
    setSessionSaveFailed(recoveredPendingSession !== null);

    if (state.pomodoroStartedAt) {
      pomodoroStartRef.current = new Date(state.pomodoroStartedAt);
    }
    if (state.stopwatchStartedAt) {
      stopwatchStartRef.current = new Date(state.stopwatchStartedAt);
    }

    if (state.isRunning) {
      if (state.timerType === 'pomodoro') {
        setTimeLeft(Math.max(0, state.timeLeft - elapsedSinceSave));
        setStopwatchTime(state.stopwatchTime);
      } else {
        setStopwatchTime(state.stopwatchTime + elapsedSinceSave);
        setTimeLeft(state.timeLeft);
      }
    } else {
      setTimeLeft(state.timeLeft);
      setStopwatchTime(state.stopwatchTime);
    }
    // Always restore as paused — user can resume manually
    setIsRunning(false);
    return true;
  }, []);

  // Restore timer state for the active account. The local checkpoint may be
  // rendered immediately, but writes stay fenced until the database checkpoint
  // has also been read and the newest valid snapshot has been selected.
  useEffect(() => {
    const activeUserId = user?.id || null;
    let cancelled = false;

    // Treat browser/remote restoration as one cancellable asynchronous
    // transaction. This keeps an account switch from applying obsolete state
    // and avoids a synchronous chain of renders while an external source is
    // being reconciled.
    queueMicrotask(() => {
      if (cancelled) return;
      let localSnapshot: RecoveredTimerState | null = null;

      latestTimerDatabaseStateRef.current = null;
      setRestoredForUserId(null);
      wasEverStartedRef.current = false;
      pomodoroStartRef.current = null;
      stopwatchStartRef.current = null;
      pomodoroDeadlineRef.current = null;
      stopwatchRunStartedAtRef.current = null;
      stopwatchRunBaseTimeRef.current = 0;
      completionInFlightRef.current = false;
      timerStateGenerationRef.current = null;
      setTimerType('pomodoro');
      setMode('focus');
      setIsRunning(false);
      setTimeLeft(useAppStore.getState().pomodoroSettings.focusDuration * 60);
      setStopwatchTime(0);
      setSubjectId(selectedSubjectId || '');
      setSessions(0);
      setSoundEnabled(true);
      setPomodoroStarted(false);
      setStopwatchStarted(false);
      setSessionSaveFailed(false);
      setTimerStateClearFailed(false);
      setTimerStateRestoreFailed(false);
      setPendingStudySession(null);
      clearActiveStudy();

      if (!activeUserId) return;

      const storageKey = userScopedStorageKey(TIMER_STATE_STORAGE_NAMESPACE, activeUserId);
      if (!storageKey) return;
      const resetPendingKey = userScopedStorageKey(
        TIMER_RESET_PENDING_STORAGE_NAMESPACE,
        activeUserId,
      );

      // An earlier explicit reset may still be waiting for its remote delete.
      // The tombstone prevents a stale database checkpoint from resurrecting
      // the timer after reload and leaves a visible retry action for the user.
      if (resetPendingKey && localStorage.getItem(resetPendingKey) === '1') {
        localStorage.removeItem(storageKey);
        setTimerStateClearFailed(true);
        setRestoredForUserId(activeUserId);
        return;
      }

      // The old global value has no owner field, so importing it into the
      // active account would risk restoring another person's timer and subject.
      discardUnownedLegacyStorageValue(localStorage, LEGACY_TIMER_STATE_KEY);

      // Render this user's local checkpoint immediately, while keeping the
      // restore gate closed until its remote checkpoint has been reconciled.
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          localSnapshot = parseRecoveredTimerState(JSON.parse(saved), activeUserId);
          if (localSnapshot) {
            applyRestoredState(localSnapshot, activeUserId);
          } else {
            localStorage.removeItem(storageKey);
          }
        } catch {
          localStorage.removeItem(storageKey);
        }
      }

      // Always read the synced row. Skipping this read when localStorage exists
      // lets an older tab overwrite a newer checkpoint from another device.
      void timerDb.getTimerState(activeUserId).then((dbState) => {
        if (cancelled) return;
        const remoteSnapshot = dbState
          ? {
            timerType: dbState.timer_type,
            mode: dbState.mode,
            isRunning: dbState.is_running,
            pomodoroStartedAt: dbState.pomodoro_started_at,
            stopwatchStartedAt: dbState.stopwatch_started_at,
            savedAt: dbState.updated_at,
            timeLeft: dbState.time_left,
            stopwatchTime: dbState.stopwatch_time,
            subjectId: dbState.subject_id || '',
            sessionsCompleted: dbState.sessions_completed,
            soundEnabled: dbState.sound_enabled,
            pomodoroStarted: dbState.pomodoro_started,
            stopwatchStarted: dbState.stopwatch_started,
            pendingStudySession: dbState.pending_session,
          }
          : null;
        const newest = selectNewestRecoveredTimerState(
          localSnapshot,
          remoteSnapshot,
          activeUserId,
        );
        if (newest && applyRestoredState(newest.state, activeUserId)) {
          wasEverStartedRef.current = true;
        }
        setRestoredForUserId(activeUserId);
      }).catch((error) => {
        if (cancelled) return;
        console.error('Failed to restore synced timer state:', error);
        // A remote read outage is not evidence that no newer checkpoint exists.
        // Keep writes/start blocked and let the user retry explicitly.
        setTimerStateRestoreFailed(true);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [applyRestoredState, clearActiveStudy, selectedSubjectId, timerStateRestoreAttempt, user?.id]);

  // Track that a timer was started (to avoid DB delete on initial mount)
  useEffect(() => {
    if (eitherStarted) wasEverStartedRef.current = true;
  }, [eitherStarted]);

  const clearPersistedTimerState = useCallback(async (accountId: string) => {
    if (timerStateClearInFlightRef.current) return false;
    timerStateClearInFlightRef.current = accountId;
    const storageKey = userScopedStorageKey(TIMER_STATE_STORAGE_NAMESPACE, accountId);
    const resetPendingKey = userScopedStorageKey(
      TIMER_RESET_PENDING_STORAGE_NAMESPACE,
      accountId,
    );
    if (resetPendingKey) localStorage.setItem(resetPendingKey, '1');
    if (storageKey) localStorage.removeItem(storageKey);

    try {
      await timerStateWriter.clear(accountId);
      if (storageKey) localStorage.removeItem(storageKey);
      if (resetPendingKey) localStorage.removeItem(resetPendingKey);
      if (useAppStore.getState().user?.id === accountId) {
        wasEverStartedRef.current = false;
        timerStateGenerationRef.current = null;
        setTimerStateClearFailed(false);
      }
      return true;
    } catch (error) {
      console.error('Failed to clear persisted timer state:', error);
      if (useAppStore.getState().user?.id === accountId) {
        setTimerStateClearFailed(true);
        toast.error('The timer was reset here, but its synced recovery copy could not be cleared. Retry before starting another timer.');
      }
      return false;
    } finally {
      if (timerStateClearInFlightRef.current === accountId) {
        timerStateClearInFlightRef.current = null;
      }
    }
  }, [timerStateWriter]);

  // Persist the latest timer state locally on each tick. Keep the database
  // payload in a ref so a fixed checkpoint interval can save current state
  // without being postponed by every one-second countdown render.
  useEffect(() => {
    const activeUserId = user?.id || null;
    const storageKey = userScopedStorageKey(TIMER_STATE_STORAGE_NAMESPACE, activeUserId);
    // Never persist while logged out or while another user's state is still in
    // memory during an account transition.
    if (!activeUserId || !storageKey || restoredForUserId !== activeUserId) return;

    if (!eitherStarted) {
      // Only delete from DB if a timer was actually started and then stopped
      if (wasEverStartedRef.current) {
        void clearPersistedTimerState(activeUserId);
      } else {
        localStorage.removeItem(storageKey);
      }
      latestTimerDatabaseStateRef.current = null;
      return;
    }

    if (timerStateGenerationRef.current?.userId !== activeUserId) {
      timerStateGenerationRef.current = {
        userId: activeUserId,
        generation: timerStateWriter.begin(activeUserId),
      };
    }
    const state: PersistedTimerState = {
      timerType, mode, isRunning,
      pomodoroStartedAt: pomodoroStartRef.current?.toISOString() || null,
      stopwatchStartedAt: stopwatchStartRef.current?.toISOString() || null,
      savedAt: new Date().toISOString(),
      timeLeft, stopwatchTime,
      subjectId, sessionsCompleted, soundEnabled,
      pomodoroStarted, stopwatchStarted,
      pendingStudySession,
    };
    localStorage.setItem(storageKey, JSON.stringify(state));

    latestTimerDatabaseStateRef.current = {
      timer_type: timerType,
      mode,
      is_running: isRunning,
      pomodoro_started_at: pomodoroStartRef.current?.toISOString() || null,
      stopwatch_started_at: stopwatchStartRef.current?.toISOString() || null,
      time_left: timeLeft,
      stopwatch_time: stopwatchTime,
      subject_id: subjectId || null,
      sessions_completed: sessionsCompleted,
      sound_enabled: soundEnabled,
      pomodoro_started: pomodoroStarted,
      stopwatch_started: stopwatchStarted,
      pending_session: pendingStudySession,
    };
  }, [clearPersistedTimerState, restoredForUserId, eitherStarted, timerType, mode, isRunning, timeLeft, stopwatchTime, subjectId, sessionsCompleted, soundEnabled, pomodoroStarted, stopwatchStarted, pendingStudySession, timerStateWriter, user?.id]);

  useEffect(() => {
    const activeUserId = user?.id || null;
    if (!activeUserId || restoredForUserId !== activeUserId || !eitherStarted) return;
    const activeGeneration = timerStateGenerationRef.current;
    if (!activeGeneration || activeGeneration.userId !== activeUserId) return;

    const checkpoint = () => {
      const state = latestTimerDatabaseStateRef.current;
      if (!state) return;

      const checkpointState = { ...state };
      const now = Date.now();
      if (checkpointState.is_running && checkpointState.timer_type === 'pomodoro') {
        const deadline = pomodoroDeadlineRef.current;
        if (deadline !== null) checkpointState.time_left = countdownSecondsAt(deadline, now);
      } else if (checkpointState.is_running && checkpointState.timer_type === 'stopwatch') {
        const runStartedAt = stopwatchRunStartedAtRef.current;
        if (runStartedAt !== null) {
          checkpointState.stopwatch_time = stopwatchSecondsAt(
            stopwatchRunBaseTimeRef.current,
            runStartedAt,
            now
          );
        }
      }
      void timerStateWriter.save(
        activeUserId,
        activeGeneration.generation,
        checkpointState
      ).catch((error) => {
        // The user-scoped local checkpoint remains authoritative for recovery;
        // avoid an unhandled rejection while the remote service is offline.
        console.error('Failed to checkpoint timer state:', error);
      });
    };
    const checkpointInterval = window.setInterval(checkpoint, 10_000);
    return () => {
      window.clearInterval(checkpointInterval);
      checkpoint();
    };
  }, [eitherStarted, restoredForUserId, timerStateWriter, user?.id]);

  const handlePause = useCallback(() => {
    const now = Date.now();
    if (timerType === 'pomodoro') {
      const deadline = pomodoroDeadlineRef.current;
      if (deadline !== null) setTimeLeft(countdownSecondsAt(deadline, now));
      pomodoroDeadlineRef.current = null;
    } else {
      const runStartedAt = stopwatchRunStartedAtRef.current;
      if (runStartedAt !== null) {
        const elapsed = stopwatchSecondsAt(stopwatchRunBaseTimeRef.current, runStartedAt, now);
        stopwatchRunBaseTimeRef.current = elapsed;
        setStopwatchTime(elapsed);
      }
      stopwatchRunStartedAtRef.current = null;
    }
    setIsRunning(false);
  }, [timerType]);

  // Navigating away pauses the timer after first reconciling it to the wall
  // clock, so no elapsed second is lost at the route boundary.
  useEffect(() => {
    if (prevPathnameRef.current === pathname) return;
    prevPathnameRef.current = pathname;
    if (pathname !== '/study' && isRunning) handlePause();
  }, [handlePause, isRunning, pathname]);

  const handleReset = async () => {
    if (pendingStudySession) {
      await savePendingStudySession(pendingStudySession);
      return;
    }

    completionInFlightRef.current = false;
    setIsRunning(false);
    const now = Date.now();
    const effectiveTimeLeft = pomodoroDeadlineRef.current === null
      ? timeLeft
      : countdownSecondsAt(pomodoroDeadlineRef.current, now);
    const effectiveStopwatchTime = stopwatchRunStartedAtRef.current === null
      ? stopwatchTime
      : stopwatchSecondsAt(
          stopwatchRunBaseTimeRef.current,
          stopwatchRunStartedAtRef.current,
          now
        );
    pomodoroDeadlineRef.current = null;
    stopwatchRunStartedAtRef.current = null;

    // Auto-save the session before resetting (minimum 1 minute)
    if (timerType === 'pomodoro' && pomodoroStartRef.current && mode === 'focus') {
      const elapsedSeconds = getDuration('focus') - effectiveTimeLeft;
      if (elapsedSeconds >= 60) {
        const pending: PendingStudySession = {
          session: {
            id: crypto.randomUUID(),
            user_id: user?.id || '',
            subject_id: subjectId || null,
            task_id: selectedTaskId || null,
            duration_minutes: Math.round(elapsedSeconds / 60),
            session_type: 'pomodoro',
            started_at: pomodoroStartRef.current.toISOString(),
            ended_at: new Date().toISOString(),
            notes: null,
          },
          outcome: { kind: 'reset-pomodoro' },
          createdAt: new Date().toISOString(),
        };
        await savePendingStudySession(pending);
        return;
      }
      setPomodoroStarted(false);
      pomodoroStartRef.current = null;
      setTimeLeft(getDuration(mode));
    } else if (timerType === 'stopwatch') {
      if (effectiveStopwatchTime >= 60) {
        const endedAt = new Date().toISOString();
        const timing = stopwatchStudySessionTiming(
          effectiveStopwatchTime,
          stopwatchStartRef.current?.toISOString() || null,
          endedAt,
        );
        if (timing.wasTruncated) {
          toast.warning('This stopwatch exceeded 24 hours. Orderly will save the most recent 24 hours so the timer can reset.');
        }
        const pending: PendingStudySession = {
          session: {
            id: crypto.randomUUID(),
            user_id: user?.id || '',
            subject_id: subjectId || null,
            task_id: selectedTaskId || null,
            duration_minutes: timing.durationMinutes,
            session_type: 'free_study',
            started_at: timing.startedAt,
            ended_at: timing.endedAt,
            notes: null,
          },
          outcome: { kind: 'reset-stopwatch' },
          createdAt: new Date().toISOString(),
        };
        await savePendingStudySession(pending);
        return;
      }
      setStopwatchStarted(false);
      stopwatchStartRef.current = null;
      stopwatchRunBaseTimeRef.current = 0;
      setStopwatchTime(0);
    } else {
      // Pomodoro break mode or no elapsed time - just reset
      setPomodoroStarted(false);
      pomodoroStartRef.current = null;
      setTimeLeft(getDuration(mode));
    }

    clearActiveStudy();
  };

  const handleModeChange = (newMode: TimerMode) => {
    if (hasPendingStudySession) return;
    completionInFlightRef.current = false;
    pomodoroDeadlineRef.current = null;
    setIsRunning(false);
    setPomodoroStarted(false);
    setMode(newMode);
    setTimeLeft(getDuration(newMode));
    pomodoroStartRef.current = null;
    clearActiveStudy();
  };

  const handleTimerTypeChange = (newType: TimerType) => {
    if (hasPendingStudySession) return;
    if (newType === timerType) return;
    if (isRunning) handlePause();
    setTimerType(newType);
  };

  const handleSettingsApplied = (settings: PomodoroSettingsValue) => {
    if (hasPendingStudySession || eitherStarted || timerType !== 'pomodoro') return;

    completionInFlightRef.current = false;
    pomodoroDeadlineRef.current = null;
    setIsRunning(false);
    const nextDuration = mode === 'focus'
      ? settings.focusDuration
      : mode === 'shortBreak'
        ? settings.shortBreakDuration
        : settings.longBreakDuration;
    setTimeLeft(nextDuration * 60);
  };

  const formatTime = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const progress = timerType === 'pomodoro' 
    ? ((getDuration(mode) - timeLeft) / getDuration(mode)) * 100
    : 0;


  const modeConfig = {
    focus: { label: 'Focus', icon: Brain, color: '#6366f1' },
    shortBreak: { label: 'Short Break', icon: Coffee, color: '#10b981' },
    longBreak: { label: 'Long Break', icon: Zap, color: '#f59e0b' },
  };

  const CurrentIcon = modeConfig[mode].icon;

  return (
    <Card className="max-w-md mx-auto glow-border">
      <CardContent className="p-4">
        {/* Timer Type Toggle */}
        <div className="flex items-center justify-center gap-2 mb-4 relative">
          <button
            type="button"
            onClick={() => handleTimerTypeChange('pomodoro')}
            disabled={hasPendingStudySession}
            aria-pressed={timerType === 'pomodoro'}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              timerType === 'pomodoro'
                ? 'text-indigo-400'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {timerType === 'pomodoro' && (
              <motion.div
                layoutId="timerTypeIndicator"
                className="absolute inset-0 bg-indigo-500/20 border border-indigo-500/30 rounded-xl"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Timer className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Pomodoro</span>
          </button>
          <button
            type="button"
            onClick={() => handleTimerTypeChange('stopwatch')}
            disabled={hasPendingStudySession}
            aria-pressed={timerType === 'stopwatch'}
            className={cn(
              'relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all',
              timerType === 'stopwatch'
                ? 'text-green-400'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            {timerType === 'stopwatch' && (
              <motion.div
                layoutId="timerTypeIndicator"
                className="absolute inset-0 bg-green-500/20 border border-green-500/30 rounded-xl"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
            <Clock className="w-4 h-4 relative z-10" />
            <span className="relative z-10">Stopwatch</span>
          </button>
        </div>

        {/* Mode Selector (Pomodoro only) */}
        {timerType === 'pomodoro' && (
          <div className="flex items-center justify-center gap-1 mb-6">
            {(Object.keys(modeConfig) as TimerMode[]).map((m) => (
              <button
                type="button"
                key={m}
                onClick={() => handleModeChange(m)}
                disabled={hasPendingStudySession}
                aria-pressed={mode === m}
                className={cn(
                  'relative px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  mode === m
                    ? 'text-white'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {mode === m && (
                  <motion.div
                    layoutId="pomodoroModeIndicator"
                    className="absolute inset-0 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{modeConfig[m].label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Timer Display */}
        <div className="flex flex-col items-center justify-center mb-6">
          <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative">
            <CircularProgress
              value={timerType === 'pomodoro' ? progress : (stopwatchTime % 3600) / 36}
              max={100}
              size={200}
              strokeWidth={10}
              showLabel={false}
              color={timerType === 'pomodoro' ? modeConfig[mode].color : '#10b981'}
            >
              <div className="text-center">
                {timerType === 'pomodoro' && <CurrentIcon aria-hidden="true" className="w-6 h-6 mx-auto mb-1 text-muted-foreground" />}
                {timerType === 'stopwatch' && <Clock aria-hidden="true" className="w-6 h-6 mx-auto mb-1 text-green-400" />}
                <motion.span
                  key={timerType === 'pomodoro' ? timeLeft : stopwatchTime}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  className="text-4xl font-bold text-foreground font-mono"
                >
                  {timerType === 'pomodoro' ? formatTime(timeLeft) : formatTime(stopwatchTime)}
                </motion.span>
                <p className="text-xs text-muted-foreground mt-1">
                  {timerType === 'pomodoro' ? modeConfig[mode].label : 'Stopwatch'}
                </p>
              </div>
            </CircularProgress>

            {isRunning && (
              <motion.div
                animate={{ opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-0 rounded-full"
                style={{ boxShadow: `0 0 40px ${timerType === 'pomodoro' ? modeConfig[mode].color : '#10b981'}40` }}
              />
            )}
          </motion.div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-3 mb-4">
          <button
            type="button"
            onClick={handleReset}
            disabled={hasPendingStudySession && !sessionSaveFailed}
            aria-label={`Reset ${timerType === 'pomodoro' ? modeConfig[mode].label.toLowerCase() : 'stopwatch'} timer`}
            className="p-2.5 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="button"
            onClick={isRunning ? handlePause : handleStart}
            disabled={hasPendingStudySession || timerStateClearFailed || timerStateRestorePending}
            aria-label={isRunning
              ? `Pause ${timerType === 'pomodoro' ? 'timer' : 'stopwatch'}`
              : `${timerStarted ? 'Resume' : 'Start'} ${timerType === 'pomodoro' ? 'timer' : 'stopwatch'}`}
            className={cn(
              'w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50',
              isRunning
                ? 'bg-gradient-to-r from-orange-500 to-red-600 shadow-orange-500/25'
                : 'bg-gradient-to-r from-indigo-500 to-purple-600 shadow-indigo-500/25'
            )}
          >
            {isRunning ? <Pause className="w-5 h-5 text-white" /> : <Play className="w-5 h-5 text-white ml-0.5" />}
          </motion.button>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            disabled={eitherStarted || hasPendingStudySession}
            aria-label="Open timer settings"
            className="p-2.5 rounded-xl bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-all disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {sessionSaveFailed && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100"
          >
            <p className="font-medium">This session has not been saved yet.</p>
            <p className="mt-1 text-xs text-red-200/80">
              The timer is being kept in place so the time is not silently lost. Retry before starting another session.
            </p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={handleReset}>
              Retry saving
            </Button>
          </div>
        )}

        {timerStateClearFailed && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-100"
          >
            <p className="font-medium">The synced recovery copy could not be cleared.</p>
            <p className="mt-1 text-xs text-red-200/80">
              Orderly recorded the reset on this device so the old timer cannot silently return. Retry when the connection is available.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => user?.id && void clearPersistedTimerState(user.id)}
            >
              Retry clearing
            </Button>
          </div>
        )}

        {timerStateRestoreFailed && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100"
          >
            <p className="font-medium">Orderly could not check your synced timer.</p>
            <p className="mt-1 text-xs text-amber-200/80">
              Starting is paused so an existing recovery copy cannot be overwritten during the connection problem.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => {
                setTimerStateRestoreFailed(false);
                setTimerStateRestoreAttempt(attempt => attempt + 1);
              }}
            >
              Retry recovery check
            </Button>
          </div>
        )}



        {/* Subject Selector */}
        <div className="mb-3 space-y-1">
          <Label htmlFor="pomodoro-subject" className="text-xs">Studying for</Label>
          <Select
            value={subjectId || "none"}
            onValueChange={(value) => setSubjectId(value === "none" ? "" : value)}
            disabled={hasPendingStudySession}
          >
            <SelectTrigger id="pomodoro-subject" className="h-8 text-sm">
              <SelectValue placeholder="Select a subject (optional)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No subject</SelectItem>
              {subjects.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sessions Counter */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              {Array.from({ length: pomodoroSettings.sessionsBeforeLongBreak }).map((_, i) => (
                <motion.div
                  key={i}
                  initial={false}
                  animate={{
                    scale: i < (sessionsCompleted % pomodoroSettings.sessionsBeforeLongBreak) ? [1, 1.3, 1] : 1,
                    backgroundColor: i < (sessionsCompleted % pomodoroSettings.sessionsBeforeLongBreak) ? 'rgb(99 102 241)' : 'rgb(99 102 241 / 0.2)',
                  }}
                  transition={{ duration: 0.3 }}
                  className="w-2.5 h-2.5 rounded-full"
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{sessionsCompleted} sessions</span>
          </div>

          <button
            type="button"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Mute timer sounds' : 'Enable timer sounds'}
            aria-pressed={soundEnabled}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </CardContent>

      {/* Settings Modal */}
      <PomodoroSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onApplySettings={handleSettingsApplied}
        presets={presets}
        setPresets={setPresets}
      />
    </Card>
  );
}

function PomodoroSettings({ isOpen, onClose, onApplySettings, presets, setPresets }: {
  isOpen: boolean; 
  onClose: () => void;
  onApplySettings: (settings: PomodoroSettingsValue) => void;
  presets: TimerPreset[];
  setPresets: (presets: TimerPreset[]) => void;
}) {
  const { pomodoroSettings: storedPomodoroSettings, updatePomodoroSettings } = useAppStore();
  const pomodoroSettings = useMemo(
    () => sanitizePomodoroSettings(storedPomodoroSettings),
    [storedPomodoroSettings],
  );
  
  // Split duration into hours, minutes, seconds
  const totalFocusSeconds = pomodoroSettings.focusDuration * 60;
  const [focusHours, setFocusHours] = useState(Math.floor(totalFocusSeconds / 3600).toString());
  const [focusMinutes, setFocusMinutes] = useState(Math.floor((totalFocusSeconds % 3600) / 60).toString());
  const [focusSeconds, setFocusSeconds] = useState((totalFocusSeconds % 60).toString());
  
  const [shortBreakMinutes, setShortBreakMinutes] = useState(pomodoroSettings.shortBreakDuration.toString());
  const [longBreakMinutes, setLongBreakMinutes] = useState(pomodoroSettings.longBreakDuration.toString());
  const [sessionsBeforeLongBreak, setSessionsBeforeLongBreak] = useState(pomodoroSettings.sessionsBeforeLongBreak.toString());
  
  const [newPresetName, setNewPresetName] = useState('');

  const normalizedInput = () => normalizeTimerSettingsInput({
    focusHours,
    focusMinutes,
    focusSeconds,
    shortBreakMinutes,
    longBreakMinutes,
    sessionsBeforeLongBreak,
  });

  const handleSave = () => {
    const { settings: nextSettings } = normalizedInput();
    updatePomodoroSettings(nextSettings);
    onApplySettings(nextSettings);
    onClose();
  };

  const handleSavePreset = () => {
    const name = newPresetName.trim().slice(0, 80);
    if (!name) return;
    const { presetFields } = normalizedInput();
    const newPreset: TimerPreset = {
      id: crypto.randomUUID(),
      name,
      ...presetFields,
    };

    setPresets(parseTimerPresets([...presets, newPreset]));
    setNewPresetName('');
  };

  const handleLoadPreset = (preset: TimerPreset) => {
    setFocusHours(preset.focusHours.toString());
    setFocusMinutes(preset.focusMinutes.toString());
    setFocusSeconds(preset.focusSeconds.toString());
    setShortBreakMinutes(preset.shortBreakMinutes.toString());
    setLongBreakMinutes(preset.longBreakMinutes.toString());
    setSessionsBeforeLongBreak(preset.sessionsBeforeLongBreak.toString());
  };

  const handleDeletePreset = (id: string) => {
    setPresets(presets.filter(p => p.id !== id));
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="text-lg">Timer Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto">
          {/* Focus Duration with H:M:S */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Focus Duration</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="pomodoro-focus-hours" className="text-xs text-muted-foreground">Hours</Label>
                <Input
                  id="pomodoro-focus-hours"
                  type="number"
                  min="0"
                  max="23"
                  value={focusHours}
                  onChange={(e) => setFocusHours(e.target.value)}
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="pomodoro-focus-minutes" className="text-xs text-muted-foreground">Minutes</Label>
                <Input
                  id="pomodoro-focus-minutes"
                  type="number"
                  min="0"
                  max="59"
                  value={focusMinutes}
                  onChange={(e) => setFocusMinutes(e.target.value)}
                  className="h-8"
                />
              </div>
              <div>
                <Label htmlFor="pomodoro-focus-seconds" className="text-xs text-muted-foreground">Seconds</Label>
                <Input
                  id="pomodoro-focus-seconds"
                  type="number"
                  min="0"
                  max="59"
                  value={focusSeconds}
                  onChange={(e) => setFocusSeconds(e.target.value)}
                  className="h-8"
                />
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pomodoro-short-break" className="text-sm">Short Break (min)</Label>
              <Input id="pomodoro-short-break" type="number" min="1" max="30" value={shortBreakMinutes} onChange={(e) => setShortBreakMinutes(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pomodoro-long-break" className="text-sm">Long Break (min)</Label>
              <Input id="pomodoro-long-break" type="number" min="1" max="60" value={longBreakMinutes} onChange={(e) => setLongBreakMinutes(e.target.value)} className="h-8" />
            </div>
          </div>
          
          <div className="space-y-1">
            <Label htmlFor="pomodoro-sessions-before-long-break" className="text-sm">Sessions before Long Break</Label>
            <Input id="pomodoro-sessions-before-long-break" type="number" min="1" max="10" value={sessionsBeforeLongBreak} onChange={(e) => setSessionsBeforeLongBreak(e.target.value)} className="h-8" />
          </div>

          {/* Presets */}
          <div className="border-t pt-3">
            <Label className="text-sm font-medium">Presets</Label>
            
            {presets.length > 0 && (
              <div className="space-y-1 mt-2">
                {presets.map((preset) => (
                  <div key={preset.id} className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
                    <button type="button" onClick={() => handleLoadPreset(preset)} className="text-sm font-medium hover:text-primary">
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(preset.id)}
                      aria-label={`Delete ${preset.name} preset`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="flex gap-2 mt-2">
              <Input
                aria-label="New preset name"
                placeholder="Preset name..."
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                className="h-8 flex-1"
              />
              <Button aria-label="Save timer preset" onClick={handleSavePreset} size="sm" variant="outline" disabled={!newPresetName.trim()} className="h-8">
                <Save className="w-3 h-3" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onClose} className="flex-1 h-8">Cancel</Button>
            <Button onClick={handleSave} className="flex-1 h-8">Save</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
