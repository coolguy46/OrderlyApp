import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';
import { clearCurrentProjectAuthStorage, withLogoutTransportDeadline } from '@/lib/auth/logout-safety';

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredSupabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseConfigured = Boolean(configuredSupabaseUrl && configuredSupabasePublishableKey);

// The SDK requires syntactically valid values at module initialization. Point
// a misconfigured development/build environment at a closed loopback port,
// never at a network-reachable placeholder that could receive credentials.
export const supabaseUrl = configuredSupabaseUrl || 'http://127.0.0.1:1';
export const supabasePublishableKey = configuredSupabasePublishableKey || 'supabase-not-configured';

const logoutBoundedFetch = withLogoutTransportDeadline(fetch, supabaseUrl);

// Keep cancellation errors out of raw diagnostics; logout has an actual HTTP
// deadline so the SDK can finish clearing its cookies before the UI proceeds.
const safeFetch: typeof fetch = async (input, init) => {
  try {
    return await logoutBoundedFetch(input, init);
  } catch (err: unknown) {
    const requestError = err && typeof err === 'object'
      ? err as { name?: string; message?: string }
      : null;
    if (requestError?.name === 'AbortError' || requestError?.message?.includes('signal is aborted')) {
      // The installed SDK handles this as a failed request, not success.
      return new Response(null, { status: 499, statusText: 'Client Closed Request' });
    }
    throw err;
  }
};

// Create the Supabase browser client
export const supabase = createBrowserClient<Database>(supabaseUrl, supabasePublishableKey, {
  global: { fetch: safeFetch },
  auth: {
    // @supabase/ssr persists sessions in cookies shared with server rendering.
    persistSession: true,
    // Don't auto-refresh in the background aggressively
    autoRefreshToken: true,
    // Detect session from URL hash after OAuth redirect
    detectSessionInUrl: true,
  },
});

// Helper to check if supabase is properly configured (not using placeholder values)
export function isSupabaseAvailable(): boolean {
  return supabaseConfigured;
}

export function requireSupabaseAvailable(): void {
  if (!supabaseConfigured) {
    throw new Error('Orderly authentication is not configured. Contact the site administrator.');
  }
}

export async function clearSupabaseBrowserAuthStorage(): Promise<void> {
  if (typeof window === 'undefined') throw new Error('Browser sign-out is unavailable.');
  await clearCurrentProjectAuthStorage(supabaseUrl, {
    document,
    localStorage: window.localStorage,
    sessionStorage: window.sessionStorage,
  });
}

export type SupabaseClient = typeof supabase;
