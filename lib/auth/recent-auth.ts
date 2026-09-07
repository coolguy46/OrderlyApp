export const SENSITIVE_ACTION_MAX_AGE_MS = 15 * 60 * 1000;

/** Call only with server-verified claims; token refresh and another device's login are not reauthentication. */
export function hasRecentSessionAuthentication(
  claims: { sub?: unknown; amr?: unknown; is_anonymous?: unknown } | null | undefined,
  userId: string,
  nowMs = Date.now(),
): boolean {
  if (!claims || !userId || claims.sub !== userId || claims.is_anonymous === true || !Array.isArray(claims.amr)) return false;
  const methods = new Set(['password', 'oauth', 'otp', 'totp', 'sso/saml', 'magiclink', 'email/signup']);
  return claims.amr.some((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !methods.has(method) || typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)) return false;
    const millis = timestamp * 1000;
    return Number.isFinite(nowMs) && millis <= nowMs + 60_000 && millis >= nowMs - SENSITIVE_ACTION_MAX_AGE_MS;
  });
}

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
