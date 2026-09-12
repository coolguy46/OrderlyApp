import assert from 'node:assert/strict';
import test from 'node:test';
import Stripe from 'stripe';
import { readFile } from 'node:fs/promises';
import { billingConfig } from '../lib/billing/config.ts';
import { createBillingService, subscriptionAllowsAI, validMonthlyPrice } from '../lib/billing/service.ts';
import { acceptBillingEvent, webhookBody } from '../lib/billing/webhook.ts';

const config = { priceId: 'price_test', origin: 'http://localhost:3000', portalConfiguration: 'bpc_fixture' };
const price = { id: 'price_test', active: true, livemode: false, currency: 'usd', unit_amount: 499, type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
const subscription = (patch = {}) => ({ id: 'sub_test', livemode: false, status: 'active', items: { data: [{ price, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] }, latest_invoice: { status: 'paid' }, ...patch });

function fixture(livemode = false, checkoutEnabled = true) {
  let account = null;
  let locked = false;
  const state = { subscriptions: [], session: null, calls: [], events: new Map(), failSave: false };
  const store = {
    async load(userId) { return account?.user_id === userId ? { ...account } : null; },
    async claim(userId) {
      if (locked) return null;
      locked = true;
      if (!account) account = { user_id: userId, customer_id: null, attempt_id: 'attempt-a', attempt_started_at: new Date().toISOString(), attempt_trial_days: null, checkout_session_id: null, closed: false };
      assert.equal(account.user_id, userId);
      return { ...account };
    },
    async save(userId, token, patch) {
      assert.equal(userId, account.user_id);
      if (patch.checkout_session_id && state.failSave) { state.failSave = false; throw new Error('save failed'); }
      Object.assign(account, patch);
    },
    async release() { locked = false; },
    async recordEvent(id, type) { state.events.set(id, type); },
  };
  const stripe = {
    prices: { async retrieve(id) { assert.equal(id, config.priceId); return { ...price, livemode }; } },
    customers: {
      async retrieve(id) { assert.equal(id, 'cus_owner'); return { id, livemode }; },
      async create(params, options) { state.calls.push(['customer', params, options]); return { id: 'cus_owner', livemode }; }
    },
    subscriptions: { list(params) { state.calls.push(['subscriptions', params]); return (async function* () { yield* state.subscriptions; })(); } },
    checkout: { sessions: {
      async create(params, options) { state.calls.push(['checkout', params, options]); state.session = { id: 'cs_test', status: 'open', customer: 'cus_owner', url: 'https://checkout.stripe.com/test', metadata: params.metadata, livemode }; return state.session; },
      async retrieve(id) { assert.equal(id, 'cs_test'); return state.session; },
      list() { return (async function* () { if (state.session?.status === 'open') yield state.session; })(); },
      async expire() { state.session.status = 'expired'; },
    } },
    billingPortal: {
      configurations: { async retrieve() { return { active: true, livemode, features: { subscription_cancel: { enabled: true, mode: 'at_period_end' }, payment_method_update: { enabled: true } } }; } },
      sessions: { async create(params) { state.calls.push(['portal', params]); return { url: 'https://billing.stripe.com/test' }; } }
    },
  };
  return { service: createBillingService(stripe, store, { ...config, livemode, checkoutEnabled }), state, store, stripe, setAccount(value) { account = value; } };
}

test('billing is disabled by default, rejects mixed modes and untrusted redirects', () => {
  assert.throws(() => billingConfig({}), /not enabled/);
  const env = { STRIPE_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_AI_PRICE_ID: 'price_test', STRIPE_ACCOUNT_ID: 'acct_test' };
  assert.equal(billingConfig(env).origin, config.origin);
  assert.throws(() => billingConfig({ ...env, STRIPE_SECRET_KEY: 'sk_live_fake' }), /mode/);
  assert.throws(() => billingConfig({ ...env, VERCEL_ENV: 'production' }), /Sandbox/);
  for (const origin of ['http://evil.example', 'https://user:pass@example.com', 'https://example.com/path', 'javascript:alert(1)']) {
    assert.throws(() => billingConfig({ ...env, STRIPE_APP_ORIGIN: origin }));
  }
  assert.throws(() => billingConfig({ ...env, STRIPE_WEBHOOK_SECRET: '' }), /missing/);
});

test('production needs explicit live mode and canonical origin; new live sales default off', () => {
  const env = { STRIPE_BILLING_ENABLED: 'true', STRIPE_MODE: 'live', STRIPE_SECRET_KEY: 'sk_live_fake', STRIPE_WEBHOOK_SECRET: 'whsec_fake', STRIPE_AI_PRICE_ID: 'price_live', STRIPE_ACCOUNT_ID: 'acct_live', STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture', STRIPE_APP_ORIGIN: 'https://www.myorderlyapp.com', VERCEL_ENV: 'production' };
  assert.equal(billingConfig(env).livemode, true);
  assert.equal(billingConfig(env).checkoutEnabled, false);
  assert.equal(billingConfig({ ...env, STRIPE_CHECKOUT_ENABLED: 'true' }).checkoutEnabled, true);
  assert.throws(() => billingConfig({ ...env, STRIPE_SECRET_KEY: 'sk_test_fake' }), /mode/);
  assert.throws(() => billingConfig({ ...env, VERCEL_ENV: 'preview' }), /preview/);
  assert.throws(() => billingConfig({ ...env, STRIPE_APP_ORIGIN: 'http://localhost:3000' }), /main Orderly/);
  assert.throws(() => billingConfig({ ...env, STRIPE_MODE: 'typo' }), /Invalid Stripe/);
  assert.throws(() => billingConfig({ ...env, STRIPE_PORTAL_CONFIGURATION_ID: '' }), /management/);
});

test('live checkout cannot sell a subscription without cancellation and payment management', async () => {
  const f = fixture(true);
  f.stripe.billingPortal.configurations.retrieve = async () => ({ active: true, livemode: true, features: { subscription_cancel: { enabled: false }, payment_method_update: { enabled: true } } });
  await assert.rejects(f.service.checkout('owner'), /cancellation/);
  assert.equal(f.state.calls.filter(c => c[0] === 'checkout' || c[0] === 'customer').length, 0);
});

test('live subscriptions unlock only live billing and test events cannot affect live billing', async () => {
  const f = fixture(true);
  await f.service.checkout('owner');
  f.state.subscriptions = [subscription({ livemode: true })];
  assert.equal((await f.service.status('owner')).aiAccess, true);
  assert.equal((await f.service.status('owner')).sandbox, false);
  assert.equal(subscriptionAllowsAI(subscription(), config.priceId, Date.now(), true), false);
  assert.equal(validMonthlyPrice(price, true), false);
  f.state.subscriptions = [subscription()];
  await assert.rejects(f.service.status('owner'), /mode/);
  const event = { id: 'evt_live', type: 'invoice.paid', created: 123, livemode: true };
  await acceptBillingEvent(event, f.store, 'acct_live', true);
  await assert.rejects(acceptBillingEvent({ ...event, livemode: false }, f.store, 'acct_live', true));
});

test('staged sales switch blocks checkout without preventing existing subscription access or portal', async () => {
  const f = fixture(true, false);
  await assert.rejects(f.service.checkout('owner'), /not available/);
  assert.equal(f.state.calls.length, 0);
  f.setAccount({ user_id: 'owner', customer_id: 'cus_owner' });
  f.state.subscriptions = [subscription({ livemode: true })];
  const status = await f.service.status('owner');
  assert.equal(status.aiAccess, true); assert.equal(status.checkoutEnabled, false);
  assert.match((await f.service.portal('owner')).url, /billing.stripe/);
});

test('customer mode is checked even for empty subscriptions and direct portal access', async () => {
  const f = fixture(true);
  f.setAccount({ user_id: 'owner', customer_id: 'cus_owner' });
  f.stripe.customers.retrieve = async () => ({ id: 'cus_owner', livemode: false });
  for (const operation of ['status', 'portal', 'prepareDeletion']) await assert.rejects(f.service[operation]('owner'), /customer mode/);
});

test('only the approved active flat monthly price is accepted', () => {
  assert.equal(validMonthlyPrice(price), true);
  for (const patch of [{ active: false }, { livemode: true }, { unit_amount: 0 }, { currency: 'eur' }, { recurring: { interval: 'year', interval_count: 1 } }, { transform_quantity: { divide_by: 10 } }]) assert.equal(validMonthlyPrice({ ...price, ...patch }), false);
});

test('entitlement requires current paid Stripe state, not redirects or a subscription ID', () => {
  assert.equal(subscriptionAllowsAI(subscription(), config.priceId), true);
  assert.equal(subscriptionAllowsAI(subscription({ cancel_at_period_end: true }), config.priceId), true);
  for (const status of ['incomplete', 'incomplete_expired', 'past_due', 'canceled', 'unpaid', 'paused', 'trialing']) assert.equal(subscriptionAllowsAI(subscription({ status }), config.priceId), false);
  for (const patch of [{ latest_invoice: null }, { latest_invoice: 'in_test' }, { latest_invoice: { status: 'open' } }, { pause_collection: { behavior: 'void' } }, { livemode: true }]) assert.equal(Boolean(subscriptionAllowsAI(subscription(patch), config.priceId)), false);
  assert.equal(subscriptionAllowsAI(subscription(), 'price_other'), false);
  assert.equal(subscriptionAllowsAI(subscription(), config.priceId, Date.now() + 2 * 86400_000), false);
});

test('checkout fixes server-owned customer, price, quantity, mode, and redirects; double click reuses session', async () => {
  const f = fixture();
  const first = await f.service.checkout('owner');
  assert.deepEqual(await f.service.checkout('owner'), first);
  assert.equal(f.state.calls.filter(c => c[0] === 'checkout').length, 1);
  const [, params] = f.state.calls.find(c => c[0] === 'checkout');
  assert.equal(params.customer, 'cus_owner'); assert.equal(params.mode, 'subscription');
  assert.equal(params.client_reference_id, 'owner');
  assert.deepEqual(params.line_items, [{ price: 'price_test', quantity: 1 }]);
  assert.equal(params.success_url, config.origin + '/planner?checkout=success');
  assert.equal(params.cancel_url, config.origin + '/planner?checkout=canceled');
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal(params.payment_method_collection, 'always');
  assert.equal(params.automatic_tax, undefined);
  assert.equal(params.subscription_data.trial_period_days, 7);
  assert.equal(params.subscription_data.trial_settings.end_behavior.missing_payment_method, 'cancel');
  assert.equal((await f.store.load('owner')).attempt_trial_days, 7);
});

test('verified seven-day trial grants AI until expiry, including scheduled cancellation', async () => {
  const now = Date.now();
  const start = Math.floor(now / 1000) - 60;
  const end = start + 7 * 86400;
  const trial = subscription({ status: 'trialing', trial_start: start, trial_end: end, latest_invoice: null,
    items: { data: [{ price, current_period_end: end }] } });
  assert.equal(subscriptionAllowsAI(trial, config.priceId, now), true);
  assert.equal(subscriptionAllowsAI({ ...trial, cancel_at_period_end: true, cancel_at: end }, config.priceId, now), true);
  assert.equal(subscriptionAllowsAI(trial, config.priceId, end * 1000), false);
  for (const patch of [{ trial_end: null }, { trial_start: null }, { trial_start: end + 1 }, { trial_end: start - 1 },
    { trial_end: NaN }, { trial_start: Infinity }, { pause_collection: { behavior: 'void' } }, { status: 'canceled' }, { livemode: true }]) {
    assert.equal(subscriptionAllowsAI({ ...trial, ...patch }, config.priceId, now), false);
  }
  assert.equal(subscriptionAllowsAI(trial, 'price_wrong', now), false);
  const f = fixture();
  assert.equal((await f.service.status('owner')).trialEligible, true);
  await f.service.checkout('owner');
  f.state.subscriptions = [{ ...trial, cancel_at_period_end: true, cancel_at: end }];
  const status = await f.service.status('owner');
  assert.equal(status.aiAccess, true); assert.equal(status.trialEligible, false);
  assert.equal(status.trialEndsAt, new Date(end * 1000).toISOString());
  assert.equal(status.accessEndsAt, status.trialEndsAt); assert.equal(status.cancelAtPeriodEnd, true);
  f.state.subscriptions = [subscription()];
  assert.equal((await f.service.status('owner')).aiAccess, true);
  assert.equal((await f.service.status('owner')).trialEndsAt, null);
  f.state.subscriptions = [subscription({ status: 'past_due', latest_invoice: { status: 'open' } })];
  assert.equal((await f.service.status('owner')).aiAccess, false);
  assert.equal((await f.service.status('owner')).trialEligible, false);
});

test('live portal must preserve trial and paid access through period end', async () => {
  const f = fixture(true);
  f.stripe.billingPortal.configurations.retrieve = async () => ({ active: true, livemode: true,
    features: { subscription_cancel: { enabled: true, mode: 'immediately' }, payment_method_update: { enabled: true } } });
  await assert.rejects(f.service.checkout('owner'), /cancellation/);
  assert.equal(f.state.calls.length, 0);
});

test('stale open trial and legacy paid checkout are expired when displayed terms change', async () => {
  for (const returning of [true, false]) {
    const f = fixture(); await f.service.checkout('owner');
    if (returning) f.state.subscriptions = [subscription({ status: 'canceled' })];
    else f.state.session.metadata = {}; // Legacy, pre-trial checkout must not charge a new trial customer.
    await f.service.checkout('owner');
    const calls = f.state.calls.filter(c => c[0] === 'checkout');
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
    assert.equal(calls[1][1].subscription_data.trial_period_days, returning ? undefined : 7);
  }
});

test('lost checkout response retries frozen trial terms, expires changed eligibility, then uses a new paid attempt', async () => {
  const f = fixture(); f.state.failSave = true;
  await assert.rejects(f.service.checkout('owner'), /save failed/);
  f.state.subscriptions = [subscription({ status: 'canceled' })];
  await assert.rejects(f.service.checkout('owner'), /billing history changed/);
  const firstTwo = f.state.calls.filter(c => c[0] === 'checkout');
  assert.deepEqual(firstTwo[0], firstTwo[1]);
  assert.equal(f.state.session.status, 'expired');
  await f.service.checkout('owner');
  const last = f.state.calls.filter(c => c[0] === 'checkout').at(-1);
  assert.notEqual(last[2].idempotencyKey, firstTwo[0][2].idempotencyKey);
  assert.equal(last[1].subscription_data.trial_period_days, undefined);
});

test('trial decision save failure cannot start Stripe Checkout', async () => {
  const f = fixture(); const save = f.store.save;
  f.store.save = async (...args) => { if ('attempt_trial_days' in args[2]) throw new Error('trial save failed'); return save(...args); };
  await assert.rejects(f.service.checkout('owner'), /trial save failed/);
  assert.equal(f.state.calls.filter(c => c[0] === 'checkout').length, 0);
});

test('failed database save retries the identical Stripe idempotency key and parameters', async () => {
  const f = fixture(); f.state.failSave = true;
  await assert.rejects(f.service.checkout('owner'), /save failed/);
  await f.service.checkout('owner');
  const calls = f.state.calls.filter(c => c[0] === 'checkout');
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(f.state.calls.filter(c => c[0] === 'customer').length, 1);
});

test('active/incomplete/past-due subscriptions go to portal instead of creating a duplicate', async () => {
  for (const status of ['active', 'incomplete', 'past_due', 'unpaid', 'paused', 'trialing']) {
    const f = fixture(); f.state.subscriptions = [subscription({ status })];
    assert.equal((await f.service.checkout('owner')).url, 'https://billing.stripe.com/test');
    assert.equal(f.state.calls.filter(c => c[0] === 'checkout').length, 0);
  }
});

test('expired checkout and conclusively canceled subscription can be purchased again', async () => {
  for (const priorStatus of ['expired', 'complete']) {
    const f = fixture(); await f.service.checkout('owner');
    f.state.session.status = priorStatus;
    f.state.session.subscription = 'sub_test';
    f.state.subscriptions = [subscription({ status: 'canceled' })];
    await f.service.checkout('owner');
    const calls = f.state.calls.filter(c => c[0] === 'checkout');
    assert.equal(calls.length, 2); assert.notEqual(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
    assert.equal(calls[1][1].subscription_data.trial_period_days, undefined);
    assert.equal((await f.service.status('owner')).trialEligible, false);
  }
});

test('completed but unconfirmed purchase cannot start a second checkout', async () => {
  const f = fixture(); await f.service.checkout('owner'); f.state.session.status = 'complete';
  assert.equal((await f.service.checkout('owner')).url, 'https://billing.stripe.com/test');
  assert.equal(f.state.calls.filter(c => c[0] === 'checkout').length, 1);
});

test('status refresh reflects renewal failure and restoration; never uses webhook arrival order', async () => {
  const f = fixture(); await f.service.checkout('owner');
  f.state.subscriptions = [subscription()]; assert.equal((await f.service.status('owner')).aiAccess, true);
  f.state.subscriptions = [subscription({ status: 'past_due' })]; assert.equal((await f.service.status('owner')).aiAccess, false);
  f.state.subscriptions = [subscription()]; assert.equal((await f.service.status('owner')).aiAccess, true);
  assert.equal((await f.service.status('other')).aiAccess, false);
  await assert.rejects(f.service.portal('other'), /no billing account/);
});

test('deletion expires abandoned checkout, blocks recurring charges and closes account to new checkout', async () => {
  const f = fixture(); await f.service.checkout('owner');
  f.state.subscriptions = [subscription()];
  await assert.rejects(f.service.prepareDeletion('owner'), /subscription has ended/);
  f.state.subscriptions = [];
  await f.service.prepareDeletion('owner'); assert.equal(f.state.session.status, 'expired');
  await assert.rejects(f.service.checkout('owner'), /being deleted/);
  await f.service.prepareDeletion('owner'); // Safe repeat after a deletion request was enqueued.
});

test('uncertain customer/session creation older than idempotency window fails closed', async () => {
  const f = fixture(); f.setAccount({ user_id: 'owner', customer_id: null, attempt_id: 'old', attempt_started_at: new Date(Date.now() - 25 * 3600_000).toISOString(), checkout_session_id: null, closed: false });
  await assert.rejects(f.service.checkout('owner'), /administrator review/);
  assert.equal(f.state.calls.filter(c => c[0] === 'customer').length, 0);
});

test('webhook bytes verify through the real SDK; modified/old signatures fail', async () => {
  const stripe = new Stripe('sk_test_not_a_real_key');
  const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'invoice.paid', livemode: false, created: 123, data: { object: {} } });
  const secret = 'whsec_fixture_only';
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  const raw = await webhookBody(new Request('http://localhost/api/billing/webhook', { method: 'POST', body: payload }));
  assert.equal(raw.toString(), payload);
  const event = stripe.webhooks.constructEvent(raw, header, secret);
  assert.throws(() => stripe.webhooks.constructEvent(raw + ' ', header, secret));
  const old = stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: 1 });
  assert.throws(() => stripe.webhooks.constructEvent(raw, old, secret));
  const f = fixture(); await acceptBillingEvent(event, f.store, 'acct_test'); await acceptBillingEvent(event, f.store, 'acct_test');
  assert.equal(f.state.events.size, 1);
  await assert.rejects(acceptBillingEvent({ ...event, livemode: true }, f.store, 'acct_test'));
  await assert.rejects(acceptBillingEvent({ ...event, account: 'acct_other' }, f.store, 'acct_test'));
});

test('webhook payload size is enforced without trusting content-length', async () => {
  await assert.rejects(webhookBody(new Request('http://localhost', { method: 'POST', body: 'a'.repeat(262145) })), /too large/);
});

test('all active AI provider routes guard paid access before fetching DeepSeek', async () => {
  for (const name of ['command', 'chat', 'conversation']) {
    const source = await readFile(new URL(`../app/api/planner/${name}/route.ts`, import.meta.url), 'utf8');
    assert.ok(source.indexOf('await requireAssistantSubscription(user.id)') < source.indexOf("fetch('https://api.deepseek.com"));
    assert.match(source, /if \(subscriptionDenied\) return subscriptionDenied/);
  }
  const moved = await readFile(new URL('../app/api/planner/interpret/route.ts', import.meta.url), 'utf8');
  assert.match(moved, /status: 410/);
  const source = await readFile(new URL('../app/api/planner/conversation/route.ts', import.meta.url), 'utf8');
  assert.ok(source.indexOf('if (prior.data)') < source.indexOf('await requireAssistantSubscription'));
});

test('billing mutation routes authenticate and reject cross-origin requests; ignore client identity', async () => {
  for (const route of ['checkout', 'portal']) {
    const source = await readFile(new URL(`../app/api/billing/${route}/route.ts`, import.meta.url), 'utf8');
    assert.match(source, /guardMutationRequest\(request\)/); assert.match(source, /auth\.getUser\(\)/);
    assert.match(source, /user\.id/); assert.doesNotMatch(source, /request\.json\(|session_id.*searchParams/);
    assert.ok(source.indexOf('auth.getUser()') < source.indexOf(`service.${route}(user.id)`));
  }
});
