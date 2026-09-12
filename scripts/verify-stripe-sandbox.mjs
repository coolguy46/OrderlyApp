// Explicit opt-in, real SANDBOX API verification. This does not complete Checkout
// in a browser or verify webhook delivery. No Supabase connection is used.
// Run: node --experimental-strip-types scripts/verify-stripe-sandbox.mjs --run
// Docs: https://docs.stripe.com/api/checkout/sessions/create
// https://docs.stripe.com/api/checkout/sessions/expire
// https://docs.stripe.com/api/customer_portal/configurations/retrieve
// https://docs.stripe.com/api/customers/delete
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { createBillingService } from '../lib/billing/service.ts';

const ACCOUNT_ID = 'acct_1UE0rgCjmnlmrlsX';
const PRICE_ID = 'price_1UE1DQCjmnlmrlsXHxHfcpa4';
const PORTAL_ID = 'bpc_1UEgA9CjmnlmrlsXkvvWYvcF';
const runId = randomUUID();
const owner = randomUUID();
const report = { verificationId: runId, apiOnly: true, browserCheckoutVerified: false, webhookDeliveryVerified: false };
const createdCustomerIds = new Set();
const createdSessionIds = new Set();
let stripe;
let verifiedAccount = false;
let phase = 'configuration';
const check = (condition, label) => { if (!condition) throw new Error(label); };
const log = data => console.log(JSON.stringify(data));

async function main() {
  check(process.argv.includes('--run'), 'explicit_run_required');
  // Never print or place credentials in command arguments or inherited env.
  const values = parseEnv(readFileSync(resolve('.env.local'), 'utf8'));
  check(values.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'test_key_required');
  stripe = new Stripe(values.STRIPE_SECRET_KEY, { timeout: 12000, maxNetworkRetries: 1 });
  phase = 'verify_account';
  const account = await stripe.accounts.retrieve(null);
  check(account.id === ACCOUNT_ID, 'wrong_sandbox_account');
  verifiedAccount = true;
  report.accountId = account.id;

  phase = 'verify_portal';
  const portal = await stripe.billingPortal.configurations.retrieve(PORTAL_ID);
  check(portal.livemode === false && portal.active, 'sandbox_portal_required');
  check(portal.features.subscription_cancel.enabled && portal.features.subscription_cancel.mode === 'at_period_end', 'period_end_cancellation_required');
  check(portal.features.payment_method_update.enabled, 'payment_management_required');
  report.portalId = portal.id;
  report.periodEndCancellation = true;

  let billingAccount = null;
  let leaseToken = null;
  let submittedParameters = null;
  const store = {
    async load(id) { check(id === owner, 'wrong_fixture_owner'); return billingAccount; },
    async claim(id, token) {
      check(id === owner && !leaseToken, 'wrong_fixture_lease'); leaseToken = token;
      billingAccount ??= { user_id: owner, customer_id: null, attempt_id: randomUUID(),
        attempt_started_at: new Date().toISOString(), attempt_trial_days: null, checkout_session_id: null, closed: false };
      return { ...billingAccount };
    },
    async save(id, token, patch) {
      check(id === owner && token === leaseToken, 'wrong_fixture_lease');
      billingAccount = { ...billingAccount, ...patch };
    },
    async release(id, token) { check(id === owner && token === leaseToken, 'wrong_fixture_lease'); leaseToken = null; },
    async recordEvent() { throw new Error('webhooks_are_not_part_of_this_verification'); },
  };
  // Pass the actual Stripe SDK resource methods through. Intercept only newly
  // created objects to mark our exact cleanup scope and record submitted terms.
  const transport = {
    prices: stripe.prices,
    subscriptions: stripe.subscriptions,
    billingPortal: stripe.billingPortal,
    customers: {
      retrieve: (...args) => stripe.customers.retrieve(...args),
      async create(params, options) {
        check(verifiedAccount, 'unverified_write');
        const customer = await stripe.customers.create({ ...params, name: 'Orderly sandbox verification',
          description: 'Synthetic API-only verification; no real user or email.',
          metadata: { ...params.metadata, orderly_sandbox_verification: runId } }, options);
        check(customer.livemode === false, 'unexpected_live_customer');
        createdCustomerIds.add(customer.id); return customer;
      },
    },
    checkout: { sessions: {
      retrieve: (...args) => stripe.checkout.sessions.retrieve(...args),
      expire: (...args) => stripe.checkout.sessions.expire(...args),
      async create(params, options) {
        check(verifiedAccount && createdCustomerIds.has(params.customer), 'unverified_write');
        submittedParameters = params;
        const session = await stripe.checkout.sessions.create({ ...params,
          metadata: { ...params.metadata, orderly_sandbox_verification: runId } }, options);
        check(session.livemode === false, 'unexpected_live_checkout');
        createdSessionIds.add(session.id); return session;
      },
    } },
  };
  const service = createBillingService(transport, store, {
    priceId: PRICE_ID, origin: 'http://localhost:3000', portalConfiguration: PORTAL_ID,
    livemode: false, checkoutEnabled: true,
  });
  phase = 'create_service_checkout';
  const first = await service.checkout(owner);
  check(submittedParameters.subscription_data.trial_period_days === 7, 'trial_not_seven_days');
  check(submittedParameters.payment_method_collection === 'always', 'card_not_required');
  check(submittedParameters.subscription_data.trial_settings.end_behavior.missing_payment_method === 'cancel', 'missing_payment_end_behavior_incorrect');
  const session = await stripe.checkout.sessions.retrieve(billingAccount.checkout_session_id);
  check(session.livemode === false && session.customer === billingAccount.customer_id, 'wrong_checkout_owner');
  check(session.mode === 'subscription' && session.status === 'open', 'checkout_not_open_subscription');
  check(session.payment_method_collection === 'always' && session.metadata.orderly_trial_days === '7', 'checkout_terms_mismatch');
  const items = await stripe.checkout.sessions.listLineItems(session.id);
  check(items.data.length === 1 && items.data[0].price?.id === PRICE_ID && items.data[0].quantity === 1, 'wrong_checkout_price');
  phase = 'retry_checkout';
  const retry = await service.checkout(owner);
  check(retry.url === first.url && createdSessionIds.size === 1, 'retry_did_not_reuse_checkout');
  const status = await service.status(owner);
  check(status.aiAccess === false && status.trialEligible === true, 'open_checkout_granted_access');
  report.customerId = billingAccount.customer_id;
  report.sessionId = session.id;
  report.trialSevenDaysAccepted = true;
  report.cardRequired = true;
  report.retriesReuseSameSession = true;
  report.openCheckoutHasNoAiAccess = true;
}

async function cleanup() {
  if (!stripe || !verifiedAccount) return;
  const cleanupResults = [];
  for (const id of createdSessionIds) {
    try {
      const session = await stripe.checkout.sessions.retrieve(id);
      check(!session.livemode && session.metadata.orderly_sandbox_verification === runId && createdCustomerIds.has(session.customer), 'cleanup_scope_mismatch');
      if (session.status === 'open') await stripe.checkout.sessions.expire(id);
      const expired = await stripe.checkout.sessions.retrieve(id);
      check(expired.status === 'expired', 'checkout_not_expired');
      cleanupResults.push({ sessionId: id, expired: true });
    } catch { cleanupResults.push({ sessionId: id, expired: false }); process.exitCode = 1; }
  }
  for (const id of createdCustomerIds) {
    try {
      const customer = await stripe.customers.retrieve(id);
      check(!customer.deleted && customer.livemode === false && customer.metadata.orderly_sandbox_verification === runId, 'cleanup_scope_mismatch');
      const subscriptions = await stripe.subscriptions.list({ customer: id, status: 'all', limit: 1 });
      check(subscriptions.data.length === 0, 'unexpected_subscription_preserved_for_review');
      const deleted = await stripe.customers.del(id);
      check(deleted.deleted === true, 'customer_not_deleted');
      cleanupResults.push({ customerId: id, deleted: true });
    } catch { cleanupResults.push({ customerId: id, deleted: false }); process.exitCode = 1; }
  }
  report.cleanup = cleanupResults;
}

try {
  await main(); report.success = true;
} catch {
  // Stripe errors can contain sensitive request context. Print only our phase.
  report.success = false; report.failedPhase = phase; process.exitCode = 1;
} finally {
  await cleanup();
  if (process.exitCode) report.success = false;
  log(report);
}
