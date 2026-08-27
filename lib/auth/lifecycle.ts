import type { User } from '@supabase/supabase-js';
import type { Profile } from '@/lib/supabase/types';

export const AUTH_SESSION_TIMEOUT_MS = 8_000;
export const AUTH_ACTION_TIMEOUT_MS = 15_000;
export const AUTH_PROFILE_TIMEOUT_MS = 8_000;
export const USER_DATA_TIMEOUT_MS = 15_000;

export type RegistrationResult = 'authenticated' | 'confirmation-required' | 'failed';

export class OperationTimeoutError extends Error {
  constructor(operation: string, timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms`);
    this.name = 'OperationTimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  operation: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new OperationTimeoutError(operation, timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function isAbortLikeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return error.name === 'AbortError' || message.includes('signal') || message.includes('aborted');
}

/**
 * Build a usable local profile immediately from the authenticated user. The
 * database profile can arrive a moment later without holding the entire UI on
 * a network request or a profile-trigger race.
 */
export function profileFromAuthUser(
  user: Pick<User, 'id' | 'email' | 'created_at' | 'updated_at' | 'user_metadata'>,
): Profile {
  const metadata = user.user_metadata || {};
  const now = new Date().toISOString();
  const fullName = metadata.full_name || metadata.name;
  const avatarUrl = metadata.avatar_url || metadata.picture;

  return {
    id: user.id,
    email: user.email || (typeof metadata.email === 'string' ? metadata.email : ''),
    full_name: typeof fullName === 'string' && fullName.trim() ? fullName.trim() : null,
    avatar_url: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl : null,
    total_study_time: 0,
    tasks_completed: 0,
    current_streak: 0,
    longest_streak: 0,
    created_at: user.created_at || now,
    updated_at: user.updated_at || user.created_at || now,
  };
}

export function setupCompletionKey(userId: string): string {
  return `orderly-setup-complete:${userId}`;
}

/** Prefer the canonical production origin so OAuth does not depend on which
 * Vercel alias happened to serve the sign-in page. */
export function authCallbackUrl(
  configuredSiteUrl: string | null | undefined,
  currentOrigin: string,
): string {
  const candidates = [configuredSiteUrl?.trim(), currentOrigin.trim()].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      url.pathname = '/auth/callback';
      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      // Fall through to the current browser origin when configuration is bad.
    }
  }

  throw new Error('A valid site URL is required for Google sign-in.');
}

/** Only allow redirects within this deployment after an OAuth code exchange. */
export function sanitizeAuthRedirectPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return '/';
  }

  try {
    const parsed = new URL(value, 'https://orderly.invalid');
    if (parsed.origin !== 'https://orderly.invalid') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/';
  }
}
