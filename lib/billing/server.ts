import 'server-only';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { billingConfig, BillingError, billingJson } from './config';
import { createBillingService, type BillingAccount, type BillingStore } from './service';

export async function billingServer() {
  const config = billingConfig();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BillingError('Billing database access is not configured.');
  const stripe = new Stripe(config.secretKey, { timeout: 12_000, maxNetworkRetries: 1 });
  // A key from a different account must not silently redirect customers.
  const account = await stripe.accounts.retrieve(null);
  if (account.id !== config.accountId) throw new BillingError('The Stripe account does not match the configured account.');
  // Verification can be revoked after setup. Never sell while Stripe blocks charges.
  const checkoutEnabled = config.checkoutEnabled && (!config.livemode || account.charges_enabled);
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
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
      await db.from('billing_accounts').update({ lease_token: null, lease_expires_at: null }).eq('user_id', userId).eq('lease_token', token);
    },
    async recordEvent(id, type, created) {
      const { error } = await db.from('billing_webhook_events').upsert(
        { event_id: id, event_type: type, stripe_created: created }, { onConflict: 'event_id', ignoreDuplicates: true });
      if (error) throw new BillingError('Webhook persistence failed.');
    },
  };
  return { stripe, config, store, service: createBillingService(stripe, store, { ...config, checkoutEnabled }) };
}

/** Rollout switch defaults off. When enabled, outages fail closed before any AI call. */
export async function requireAssistantSubscription(userId: string): Promise<Response | null> {
  if (process.env.AI_SUBSCRIPTION_REQUIRED !== 'true') return null;
  try {
    const { service } = await billingServer();
    if ((await service.status(userId)).aiAccess) return null;
    const message = 'Orderly AI requires a trial or subscription. Open Assistant to get started, or Settings → Billing to manage your subscription.';
    return billingJson({ error: message, reply: message, code: 'subscription_required', saved: false, aiUsed: false, normalizedCommands: [], normalizedCommand: null, planRequest: null }, 402);
  } catch {
    const message = 'Subscription access could not be verified. Please try again shortly.';
    return billingJson({ error: message, reply: message, saved: false, aiUsed: false }, 503);
  }
}
