import { parsePendingStudySession, type PendingStudySession } from './timer-session-recovery.ts';

export interface RecoveredTimerState {
  timerType: 'pomodoro' | 'stopwatch';
  mode: 'focus' | 'shortBreak' | 'longBreak';
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

export interface RecoveredTimerStateSelection {
  source: 'local' | 'remote';
  state: RecoveredTimerState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validIsoOrNull(value: unknown): value is string | null {
  return value === null || (
    typeof value === 'string' && Number.isFinite(new Date(value).getTime())
  );
}

function safeNonNegativeInteger(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

/** Parse both browser and database timer snapshots as untrusted input. */
export function parseRecoveredTimerState(
  value: unknown,
  expectedUserId: string,
): RecoveredTimerState | null {
  if (!isRecord(value)) return null;
  if (value.timerType !== 'pomodoro' && value.timerType !== 'stopwatch') return null;
  if (value.mode !== 'focus' && value.mode !== 'shortBreak' && value.mode !== 'longBreak') return null;
  if (
    typeof value.isRunning !== 'boolean'
    || !validIsoOrNull(value.pomodoroStartedAt)
    || !validIsoOrNull(value.stopwatchStartedAt)
    || typeof value.savedAt !== 'string'
    || !Number.isFinite(new Date(value.savedAt).getTime())
    || !safeNonNegativeInteger(value.timeLeft, 24 * 60 * 60)
    || !safeNonNegativeInteger(value.stopwatchTime)
    || typeof value.subjectId !== 'string'
    || value.subjectId.length > 200
    || !safeNonNegativeInteger(value.sessionsCompleted, 1_000_000)
    || typeof value.soundEnabled !== 'boolean'
    || typeof value.pomodoroStarted !== 'boolean'
    || typeof value.stopwatchStarted !== 'boolean'
  ) {
    return null;
  }

  return {
    timerType: value.timerType,
    mode: value.mode,
    isRunning: value.isRunning,
    pomodoroStartedAt: value.pomodoroStartedAt,
    stopwatchStartedAt: value.stopwatchStartedAt,
    savedAt: value.savedAt,
    timeLeft: value.timeLeft as number,
    stopwatchTime: value.stopwatchTime as number,
    subjectId: value.subjectId,
    sessionsCompleted: value.sessionsCompleted as number,
    soundEnabled: value.soundEnabled,
    pomodoroStarted: value.pomodoroStarted,
    stopwatchStarted: value.stopwatchStarted,
    pendingStudySession: parsePendingStudySession(value.pendingStudySession, expectedUserId),
  };
}

/**
 * Reconcile the browser checkpoint with the synced checkpoint before allowing
 * any writes. A remote tie wins because it is the last state acknowledged by
 * the server; otherwise the most recently saved valid snapshot wins.
 */
export function selectNewestRecoveredTimerState(
  localInput: unknown,
  remoteInput: unknown,
  expectedUserId: string,
): RecoveredTimerStateSelection | null {
  const local = parseRecoveredTimerState(localInput, expectedUserId);
  const remote = parseRecoveredTimerState(remoteInput, expectedUserId);
  if (!local && !remote) return null;
  if (!remote) return { source: 'local', state: local! };
  if (!local) return { source: 'remote', state: remote };

  return new Date(local.savedAt).getTime() > new Date(remote.savedAt).getTime()
    ? { source: 'local', state: local }
    : { source: 'remote', state: remote };
}
