export const SENSITIVE_ACTION_MAX_AGE_MS = 15 * 60 * 1000;

export function hasRecentSignIn(
  lastSignInAt: string | null | undefined,
  nowMs = Date.now(),
  maxAgeMs = SENSITIVE_ACTION_MAX_AGE_MS,
): boolean {
  if (!lastSignInAt || !Number.isFinite(nowMs) || maxAgeMs <= 0) return false;
  const signedInAt = Date.parse(lastSignInAt);
  if (!Number.isFinite(signedInAt) || signedInAt > nowMs + 60_000) return false;
  return nowMs - signedInAt <= maxAgeMs;
}
