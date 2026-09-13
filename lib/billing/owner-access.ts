import 'server-only';
import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';

// Approved owner email fingerprint; never send identity configuration to clients.
const OWNER_EMAIL_HASH = 'f3f0f456b289a991e1b464dd51c03d514bb31cdc34a1fbb191e9bf42742222cd';
const fingerprint = (value: unknown) => typeof value === 'string'
  ? createHash('sha256').update(value.trim().toLowerCase()).digest('hex') : '';

/**
 * Only accept the User returned by server auth.getUser(), never client-supplied
 * identity or editable user_metadata. Both primary and Google emails must match.
 * The owner explicitly receives complimentary AI access; all usage and data
 * authorization checks still apply. No Stripe subscription is created/changed.
 */
export function isOrderlyOwner(user: User | null): boolean {
  return !!user?.id && !!user.email_confirmed_at && fingerprint(user.email) === OWNER_EMAIL_HASH
    && !!user.identities?.some(identity => identity.provider === 'google'
      && identity.identity_data?.email_verified === true
      && fingerprint(identity.identity_data.email) === OWNER_EMAIL_HASH);
}
