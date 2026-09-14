import 'server-only';
import { createClient, type User } from '@supabase/supabase-js';
import { assistantSubscriptionRequired, billingConfig, BillingError, billingJson } from './config';
import { BILLING_UNAVAILABLE_MESSAGE } from './messages';
import { isOrderlyOwner } from './owner-access';
import { createBillingService, type BillingAccount, type BillingStore } from './service';
import { billingFetch, createBillingStripe } from './transport';
import { enforceRateLimit } from '@/lib/security/rate-limit-server';
import { RATE_LIMIT_POLICIES } from '../security/rate-limit';
import { complimentaryBillingPeriod, type AssistantBillingPeriod } from './plan';

/** Server-only persistence; signature-verified webhooks need no Stripe API call. */
export function billingStore(deadline = Date.now() + 45_000): BillingStore {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BillingError('Billing database access is not configured.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: billingFetch(deadline, (input, init) => {
      const signal = AbortSignal.any([AbortSignal.timeout(5_000),
        ...(input instanceof Request ? [input.signal] : []), ...(init?.signal ? [init.signal] : [])]);
      signal.throwIfAborted();
      return fetch(input, { ...init, signal, redirect: 'error' });
    }) },
  });
  const store: BillingStore = {
    async load(userId) {
      const { data, error } = await db.from('billing_accounts').select('*').eq('user_id', userId).maybeSingle();
      if (error) throw new BillingError('Billing storage is unavailable.');
      return data as BillingAccount | null;
    },
    async claim(userId, token) {
      const { data, error } = await db.rpc('claim_billing_account', { p_user_id: userId, p_token: token });
      if (error) throw new BillingError('Billing storage is unavailable.');
      return data?.[0] as BillingAccount || null;
    },
    async save(userId, token, patch) {
      const { data, error } = await db.from('billing_accounts').update(patch).eq('user_id', userId)
        .eq('lease_token', token).gt('lease_expires_at', new Date().toISOString()).select('user_id').single();
      if (error || !data) throw new BillingError('Billing could not confirm the save. Retry the same checkout.');
    },
    async release(userId, token) {
      // Failed release only delays the next attempt; the lease expires automatically.
      try {
        await db.from('billing_accounts').update({ lease_token: null, lease_expires_at: null }).eq('user_id', userId).eq('lease_token', token);
      } catch { /* Deadline/transport failure leaves only the self-expiring lease. */ }
    },
    async recordEvent(id, type, created) {
      const { error } = await db.from('billing_webhook_events').upsert(
        { event_id: id, event_type: type, stripe_created: created }, { onConflict: 'event_id', ignoreDuplicates: true });
      if (error) throw new BillingError('Webhook persistence failed.');
    },
  };
  return store;
}

export async function billingServer(timeoutMs = 45_000) {
  const config = billingConfig();
  const deadline = Date.now() + timeoutMs;
  const store = billingStore(deadline);
  const stripe = createBillingStripe(config.secretKey, deadline);
  // A key from a different account must not silently redirect customers.
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== config.accountId) throw new BillingError('The Stripe account does not match the configured account.');
  // Verification can be revoked after setup. Never sell while Stripe blocks charges.
  const checkoutEnabled = config.checkoutEnabled && (!config.livemode || account.charges_enabled);
  return { stripe, config, store, service: createBillingService(stripe, store, { ...config, checkoutEnabled }) };
}

/** Call only after server auth.getUser(). The approved owner alone has complimentary access. */
export async function requireAssistantSubscription(user: User, onAllowed?: (period: AssistantBillingPeriod) => void): Promise<Response | null> {
  if (isOrderlyOwner(user) || !assistantSubscriptionRequired()) {
    onAllowed?.(complimentaryBillingPeriod());
    return null;
  }
  try {
    // Denied/unpaid callers must not repeatedly cause Stripe lookups before the
    // provider-specific AI limit is reached. The complimentary owner makes no lookup.
    const limited = await enforceRateLimit(user.id, RATE_LIMIT_POLICIES.billingEntitlement);
    if (limited) return limited;
    const { service } = await billingServer(10_000);
    const status = await service.status(user.id);
    if (status.aiAccess && status.billingPeriod) {
      onAllowed?.(status.billingPeriod);
      return null;
    }
    const message = 'Orderly AI requires a subscription. Open Assistant to subscribe, or Settings → Billing to manage your subscription.';
    return billingJson({ error: message, reply: message, code: 'subscription_required', saved: false, aiUsed: false, normalizedCommands: [], normalizedCommand: null, planRequest: null }, 402);
  } catch {
    return billingJson({ error: BILLING_UNAVAILABLE_MESSAGE, reply: BILLING_UNAVAILABLE_MESSAGE,
      code: 'billing_unavailable', saved: false, aiUsed: false }, 503);
  }
}
