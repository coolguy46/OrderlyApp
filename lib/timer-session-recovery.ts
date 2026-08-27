import type { StudySession } from '@/lib/supabase/types';

export type StudySessionDraft = Omit<StudySession, 'created_at'>;

export type PendingStudySessionOutcome =
  | {
      kind: 'complete-focus';
      sessionsCompletedAfter: number;
      nextMode: 'shortBreak' | 'longBreak';
    }
  | { kind: 'reset-pomodoro' }
  | { kind: 'reset-stopwatch' };

export interface PendingStudySession {
  session: StudySessionDraft;
  outcome: PendingStudySessionOutcome;
  createdAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(new Date(value).getTime());
}

function parseOutcome(value: unknown): PendingStudySessionOutcome | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;

  if (value.kind === 'reset-pomodoro' || value.kind === 'reset-stopwatch') {
    return { kind: value.kind };
  }

  if (
    value.kind !== 'complete-focus' ||
    !Number.isSafeInteger(value.sessionsCompletedAfter) ||
    (value.sessionsCompletedAfter as number) < 1 ||
    (value.nextMode !== 'shortBreak' && value.nextMode !== 'longBreak')
  ) {
    return null;
  }

  return {
    kind: 'complete-focus',
    sessionsCompletedAfter: value.sessionsCompletedAfter as number,
    nextMode: value.nextMode,
  };
}

/**
 * Treat browser/database recovery data as untrusted input. Returning null keeps
 * a malformed payload from being written to a user's study-session table.
 */
export function parsePendingStudySession(
  value: unknown,
  expectedUserId: string
): PendingStudySession | null {
  if (!isRecord(value) || !isRecord(value.session)) return null;

  const session = value.session;
  const outcome = parseOutcome(value.outcome);
  if (
    !outcome ||
    typeof session.id !== 'string' ||
    session.id.length < 1 ||
    session.user_id !== expectedUserId ||
    !isNullableString(session.subject_id) ||
    !isNullableString(session.task_id) ||
    !Number.isSafeInteger(session.duration_minutes) ||
    (session.duration_minutes as number) < 1 ||
    (session.duration_minutes as number) > 24 * 60 ||
    (session.session_type !== 'pomodoro' && session.session_type !== 'free_study') ||
    !isValidIsoDate(session.started_at) ||
    !(session.ended_at === null || isValidIsoDate(session.ended_at)) ||
    !isNullableString(session.notes) ||
    !isValidIsoDate(value.createdAt)
  ) {
    return null;
  }

  return {
    session: {
      id: session.id,
      user_id: expectedUserId,
      subject_id: session.subject_id,
      task_id: session.task_id,
      duration_minutes: session.duration_minutes as number,
      session_type: session.session_type,
      started_at: session.started_at,
      ended_at: session.ended_at,
      notes: session.notes,
    },
    outcome,
    createdAt: value.createdAt,
  };
}
