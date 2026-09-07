import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { AssistantUsageRpcClient } from './assistant-usage';

/** Never expose this client or accept its user ID from request data. */
export function createAssistantAbuseClient(): AssistantUsageRpcClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) as unknown as AssistantUsageRpcClient;
}
