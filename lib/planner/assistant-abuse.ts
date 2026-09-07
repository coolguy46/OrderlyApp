import type { AssistantUsageRpcClient } from './assistant-usage';

export interface AssistantLease {
  allowed: boolean;
  reason: 'allowed' | 'rate' | 'concurrency' | 'duplicate' | 'completed' | 'unavailable';
  retryAfter: number;
  leaseId: string | null;
}

export async function acquireAssistantLease(client: AssistantUsageRpcClient | null, userId: string, requestId: string,
  environment: NodeJS.ProcessEnv = process.env): Promise<AssistantLease> {
  const unavailable: AssistantLease = { allowed: false, reason: 'unavailable', retryAfter: 5, leaseId: null };
  if (!client) return unavailable;
  const configured = Number(environment.DEEPSEEK_REQUESTS_PER_MINUTE);
  try {
    const result = await client.rpc('assistant_acquire_ai_lease', {
      p_user_id: userId, p_request_id: requestId,
      p_per_minute: Number.isFinite(configured) && configured >= 1 ? Math.min(60, Math.floor(configured)) : 6,
      p_max_concurrent: 2,
    });
    if (result.error || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return unavailable;
    const value = result.data as Record<string, unknown>;
    if (typeof value.allowed !== 'boolean' || !['allowed', 'rate', 'concurrency', 'duplicate', 'completed'].includes(String(value.reason))) return unavailable;
    if (value.allowed !== (value.reason === 'allowed')) return unavailable;
    const leaseId = typeof value.lease_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.lease_id) ? value.lease_id : null;
    if (value.allowed && !leaseId) return unavailable;
    return { allowed: value.allowed, reason: value.reason as AssistantLease['reason'],
      leaseId,
      retryAfter: typeof value.retry_after === 'number' && Number.isFinite(value.retry_after) ? Math.max(0, Math.min(90, Math.ceil(value.retry_after))) : 5 };
  } catch { return unavailable; }
}

export async function releaseAssistantLease(client: AssistantUsageRpcClient | null, userId: string, leaseId: string | null): Promise<void> {
  // Expiry is the fallback if the network disappears or the server is stopped.
  if (!leaseId) return;
  try { await client?.rpc('assistant_release_ai_lease', { p_user_id: userId, p_lease_id: leaseId }); } catch { /* lease expires */ }
}

export function assistantLeaseFailure(lease: AssistantLease): { message: string; status: number; headers: Record<string, string> } {
  return {
    message: lease.reason === 'unavailable' ? 'Assistant safety checks are temporarily unavailable. Please try again shortly.'
      : lease.reason === 'rate' ? 'You are sending messages too quickly. Wait a minute and try again.'
        : 'Another Assistant request is still processing. Wait a moment, then retry to check its saved result.',
    status: lease.reason === 'unavailable' ? 503 : lease.reason === 'duplicate' || lease.reason === 'completed' ? 409 : 429,
    headers: { 'Retry-After': String(lease.retryAfter) },
  };
}
