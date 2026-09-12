import type Stripe from 'stripe';
import { BillingError } from './config.ts';

export interface BillingAccount {
  user_id: string;
  customer_id: string | null;
  attempt_id: string;
  attempt_started_at: string;
  attempt_trial_days: 0 | 7 | null;
  checkout_session_id: string | null;
  closed: boolean;
}
export interface BillingStore {
  load(userId: string): Promise<BillingAccount | null>;
  claim(userId: string, token: string): Promise<BillingAccount | null>;
  save(userId: string, token: string, patch: Partial<BillingAccount>): Promise<void>;
  release(userId: string, token: string): Promise<void>;
  recordEvent(id: string, type: string, created: number): Promise<void>;
}
type Config = { priceId: string; origin: string; portalConfiguration?: string; livemode?: boolean; checkoutEnabled?: boolean };

function accessEnd(subscription: Stripe.Subscription, priceId: string) {
  const periods = subscription.items.data.filter(item => item.price.id === priceId)
    .map(item => item.current_period_end).filter(end => Number.isFinite(end) && end > 0);
  if (!periods.length) return 0;
  let end = Math.max(...periods);
  if (subscription.status === 'trialing') end = Math.min(end, subscription.trial_end || 0);
  if (subscription.cancel_at) end = Math.min(end, subscription.cancel_at);
  return Number.isFinite(end) ? end * 1000 : 0;
}

export function subscriptionAllowsAI(subscription: Stripe.Subscription, priceId: string, now = Date.now(), livemode = false) {
  if (subscription.livemode !== livemode || subscription.pause_collection || accessEnd(subscription, priceId) <= now) return false;
  if (subscription.status === 'trialing') {
    // A trial has access before its first paid invoice, but never after its expiry.
    const start = subscription.trial_start;
    const end = subscription.trial_end;
    return typeof start === 'number' && Number.isFinite(start) && start > 0 && start * 1000 <= now &&
      typeof end === 'number' && Number.isFinite(end) && end > start && end * 1000 > now;
  }
  const invoice = subscription.latest_invoice;
  return subscription.status === 'active' && typeof invoice === 'object' && invoice !== null && invoice.status === 'paid';
}

export function validMonthlyPrice(price: Stripe.Price, livemode = false) {
  return price.livemode === livemode && price.active && price.currency === 'usd' && price.unit_amount === 499 &&
    price.type === 'recurring' && price.billing_scheme === 'per_unit' && !price.transform_quantity &&
    price.recurring?.interval === 'month' && price.recurring.interval_count === 1 && price.recurring.usage_type === 'licensed';
}

/** All customer identifiers originate from the server-owned database mapping. */
export function createBillingService(stripe: Stripe, store: BillingStore, config: Config) {
  const livemode = config.livemode === true;
  const checkoutEnabled = config.checkoutEnabled ?? !livemode;
  async function verifyCustomer(customerId: string) {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted || customer.livemode !== livemode) throw new BillingError('Billing customer mode could not be verified.');
  }
  async function subscriptions(customer: string) {
    await verifyCustomer(customer);
    const results: Stripe.Subscription[] = [];
    // Pagination is required: canceled subscriptions can precede an active one.
    for await (const subscription of stripe.subscriptions.list({ customer, status: 'all', limit: 100, expand: ['data.latest_invoice'] })) {
      if (subscription.livemode !== livemode) throw new BillingError('Unexpected subscription mode.');
      results.push(subscription);
      if (results.length > 1000) throw new BillingError('Billing history needs administrator review.');
    }
    return results;
  }

  async function status(userId: string) {
    const account = await store.load(userId);
    const records = account?.customer_id ? await subscriptions(account.customer_id) : [];
    const eligible = !account?.closed ? records.find(sub => subscriptionAllowsAI(sub, config.priceId, Date.now(), livemode)) : undefined;
    const existing = records.find(sub => !['canceled', 'incomplete_expired'].includes(sub.status));
    return {
      enabled: true, sandbox: !livemode, checkoutEnabled, hasSubscription: Boolean(existing),
      canManage: Boolean(account?.customer_id), aiAccess: Boolean(eligible),
      status: eligible?.status || existing?.status || 'none',
      cancelAtPeriodEnd: (eligible || existing)?.cancel_at_period_end || false,
      // Account/customer history, not a client flag. Deleting/recreating an account
      // is not a retained identity and is not advertised as a one-trial-per-person guarantee.
      trialEligible: !account?.closed && records.length === 0,
      trialEndsAt: eligible?.status === 'trialing' ? new Date(eligible.trial_end! * 1000).toISOString() : null,
      accessEndsAt: eligible ? new Date(accessEnd(eligible, config.priceId)).toISOString() : null,
    };
  }

  async function portalFor(customer: string) {
    await verifyCustomer(customer);
    const session = await stripe.billingPortal.sessions.create({ customer,
      return_url: `${config.origin}/settings/billing`, configuration: config.portalConfiguration });
    return { url: session.url };
  }

  async function portal(userId: string) {
    const account = await store.load(userId);
    if (!account?.customer_id) throw new BillingError('There is no billing account to manage yet.', 409);
    return portalFor(account.customer_id);
  }

  async function checkout(userId: string) {
    if (!checkoutEnabled) throw new BillingError('New subscriptions are not available yet. Please check back soon.');
    const token = crypto.randomUUID();
    const account = await store.claim(userId, token);
    if (!account) throw new BillingError('Checkout is already being prepared. Please try again shortly.', 409);
    try {
      if (account.closed) throw new BillingError('This account is being deleted.', 409);
      const price = await stripe.prices.retrieve(config.priceId);
      if (!validMonthlyPrice(price, livemode)) throw new BillingError('The configured price does not match Orderly AI ($4.99 USD/month) and its billing mode.');
      if (livemode) {
        if (!config.portalConfiguration) throw new BillingError('Subscription management is not configured.');
        const portal = await stripe.billingPortal.configurations.retrieve(config.portalConfiguration);
        if (!portal.active || portal.livemode !== livemode || !portal.features.subscription_cancel.enabled ||
          portal.features.subscription_cancel.mode !== 'at_period_end' || !portal.features.payment_method_update.enabled) {
          throw new BillingError('Subscription cancellation and payment management must be available before checkout.');
        }
      }
      if (!account.customer_id) {
        // Do not replace an uncertain creation attempt after Stripe's idempotency window.
        if (Date.now() - Date.parse(account.attempt_started_at) > 22 * 3600_000) {
          throw new BillingError('An earlier checkout attempt needs administrator review before retrying.');
        }
        const customer = await stripe.customers.create({ metadata: { orderly_user_id: userId } },
          { idempotencyKey: `orderly-customer-${userId}-${account.attempt_id}` });
        if (customer.livemode !== livemode) throw new BillingError('Unexpected customer mode.');
        await store.save(userId, token, { customer_id: customer.id });
        account.customer_id = customer.id;
      }
      const records = await subscriptions(account.customer_id);
      if (records.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) {
        return portalFor(account.customer_id);
      }
      const trialDays = records.length === 0 ? 7 : 0;
      if (account.checkout_session_id) {
        const previous = await stripe.checkout.sessions.retrieve(account.checkout_session_id);
        if (previous.customer !== account.customer_id || previous.livemode !== livemode) throw new BillingError('Checkout ownership could not be verified.');
        let previousStatus = previous.status;
        if (previousStatus === 'open') {
          const previousTrialDays = previous.metadata?.orderly_trial_days === '7' ? 7 : 0;
          if (previousTrialDays === trialDays && previous.url) return { url: previous.url };
          // Do not reuse a stale trial after another subscription, or send a new
          // customer to a pre-trial checkout that would charge them immediately.
          await stripe.checkout.sessions.expire(previous.id);
          previousStatus = 'expired';
        }
        if (previous.status === 'complete') {
          // A completed checkout can be replaced only after its subscription has
          // conclusively ended. Missing/reconciling state must not start a second purchase.
          const subscriptionId = typeof previous.subscription === 'string' ? previous.subscription : previous.subscription?.id;
          const priorSubscription = records.find(sub => sub.id === subscriptionId);
          if (!priorSubscription || !['canceled', 'incomplete_expired'].includes(priorSubscription.status)) return portalFor(account.customer_id);
        }
        if (previousStatus !== 'expired' && previousStatus !== 'complete') throw new BillingError('Checkout is still being processed.');
        account.attempt_id = crypto.randomUUID();
        account.attempt_started_at = new Date().toISOString();
        account.attempt_trial_days = null;
        await store.save(userId, token, { attempt_id: account.attempt_id, attempt_started_at: account.attempt_started_at, checkout_session_id: null, attempt_trial_days: null });
      }
      if (Date.now() - Date.parse(account.attempt_started_at) > 22 * 3600_000) {
        throw new BillingError('An earlier checkout attempt needs administrator review before retrying.');
      }
      if (account.attempt_trial_days == null) {
        // Persist the decision before Stripe: a lost response must retry identical
        // parameters, even if customer history changes between requests.
        await store.save(userId, token, { attempt_trial_days: trialDays });
        account.attempt_trial_days = trialDays;
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription', customer: account.customer_id,
        client_reference_id: userId,
        metadata: { orderly_trial_days: String(account.attempt_trial_days) },
        line_items: [{ price: config.priceId, quantity: 1 }],
        payment_method_types: ['card'],
        payment_method_collection: 'always',
        success_url: `${config.origin}/planner?checkout=success`,
        cancel_url: `${config.origin}/planner?checkout=canceled`,
        subscription_data: { metadata: { orderly_user_id: userId },
          ...(account.attempt_trial_days === 7 ? { trial_period_days: 7,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' as const } } } : {}),
        },
        // Stable parameters across retries; no timestamp or redirect from the browser.
        expires_at: Math.floor(Date.parse(account.attempt_started_at) / 1000) + 23 * 3600,
      }, { idempotencyKey: `orderly-checkout-${userId}-${account.attempt_id}` });
      if (!session.url || session.livemode !== livemode) throw new BillingError('Checkout could not be opened.');
      await store.save(userId, token, { checkout_session_id: session.id });
      if (account.attempt_trial_days !== trialDays) {
        if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
        throw new BillingError('Your billing history changed. Please try again to refresh checkout.', 409);
      }
      return { url: session.url };
    } finally { await store.release(userId, token); }
  }

  async function prepareDeletion(userId: string) {
    if ((await store.load(userId))?.closed) return;
    const token = crypto.randomUUID();
    const account = await store.claim(userId, token);
    if (!account) throw new BillingError('Billing is busy. Retry account deletion shortly.', 409);
    try {
      if (account.customer_id) {
        const records = await subscriptions(account.customer_id);
        if (records.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) {
          throw new BillingError('Manage your subscription before deleting your account. Deletion is available after the subscription has ended.', 409);
        }
        // Expire all open sessions, including a session whose response was lost.
        for await (const session of stripe.checkout.sessions.list({ customer: account.customer_id, status: 'open', limit: 100 })) {
          if (session.livemode !== livemode || session.customer !== account.customer_id) throw new BillingError('Checkout ownership could not be verified.');
          await stripe.checkout.sessions.expire(session.id);
        }
        // A payment may have completed just before its session was expired.
        if ((await subscriptions(account.customer_id)).some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) {
          throw new BillingError('A subscription is still active. Open billing management before deleting the account.', 409);
        }
      }
      await store.save(userId, token, { closed: true });
    } finally { await store.release(userId, token); }
  }
  return { checkout, portal, status, prepareDeletion };
}
