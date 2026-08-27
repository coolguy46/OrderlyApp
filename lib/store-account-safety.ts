import type { Profile, Task } from './supabase/types';
import type { ScheduleRecurrence } from './schedule/types';

export interface AuthUserIdentity {
  id: string;
  email?: string | null;
  created_at?: string;
  user_metadata?: Record<string, unknown>;
}

export type RegistrationOutcome = 'authenticated' | 'confirmation-required' | 'failed';

/**
 * Supabase can return a user without a session when email confirmation is
 * enabled. That identity is not authenticated yet and must never be used to
 * hydrate RLS-protected application state.
 */
export function registrationOutcomeFromSignUp(
  user: Pick<AuthUserIdentity, 'id'> | null,
  session: { user?: { id?: string } | null } | null,
): RegistrationOutcome {
  if (!user) return 'failed';
  if (!session) return 'confirmation-required';
  return session.user?.id === user.id ? 'authenticated' : 'failed';
}

/**
 * Auth sessions can be valid before the database profile trigger is visible,
 * or while the profile read is temporarily unavailable. Keep the authenticated
 * user identity usable without pretending that a failed profile read means the
 * user signed out.
 */
export function provisionalProfileFromAuthUser(user: AuthUserIdentity): Profile {
  const now = new Date().toISOString();
  const metadata = user.user_metadata || {};
  const fullName = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string'
      ? metadata.name
      : null;
  const avatarUrl = typeof metadata.avatar_url === 'string'
    ? metadata.avatar_url
    : typeof metadata.picture === 'string'
      ? metadata.picture
      : null;

  return {
    id: user.id,
    email: user.email || '',
    full_name: fullName,
    avatar_url: avatarUrl,
    total_study_time: 0,
    tasks_completed: 0,
    current_streak: 0,
    longest_streak: 0,
    created_at: user.created_at || now,
    updated_at: now,
  };
}

export function isRepeatingTaskSeries(
  task: Pick<Task, 'recurrence'>,
  scheduleRecurrence?: ScheduleRecurrence | null,
): boolean {
  return (task.recurrence !== 'none')
    || Boolean(scheduleRecurrence && scheduleRecurrence !== 'none');
}

/**
 * Account id alone is insufficient for async fencing: a user can sign out and
 * back into the same account while an old request is still in flight. The
 * generation makes that A -> B -> A sequence distinguishable.
 */
export function isCurrentAccountRequest(
  activeUserId: string | null,
  activeGeneration: number,
  requestUserId: string | null,
  requestGeneration: number,
): boolean {
  return activeUserId === requestUserId && activeGeneration === requestGeneration;
}

export interface AccountSessionFence {
  userId: string | null;
  generation: number;
}

/**
 * Move the async-request fence to a different authenticated session. Repeated
 * auth notifications for the same live account keep their generation, while
 * sign-out and account switches invalidate every request captured earlier.
 */
export function transitionAccountSessionFence(
  current: AccountSessionFence,
  nextUserId: string | null,
): AccountSessionFence {
  if (current.userId === nextUserId) return current;
  return {
    userId: nextUserId,
    generation: current.generation + 1,
  };
}

/**
 * Account cleanup is security-sensitive but browser storage and individual
 * stores can fail independently. Run every cleanup step and never let one
 * failure prevent the in-memory signed-out snapshot from being published.
 */
export function runBestEffortAccountCleanup(
  steps: ReadonlyArray<() => void>,
  onError?: (error: unknown, index: number) => void,
): void {
  steps.forEach((step, index) => {
    try {
      step();
    } catch (error) {
      try {
        onError?.(error, index);
      } catch {
        // An observer must not make best-effort cleanup throwable.
      }
    }
  });
}

/**
 * A retry with a caller-provided id upserts the same database row. Mirror that
 * idempotency in memory instead of rendering the row twice.
 */
export function prependUniqueRecordById<T extends { id: string }>(
  records: readonly T[],
  record: T,
): T[] {
  return [record, ...records.filter((candidate) => candidate.id !== record.id)];
}
