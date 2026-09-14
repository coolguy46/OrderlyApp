export interface RateLimitPolicy {
  /** A fixed server-owned name, never a URL, body field or other user input. */
  scope: string;
  maxRequests: number;
  windowSeconds: number;
}

// Technical burst protection, not a monthly allowance or a paid feature limit.
export const RATE_LIMIT_POLICIES = {
  billingStatus: { scope: 'billing_status', maxRequests: 60, windowSeconds: 60 },
  billingCheckout: { scope: 'billing_checkout', maxRequests: 6, windowSeconds: 60 },
  billingPortal: { scope: 'billing_portal', maxRequests: 10, windowSeconds: 60 },
  billingEntitlement: { scope: 'billing_entitlement', maxRequests: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitPolicy>;

export interface RateLimitClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

type Decision = { allowed: boolean; retryAfter: number; unavailable: boolean };
const unavailable = (): Decision => ({ allowed: false, retryAfter: 5, unavailable: true });

/** Identity must already be verified with auth.getUser(); the RPC is service-only. */
export async function checkRateLimit(client: RateLimitClient | null, userId: string,
  policy: RateLimitPolicy, timeoutMs = 5_000): Promise<Decision> {
  if (!client || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(userId)
    || !/^[a-z][a-z0-9_]{0,47}$/.test(policy.scope)
    || !Number.isSafeInteger(policy.maxRequests) || policy.maxRequests < 1 || policy.maxRequests > 10_000
    || !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86_400) return unavailable();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.rpc('consume_security_rate_limit', { p_user_id: userId, p_scope: policy.scope,
        p_max_requests: policy.maxRequests, p_window_seconds: policy.windowSeconds }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Rate limit timeout')), timeoutMs); }),
    ]);
    if (result.error || !result.data || typeof result.data !== 'object') return unavailable();
    const data = result.data as Record<string, unknown>;
    if (typeof data.allowed !== 'boolean' || typeof data.retry_after !== 'number'
      || !Number.isSafeInteger(data.retry_after) || data.retry_after < 0 || data.retry_after > policy.windowSeconds
      || (data.allowed && data.retry_after !== 0) || (!data.allowed && data.retry_after === 0)) return unavailable();
    return { allowed: data.allowed, retryAfter: data.retry_after, unavailable: false };
  } catch { return unavailable(); }
  finally { clearTimeout(timer); }
}

export function rateLimitResponse(decision: Decision): Response | null {
  if (decision.allowed) return null;
  const message = decision.unavailable ? 'This action is temporarily unavailable. Please try again shortly.'
    : 'Too many requests. Please wait a moment and try again.';
  return Response.json({ error: message, reply: message, code: decision.unavailable ? 'rate_limit_unavailable' : 'rate_limited',
    saved: false, aiUsed: false }, { status: decision.unavailable ? 503 : 429,
    headers: { 'Cache-Control': 'private, no-store', 'Retry-After': String(decision.retryAfter) } });
}
