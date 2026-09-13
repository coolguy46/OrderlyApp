import 'server-only';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BillingError } from './config';
import { isOrderlyOwner } from './owner-access';

export const isBillingPreviewOwner = isOrderlyOwner;

/** This grants visual-preview access ONLY; it is never an AI entitlement. */
export async function requireBillingPreviewOwner(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new BillingError('Sign in to access this preview.', 401);
  if (!isBillingPreviewOwner(user)) throw new BillingError('This preview is not available for this account.', 403);
  return user.id;
}
