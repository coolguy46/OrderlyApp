import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { AssistantUsageRpcClient } from './assistant-usage';
import { createDeadlineFetch } from '../security/server-fetch';

/** Never expose this client or accept its user ID from request data. */
export function createAssistantAbuseClient(deadline?: number): AssistantUsageRpcClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: createDeadlineFetch(deadline, 5_000) },
  }) as unknown as AssistantUsageRpcClient;
}
