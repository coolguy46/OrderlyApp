// Explicit opt-in, API-only simulation. NEVER accepts a live key or another account.
// Run: node --experimental-strip-types scripts/verify-stripe-lifecycle-sandbox.mjs --run
// Creates a fresh, tagged test clock and only synthetic customers/subscriptions.
// No Supabase connection, actual card information, real emails, account settings,
// existing customer mutations, refunds, hosted Checkout or live-webhook claims.
// https://docs.stripe.com/billing/testing/test-clocks/api-advanced-usage
// https://docs.stripe.com/testing#declined-payments
// https://docs.stripe.com/api/subscriptions/create
// https://docs.stripe.com/api/test_clocks/delete
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Stripe from 'stripe';
import { createBillingService, subscriptionAllowsAI, validMonthlyPrice } from '../lib/billing/service.ts';

const ACCOUNT = 'acct_1UE0rgCjmnlmrlsX';
const PRICE = 'price_1UFft1CjmnlmrlsXPVZuVx2l';
const runId = randomUUID();
const clockName = `Orderly isolated lifecycle ${runId}`;
const tag = { orderly_lifecycle_verification: runId };
const createdCustomers = new Set();
const createdSubscriptions = new Set();
const mapping = new Map();
const report = { verificationId: runId, apiOnly: true, hostedCheckoutVerified: false,
  webhookDeliveryVerified: false, realFundsMoved: false, checks: {} };
let stripe, clock, verified = false, phase = 'configuration';
const assert = (condition, label) => { if (!condition) throw new Error(label); };
const idOf = value => typeof value === 'string' ? value : value?.id;
const opts = label => ({ idempotencyKey: `orderly-lifecycle-${runId}-${label}` });

function assertCustomer(customer) {
  assert(verified && !customer.deleted && customer.livemode === false && createdCustomers.has(customer.id)
    && customer.metadata.orderly_lifecycle_verification === runId && idOf(customer.test_clock) === clock.id,
  'customer_scope_mismatch');
}
function assertSubscription(sub) {
  assert(verified && sub.livemode === false && createdSubscriptions.has(sub.id)
    && createdCustomers.has(idOf(sub.customer)) && sub.metadata.orderly_lifecycle_verification === runId
    && idOf(sub.test_clock) === clock.id, 'subscription_scope_mismatch');
}
async function readSub(id) {
  assert(createdSubscriptions.has(id), 'unowned_subscription');
  const sub = await stripe.subscriptions.retrieve(id, { expand: ['latest_invoice'] });
  assertSubscription(sub); return sub;
}
async function advance(time) {
  const before = await stripe.testHelpers.testClocks.retrieve(clock.id);
  assert(before.livemode === false && before.name === clockName && before.status === 'ready', 'clock_scope_or_state');
  assert(time > before.frozen_time, 'invalid_clock_advance');
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: time }, opts(`advance-${time}`));
  // Bounded low-frequency polling of only this newly created simulation.
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await delay(2_000);
    clock = await stripe.testHelpers.testClocks.retrieve(clock.id);
    assert(clock.livemode === false && clock.name === clockName, 'clock_scope_mismatch');
    if (clock.status === 'ready') return;
    assert(clock.status === 'advancing', 'clock_advance_failed');
  }
  throw new Error('clock_advance_timeout');
}
async function customer(label, paymentMethod) {
  assert(verified && clock?.livemode === false, 'unverified_write');
  const created = await stripe.customers.create({ name: `Orderly synthetic ${label}`,
    description: 'Temporary isolated API lifecycle check; no real person or email.',
    metadata: tag, test_clock: clock.id, payment_method: paymentMethod,
    invoice_settings: { default_payment_method: paymentMethod },
  }, opts(`customer-${label}`));
  createdCustomers.add(created.id); assertCustomer(created);
  const userId = randomUUID();
  mapping.set(userId, { user_id: userId, customer_id: created.id, closed: false });
  return { customer: created, userId };
}
async function subscribe(fixture, label, trialDays = 0) {
  assertCustomer(fixture.customer);
  const sub = await stripe.subscriptions.create({ customer: fixture.customer.id,
    items: [{ price: PRICE, quantity: 1 }], collection_method: 'charge_automatically',
    payment_behavior: 'allow_incomplete', metadata: tag, expand: ['latest_invoice'],
    ...(trialDays ? { trial_period_days: trialDays,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
  }, opts(`subscription-${label}`));
  createdSubscriptions.add(sub.id); assertSubscription(sub); return sub;
}

async function main() {
  assert(process.argv.includes('--run'), 'explicit_run_required');
  const env = parseEnv(readFileSync(resolve('.env.local'), 'utf8'));
  assert(env.STRIPE_SECRET_KEY?.startsWith('sk_test_'), 'sandbox_key_required');
  stripe = new Stripe(env.STRIPE_SECRET_KEY, { timeout: 12_000, maxNetworkRetries: 1 });
  phase = 'verify_sandbox_account_and_price';
  const account = await stripe.accounts.retrieve(null);
  assert(account.id === ACCOUNT, 'wrong_sandbox_account');
  const price = await stripe.prices.retrieve(PRICE);
  assert(validMonthlyPrice(price, false), 'wrong_sandbox_price');
  verified = true; report.accountId = account.id;

  phase = 'create_isolated_clock';
  clock = await stripe.testHelpers.testClocks.create({ name: clockName,
    frozen_time: Math.floor(Date.now() / 1000) - 120 }, opts('clock'));
  assert(clock.livemode === false && clock.name === clockName, 'wrong_test_clock');
  const store = { async load(userId) { return mapping.get(userId) || null; },
    async claim() { throw new Error('checkout_not_part_of_this_simulation'); },
    async save() { throw new Error('database_writes_not_part_of_this_simulation'); },
    async release() {}, async recordEvent() { throw new Error('webhooks_not_part_of_this_simulation'); } };
  const service = createBillingService(stripe, store, { priceId: PRICE, origin: 'http://localhost:3000',
    livemode: false, checkoutEnabled: false });

  phase = 'create_trial_and_decline_fixtures';
  const canceled = await customer('cancel-trial', 'pm_card_visa');
  const renewing = await customer('renew-trial', 'pm_card_visa');
  const declining = await customer('declined-initial', 'pm_card_chargeCustomerFail');
  let canceledSub = await subscribe(canceled, 'cancel-trial', 7);
  let renewingSub = await subscribe(renewing, 'renew-trial', 7);
  const declinedSub = await subscribe(declining, 'declined-initial');
  assert(canceledSub.status === 'trialing' && renewingSub.status === 'trialing', 'trial_not_started');
  assert(canceledSub.trial_end - canceledSub.trial_start === 7 * 86400, 'trial_duration_mismatch');
  assert((await service.status(canceled.userId)).aiAccess && (await service.status(renewing.userId)).aiAccess, 'trial_access_denied');
  assert(declinedSub.status === 'incomplete' && !(await service.status(declining.userId)).aiAccess, 'decline_granted_access');
  assert(!(await service.status(randomUUID())).aiAccess, 'unknown_user_granted_access');
  report.checks.trialSevenDaysAndAccess = true;
  report.checks.initialDeclineDenied = true;
  report.checks.unmappedUserDenied = true;

  phase = 'schedule_cancellation';
  canceledSub = await stripe.subscriptions.update(canceledSub.id, { cancel_at_period_end: true }, opts('cancel-at-period-end'));
  assertSubscription(canceledSub);
  assert(canceledSub.cancel_at_period_end && subscriptionAllowsAI(canceledSub, PRICE, clock.frozen_time * 1000, false)
    && (await service.status(canceled.userId)).aiAccess, 'scheduled_cancellation_revoked_early');
  report.checks.scheduledCancellationPreservesTrial = true;

  phase = 'advance_trial_end';
  await advance(Math.max(canceledSub.trial_end, renewingSub.trial_end) + 10);
  // Stripe normally leaves a renewal invoice in draft for an hour.
  await advance(clock.frozen_time + 3601);
  canceledSub = await readSub(canceledSub.id);
  renewingSub = await readSub(renewingSub.id);
  const canceledStatus = await service.status(canceled.userId);
  assert(canceledSub.status === 'canceled' && !canceledStatus.aiAccess && !canceledStatus.trialEligible,
    'expired_trial_or_repeat_trial_allowed');
  assert(renewingSub.status === 'active' && renewingSub.latest_invoice?.status === 'paid'
    && subscriptionAllowsAI(renewingSub, PRICE, clock.frozen_time * 1000, false)
    && (await service.status(renewing.userId)).aiAccess, 'trial_did_not_convert_to_paid');
  report.checks.canceledTrialExpiredAndLocked = true;
  report.checks.retainedCustomerNotTrialEligible = true;
  report.checks.trialConvertedToPaidAndUnlocked = true;

  phase = 'prepare_declined_renewal';
  const failMethod = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail',
    { customer: renewing.customer.id }, opts('decline-method'));
  assert(failMethod.livemode === false && idOf(failMethod.customer) === renewing.customer.id, 'wrong_synthetic_method');
  await stripe.subscriptions.update(renewingSub.id, { default_payment_method: failMethod.id }, opts('set-renewal-decline'));
  const nextPeriod = Math.max(...renewingSub.items.data.map(item => item.current_period_end));
  phase = 'advance_failed_renewal';
  await advance(nextPeriod + 10);
  await advance(clock.frozen_time + 3601);
  renewingSub = await readSub(renewingSub.id);
  assert(renewingSub.status === 'past_due' && renewingSub.latest_invoice?.status === 'open'
    && !(await service.status(renewing.userId)).aiAccess
    && !subscriptionAllowsAI(renewingSub, PRICE, clock.frozen_time * 1000, false), 'failed_renewal_not_locked');
  report.checks.failedRenewalRevokesAccess = true;

  phase = 'restore_synthetic_payment';
  const invoice = renewingSub.latest_invoice;
  assert(invoice.livemode === false && idOf(invoice.customer) === renewing.customer.id, 'invoice_scope_mismatch');
  const goodMethod = idOf(renewing.customer.invoice_settings.default_payment_method);
  assert(goodMethod?.startsWith('pm_'), 'missing_synthetic_success_method');
  await stripe.subscriptions.update(renewingSub.id, { default_payment_method: goodMethod }, opts('restore-payment-method'));
  const paidInvoice = await stripe.invoices.pay(invoice.id, { payment_method: goodMethod }, opts('pay-synthetic-renewal'));
  assert(paidInvoice.status === 'paid' && paidInvoice.livemode === false
    && idOf(paidInvoice.customer) === renewing.customer.id, 'synthetic_recovery_invoice_not_paid');
  renewingSub = await readSub(renewingSub.id);
  assert(renewingSub.status === 'active' && (await service.status(renewing.userId)).aiAccess, 'payment_recovery_did_not_restore_access');
  report.checks.successfulPaymentRestoresAccess = true;
}

async function cleanup() {
  if (!verified || !clock) return;
  report.cleanup = { clockDeleted: false, syntheticCustomersDeleted: 0, syntheticSubscriptionsEnded: 0 };
  try {
    const exactClock = await stripe.testHelpers.testClocks.retrieve(clock.id);
    assert(exactClock.livemode === false && exactClock.name === clockName, 'cleanup_clock_scope');
    // Query only our exact new clock, never unrelated customers or subscriptions.
    const customers = await stripe.customers.list({ test_clock: clock.id, limit: 10 });
    assert(!customers.has_more && customers.data.length <= 3, 'cleanup_customer_scope');
    for (const item of customers.data) {
      assertCustomer(item);
      const subs = await stripe.subscriptions.list({ customer: item.id, status: 'all', limit: 10 });
      assert(!subs.has_more && subs.data.length <= 3, 'cleanup_subscription_scope');
      for (const sub of subs.data) assertSubscription(sub);
    }
    const deleted = await stripe.testHelpers.testClocks.del(clock.id);
    assert(deleted.deleted === true && deleted.id === clock.id, 'clock_cleanup_failed');
    report.cleanup.clockDeleted = true;
    // Stripe documents that deleting this clock deletes its customers and ends
    // their subscriptions. Confirm each exact object this run created.
    for (const id of createdCustomers) {
      try { assert((await stripe.customers.retrieve(id)).deleted === true, 'customer_not_deleted'); }
      catch (error) { if (error.code !== 'resource_missing') throw error; }
      report.cleanup.syntheticCustomersDeleted++;
    }
    for (const id of createdSubscriptions) {
      try {
        const sub = await stripe.subscriptions.retrieve(id);
        assert(sub.livemode === false && ['canceled', 'incomplete_expired'].includes(sub.status), 'subscription_not_ended');
      } catch (error) { if (error.code !== 'resource_missing') throw error; }
      report.cleanup.syntheticSubscriptionsEnded++;
    }
  } catch {
    report.cleanup.needsReview = true; report.cleanup.clockId = clock.id;
    process.exitCode = 1;
  }
}

try { await main(); report.success = true; }
catch (error) {
  report.success = false; report.failedPhase = phase; process.exitCode = 1;
  // Only our constant labels or a short Stripe classification, never raw error
  // messages, objects, request context, card information or credentials.
  if (/^[a-z_]{1,80}$/.test(error.message)) report.failureCode = error.message;
  else if (/^[a-z_]{1,80}$/.test(error.code)) report.failureCode = error.code;
}
finally {
  await cleanup();
  if (process.exitCode) report.success = false;
  console.log(JSON.stringify(report));
}
