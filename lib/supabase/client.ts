import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-key';

// Custom fetch that silently swallows AbortErrors so they never bubble up as
// unhandled rejections or fake "SIGNED_OUT" events.
const safeFetch: typeof fetch = async (input, init) => {
  try {
    return await fetch(input, init);
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes('signal is aborted')) {
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
  return supabaseUrl !== 'https://placeholder.supabase.co' && supabasePublishableKey !== 'placeholder-key';
}

export type SupabaseClient = typeof supabase;
