import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

const configuredSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const configuredSupabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const supabaseConfigured = Boolean(configuredSupabaseUrl && configuredSupabasePublishableKey);

// The SDK requires syntactically valid values at module initialization. Point
// a misconfigured development/build environment at a closed loopback port,
// never at a network-reachable placeholder that could receive credentials.
const supabaseUrl = configuredSupabaseUrl || 'http://127.0.0.1:1';
const supabasePublishableKey = configuredSupabasePublishableKey || 'supabase-not-configured';

// Custom fetch that silently swallows AbortErrors so they never bubble up as
// unhandled rejections or fake "SIGNED_OUT" events.
const safeFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (err: unknown) {
    const requestError = err && typeof err === 'object'
      ? err as { name?: string; message?: string }
      : null;
    if (requestError?.name === 'AbortError' || requestError?.message?.includes('signal is aborted')) {
      // Return a synthetic 499 response — Supabase will treat it as a no-op
      return new Response(null, { status: 499, statusText: 'Client Closed Request' });
    }
    throw err;
  }
};

// Create the Supabase browser client
export const supabase = createBrowserClient<Database>(supabaseUrl, supabasePublishableKey, {
  global: { fetch: safeFetch },
  auth: {
    // Persist session in localStorage (default) — prevents logout on tab switch
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

export type SupabaseClient = typeof supabase;
