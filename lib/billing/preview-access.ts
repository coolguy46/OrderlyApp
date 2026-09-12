import 'server-only';
import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { BillingError } from './config';

// Approved owner email fingerprint; do not send identity configuration to clients.
const OWNER_EMAIL_HASH = 'f3f0f456b289a991e1b464dd51c03d514bb31cdc34a1fbb191e9bf42742222cd';
const fingerprint = (value: unknown) => typeof value === 'string'
  ? createHash('sha256').update(value.trim().toLowerCase()).digest('hex') : '';

/** Only call with a user returned by server auth.getUser(), never client metadata. */
export function isBillingPreviewOwner(user: User | null, expectedHash = OWNER_EMAIL_HASH): boolean {
  return !!user?.id && !!user.email_confirmed_at && fingerprint(user.email) === expectedHash
    && !!user.identities?.some(identity => identity.provider === 'google'
      && identity.identity_data?.email_verified === true
      && fingerprint(identity.identity_data.email) === expectedHash);
}

/** This grants visual-preview access ONLY; it is never an AI entitlement. */
export async function requireBillingPreviewOwner(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new BillingError('Sign in to access this preview.', 401);
  if (!isBillingPreviewOwner(user)) throw new BillingError('This preview is not available for this account.', 403);
  return user.id;
}
