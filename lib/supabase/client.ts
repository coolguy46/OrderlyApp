import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'placeholder-key';

// Create the Supabase browser client
export const supabase = createBrowserClient<Database>(supabaseUrl, supabasePublishableKey);

// Helper to check if supabase is properly configured (not using placeholder values)
export function isSupabaseAvailable(): boolean {
  return supabaseUrl !== 'https://placeholder.supabase.co' && supabasePublishableKey !== 'placeholder-key';
}

export type SupabaseClient = typeof supabase;
