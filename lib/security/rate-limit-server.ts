import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, rateLimitResponse, type RateLimitClient, type RateLimitPolicy } from './rate-limit';

/** Shared across instances; never silently replace with an in-memory counter. */
export async function enforceRateLimit(userId: string, policy: RateLimitPolicy): Promise<Response | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  let client: RateLimitClient | null = null;
  try {
    if (url && key) client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (input, init) => {
        const signal = AbortSignal.any([AbortSignal.timeout(5_000),
          ...(input instanceof Request ? [input.signal] : []), ...(init?.signal ? [init.signal] : [])]);
        signal.throwIfAborted();
        return fetch(input, { ...init, signal, redirect: 'error' });
      } },
    }) as unknown as RateLimitClient;
  } catch { /* Missing/invalid server configuration fails closed below. */ }
  return rateLimitResponse(await checkRateLimit(client, userId, policy));
}
