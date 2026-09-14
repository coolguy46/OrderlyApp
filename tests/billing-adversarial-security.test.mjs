import assert from 'node:assert/strict';
import test from 'node:test';
import Stripe from 'stripe';
import { createBillingService, subscriptionAllowsAI } from '../lib/billing/service.ts';
import { createBillingStripe } from '../lib/billing/transport.ts';
import { verifiedOwner, rejectedOwners } from './fixtures/billing-owner.mjs';
import { adversarialFixture, config, configured, deferred, paid, price, random, request, users } from './fixtures/billing-adversarial.mjs';

const seed = Number(process.env.ORDERLY_BILLING_TEST_SEED || 9132026) >>> 0;
const shuffle = (array, rand) => array.map(value => [rand(), value]).sort((a, b) => a[0] - b[0]).map(pair => pair[1]);

test(`seed ${seed}: 128 independently varied entitlement histories keep two identities isolated`, async () => {
  const rand = random(seed);
  const states = ['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'];
  for (let n = 0; n < 128; n++) {
    const f = adversarialFixture(); const a = f.seedAccount(users[0]); const b = f.seedAccount(users[1]);
    const status = states[n % states.length], expired = rand() < .35, invoicePaid = rand() < .7, paused = rand() < .2, wrongPrice = rand() < .2;
    const now = Math.floor(Date.now() / 1000), end = now + (expired ? -60 : 86400);
    const sub = paid(a.customer_id, { status, trial_start: now - 60, trial_end: end,
      pause_collection: paused ? { behavior: 'void' } : null,
      latest_invoice: { status: invoicePaid ? 'paid' : 'open' },
      items: { data: [{ price: wrongPrice ? { ...price, id: 'price_unrelated' } : price, current_period_end: end }] } });
    f.state.subscriptions = shuffle([sub, paid(a.customer_id, { id: 'sub_old', status: 'canceled' }), paid(b.customer_id)], rand);
    const expected = !paused && !wrongPrice && !expired && (status === 'trialing' || (status === 'active' && invoicePaid));
    const result = await f.service.status(users[0]);
    assert.equal(result.aiAccess, expected, `seed=${seed}, case=${n}, state=${status}`);
    assert.equal((await f.service.status(users[1])).aiAccess, true, 'other customer remains independent');
    assert.equal((await f.service.status('db89c92d-810e-4ad6-8f4b-888007c35996')).aiAccess, false);
    assert.deepEqual(f.state.effects, { customers: 0, checkouts: 0, portals: 0, expirations: 0, events: 0, closes: 0 });
  }
});

test(`seed ${seed}: owner and auth anomalies cannot inherit another account's complimentary status`, async () => configured(async () => {
  const f = adversarialFixture(); const good = f.seedAccount(users[0]); f.state.subscriptions = [paid(good.customer_id)];
  assert.equal((await (await f.routes({ id: users[0] })('status').GET()).json()).aiAccess, true);
  for (const user of shuffle([null, ...rejectedOwners, { id: users[1], user_metadata: { ...verifiedOwner, aiAccess: true } }], random(seed))) {
    const data = await (await f.routes(user)('status').GET(new Request(`${config.origin}/api/billing/status?ownerAccess=true&checkout=success`))).json();
    assert.notEqual(data.aiAccess, true); assert.notEqual(data.ownerAccess, true);
  }
  const owner = await (await f.routes(verifiedOwner)('status').GET()).json();
  assert.equal(owner.aiAccess, true); assert.equal(owner.ownerAccess, true); assert.equal(owner.hasSubscription, false);
  assert.equal(f.state.effects.checkouts, 0);
}));

test(`seed ${seed}: 48 malicious checkout bodies never choose customer, price, trial, quantity or return URL`, async () => configured(async () => {
  const rand = random(seed ^ 0xeeee);
  const payloads = Array.from({ length: 48 }, (_, n) => ({ user_id: users[1], customer: `cus_attacker${n}`, price: ['price_free', null, {}, 0][n % 4],
    quantity: [-1, 0, 999999, 'Infinity'][n % 4], trial_period_days: Math.floor(rand() * 100000), mode: 'payment',
    success_url: `https://attacker.invalid/${n}`, cancel_url: 'javascript:alert(1)', return_url: '//attacker.invalid',
    subscription_data: { trial_period_days: 99999 }, metadata: { orderly_user_id: users[1], orderly_trial_days: '999' },
    ownerAccess: true, paid: true, '__proto__': { aiAccess: true } }));
  const f = adversarialFixture(); const routes = f.routes({ id: users[0] });
  for (const payload of shuffle(payloads, rand)) assert.equal((await routes('checkout').POST(request('checkout', payload))).status, 200);
  assert.equal(f.state.effects.customers, 1); assert.equal(f.state.effects.checkouts, 1); assert.equal(f.state.effects.portals, 0);
  const created = f.state.requests.find(item => item.path === '/v1/checkout/sessions' && item.method === 'POST').params;
  assert.equal(created.customer, f.state.accounts.get(users[0]).customer_id); assert.equal(created.client_reference_id, users[0]);
  assert.equal(created['line_items[0][price]'], config.priceId); assert.equal(created['line_items[0][quantity]'], '1');
  assert.equal(created['subscription_data[trial_period_days]'], '7'); assert.equal(created.mode, 'subscription');
  assert.equal(created.success_url, `${config.origin}/planner?checkout=success`); assert.equal(created.cancel_url, `${config.origin}/planner?checkout=canceled`);
  assert.equal(f.state.accounts.has(users[1]), false); assert.equal((await f.service.status(users[0])).aiAccess, false);
}));

test('direct purchase and portal requests deny missing identity, authentication failure, CSRF and rate denial before side effects', async () => configured(async () => {
  for (const name of ['checkout', 'portal']) {
    for (const [identity, options, origin, expected] of [[null, {}, config.origin, 401], [{ id: users[0] }, { authError: new Error('synthetic') }, config.origin, 401],
      [{ id: users[0] }, {}, 'https://attacker.invalid', 403], [{ id: users[0] }, { limited: true }, config.origin, 429]]) {
      const f = adversarialFixture(); const response = await f.routes(identity, options)(name).POST(request(name, { customer: 'cus_other' }, { origin }));
      assert.equal(response.status, expected); assert.equal(f.state.requests.length, 0); assert.equal(f.state.accounts.size, 0);
    }
  }
}));

test(`seed ${seed}: simultaneous double-clicks and second-user checkouts create at most one purchase per account`, async () => {
  const f = adversarialFixture(); const gate = deferred(); const entered = deferred();
  f.state.hooks.set('beforeRequest', async ({ path }) => { if (path === `/v1/prices/${config.priceId}`) { entered.resolve(); await gate.promise; } });
  const first = f.service.checkout(users[0]); await entered.promise;
  const pending = shuffle(Array.from({ length: 24 }, (_, n) => n % 2 ? users[0] : users[1]), random(seed)).map(id => f.service.checkout(id));
  const results = Promise.allSettled([first, ...pending]); gate.resolve();
  const settled = await results;
  assert.equal(settled.filter(item => item.status === 'fulfilled').length, 2);
  assert.equal(settled.filter(item => item.status === 'rejected' && item.reason.status === 409).length, 23);
  assert.equal(f.state.effects.customers, 2); assert.equal(f.state.effects.checkouts, 2); assert.equal(f.state.leases.size, 0);
  assert.notEqual(f.state.accounts.get(users[0]).customer_id, f.state.accounts.get(users[1]).customer_id);
});

test('checkout in flight blocks deletion; deletion in flight blocks checkout and permanently closes only that account', async () => {
  for (const firstAction of ['checkout', 'prepareDeletion']) {
    const f = adversarialFixture(); const gate = deferred(); const entered = deferred();
    f.state.hooks.set('claim', async () => { entered.resolve(); await gate.promise; });
    const first = f.service[firstAction](users[0]); await entered.promise;
    const otherAction = firstAction === 'checkout' ? 'prepareDeletion' : 'checkout';
    await assert.rejects(f.service[otherAction](users[0]), error => error.status === 409);
    gate.resolve(); await first; f.state.hooks.delete('claim');
    if (firstAction === 'checkout') {
      await f.service.prepareDeletion(users[0]); assert.equal(f.state.effects.expirations, 1);
    }
    assert.equal(f.state.accounts.get(users[0]).closed, true);
    await assert.rejects(f.service.checkout(users[0]), error => error.status === 409);
    await f.service.checkout(users[1]); assert.equal(f.state.accounts.get(users[1]).closed, false);
    assert.equal(f.state.leases.size, 0);
  }
});

test('payment completion during deletion expiry and during final status recheck cannot mark billing closed', async () => {
  for (const completionPoint of ['beforeExpire', 'subscriptionSnapshot']) {
    const f = adversarialFixture(); await f.service.checkout(users[0]);
    const account = f.state.accounts.get(users[0]); const session = f.state.sessions.get(account.checkout_session_id);
    let snapshots = 0;
    f.state.hooks.set(completionPoint, async data => {
      if (completionPoint === 'subscriptionSnapshot' && ++snapshots !== 2) return;
      const subscription = paid(account.customer_id); f.state.subscriptions = [subscription];
      if (completionPoint === 'beforeExpire') { session.status = 'complete'; session.subscription = subscription.id; }
      else data.data = [subscription];
    });
    await assert.rejects(f.service.prepareDeletion(users[0]));
    assert.equal(account.closed, false); assert.equal(f.state.effects.closes, 0); assert.equal(f.state.leases.size, 0);
  }
});

test('completed checkout with unreconciled subscription routes to management, never creates a duplicate', async () => {
  const f = adversarialFixture(); await f.service.checkout(users[0]);
  const account = f.state.accounts.get(users[0]), session = f.state.sessions.get(account.checkout_session_id);
  session.status = 'complete'; session.subscription = 'sub_not_yet_listed';
  assert.equal((await f.service.status(users[0])).aiAccess, false);
  assert.match((await f.service.checkout(users[0])).url, /billing.stripe.com/);
  assert.equal(f.state.effects.checkouts, 1); assert.equal(f.state.effects.portals, 1);
});

test('lost SDK creation responses and each store-write failure retry stable identifiers without duplicate purchases', async () => {
  for (const failure of ['customer-response', 'checkout-response', 'customer_id', 'attempt_trial_days', 'checkout_session_id']) {
    const f = adversarialFixture();
    if (failure.endsWith('response')) {
      const path = failure === 'customer-response' ? '/v1/customers' : '/v1/checkout/sessions';
      f.state.hooks.set('afterEffect', async ({ request: outbound }) => {
        if (outbound.method === 'POST' && outbound.path === path) { f.state.hooks.delete('afterEffect'); throw new Error('synthetic lost network response'); }
      });
    } else f.state.storeFailures.set(failure, 1);
    await assert.rejects(f.service.checkout(users[0]));
    assert.equal(f.state.leases.size, 0);
    const recovered = await f.service.checkout(users[0]); assert.match(recovered.url, /checkout.stripe.com/);
    assert.equal(f.state.effects.customers, 1, failure); assert.equal(f.state.effects.checkouts, 1, failure);
    assert.equal((await f.service.status(users[0])).aiAccess, false);
    await f.service.prepareDeletion(users[0]); assert.equal(f.state.effects.expirations, 1); assert.equal(f.state.effects.closes, 1);
  }
});

test('actual production SDK deadline after a synthetic Stripe side effect retries only the saved idempotent attempt', async () => {
  const f = adversarialFixture(), originalFetch = globalThis.fetch, keepAlive = setTimeout(() => {}, 3000);
  const releaseLateResponse = deferred();
  f.state.hooks.set('afterEffect', async ({ request: outbound }) => {
    if (outbound.path === '/v1/customers') await releaseLateResponse.promise;
  });
  // A controllable fetch-compatible transport: no socket can be opened. Simulate a
  // server-side commit whose client response arrives after the request was aborted.
  globalThis.fetch = async (input, init) => {
    assert.equal(init.redirect, 'error');
    return new Promise((resolve, reject) => {
      const abort = () => reject(init.signal.reason);
      init.signal.addEventListener('abort', abort, { once: true });
      f.transport(input, init).then(resolve, reject).finally(() => init.signal.removeEventListener('abort', abort));
    });
  };
  try {
    const first = createBillingService(createBillingStripe('sk_test_synthetic', Date.now() + 60), f.store, config);
    await assert.rejects(first.checkout(users[0]));
    assert.equal(f.state.effects.customers, 1); assert.equal(f.state.effects.checkouts, 0);
    assert.equal(f.state.accounts.get(users[0]).customer_id, null);
    assert.equal(f.state.leases.size, 0);
    f.state.hooks.delete('afterEffect'); releaseLateResponse.resolve();
    const retry = createBillingService(createBillingStripe('sk_test_synthetic', Date.now() + 3000), f.store, config);
    assert.match((await retry.checkout(users[0])).url, /checkout.stripe.com/);
    assert.equal(f.state.effects.customers, 1); assert.equal(f.state.effects.checkouts, 1);
    const attempts = f.state.requests.filter(r => r.method === 'POST' && r.path === '/v1/customers');
    assert.equal(new Set(attempts.map(r => r.key)).size, 1);
  } finally { releaseLateResponse.resolve(); globalThis.fetch = originalFetch; clearTimeout(keepAlive); }
});

test('losing a lease after session creation cannot confirm a stale save; subsequent deletion reconciles the orphan session', async () => {
  const f = adversarialFixture();
  f.state.hooks.set('afterEffect', async ({ request: outbound }) => {
    if (outbound.path === '/v1/checkout/sessions' && outbound.method === 'POST') {
      f.state.leases.set(users[0], 'a-new-holder'); f.state.hooks.delete('afterEffect');
    }
  });
  await assert.rejects(f.service.checkout(users[0]), /lost leases/);
  assert.equal(f.state.effects.checkouts, 1); assert.equal(f.state.accounts.get(users[0]).checkout_session_id, null);
  assert.equal(f.state.leases.get(users[0]), 'a-new-holder', 'stale release cannot clear replacement lease');
  assert.equal((await f.service.status(users[0])).aiAccess, false);
  f.state.leases.delete(users[0]); // Model the new holder completing, not a production unlock operation.
  await f.service.prepareDeletion(users[0]);
  assert.equal(f.state.effects.expirations, 1); assert.equal(f.state.effects.closes, 1);
});

test('wrong customer or mode returned for a saved session cannot expose its URL or expire it', async () => {
  for (const patch of [{ customer: 'cus_other' }, { livemode: true }]) {
    const f = adversarialFixture(); await f.service.checkout(users[0]);
    Object.assign(f.state.sessions.values().next().value, patch);
    await assert.rejects(f.service.checkout(users[0]), /ownership/);
    if (patch.livemode) await assert.rejects(f.service.prepareDeletion(users[0]));
    else await f.service.prepareDeletion(users[0]); // Customer-filtered enumeration never returns or mutates another customer's session.
    assert.equal(f.state.effects.expirations, 0); assert.equal(f.state.effects.checkouts, 1);
    assert.equal(f.state.effects.closes, patch.livemode ? 0 : 1);
  }
});

test('same retained customer cancels, expires and resubscribes without a second trial; sales switch keeps management', async () => {
  const f = adversarialFixture(); await f.service.checkout(users[0]);
  const account = f.state.accounts.get(users[0]), now = Math.floor(Date.now() / 1000);
  f.state.subscriptions = [paid(account.customer_id, { status: 'trialing', trial_start: now - 60, trial_end: now + 86400, cancel_at_period_end: true })];
  assert.equal((await f.service.status(users[0])).aiAccess, true);
  assert.match((await f.service.checkout(users[0])).url, /billing.stripe.com/);
  f.state.subscriptions[0].status = 'canceled';
  assert.equal((await f.service.status(users[0])).aiAccess, false);
  await f.service.checkout(users[0]);
  const calls = f.state.requests.filter(r => r.method === 'POST' && r.path === '/v1/checkout/sessions');
  assert.equal(calls.length, 2); assert.equal(calls[1].params['subscription_data[trial_period_days]'], undefined);
  const disabled = adversarialFixture({ checkoutEnabled: false }); const existing = disabled.seedAccount(users[0]);
  disabled.state.subscriptions = [paid(existing.customer_id)];
  await assert.rejects(disabled.service.checkout(users[0])); assert.equal((await disabled.service.status(users[0])).aiAccess, true);
  await disabled.service.portal(users[0]); assert.equal(disabled.state.effects.portals, 1); assert.equal(disabled.state.effects.checkouts, 0);
});

test(`seed ${seed}: real SDK signed webhook replay/order/customer anomalies never control entitlement or persist payment details`, async () => configured(async () => {
  const f = adversarialFixture(); const a = f.seedAccount(users[0]), b = f.seedAccount(users[1]);
  const base = Math.floor(Date.now() / 1000), sdk = new Stripe('sk_test_synthetic');
  const events = Array.from({ length: 36 }, (_, n) => ({ id: `evt_synthetic${n % 12}`, object: 'event', livemode: false,
    created: base - n * 60, type: ['invoice.paid', 'invoice.payment_failed', 'customer.subscription.deleted', 'checkout.session.completed'][n % 4],
    data: { object: { customer: n % 2 ? b.customer_id : a.customer_id, metadata: { orderly_user_id: users[1] },
      subscription: 'sub_other', status: 'paid', email: 'private@example.invalid', payment_method: 'pm_synthetic_sensitive' } } }));
  for (const event of shuffle(events, random(seed))) {
    const payload = JSON.stringify(event), signature = sdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const result = await f.routes()('webhook').POST(new Request(`${config.origin}/api/billing/webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }));
    assert.equal(result.status, 200);
    assert.equal((await f.service.status(users[0])).aiAccess, false);
  }
  assert.equal(f.state.events.size, 12); assert.equal(f.state.effects.events, 12);
  assert.doesNotMatch(JSON.stringify([...f.state.events]), /private@|pm_synthetic|cus_seed|sub_other|metadata/);
  for (const receipt of f.state.events.values()) assert.deepEqual(Object.keys(receipt).sort(), ['created', 'id', 'type']);
  f.state.subscriptions = [paid(a.customer_id)];
  assert.equal((await f.service.status(users[0])).aiAccess, true, 'current paid Stripe state still works');
  f.state.subscriptions[0].status = 'past_due';
  assert.equal((await f.service.status(users[0])).aiAccess, false, 'old paid ledger receipt cannot preserve access');
  assert.equal(f.state.effects.customers + f.state.effects.checkouts + f.state.effects.portals, 0);
}));

test('SDK webhook rejects altered bytes, expired signatures, wrong account/mode and oversized bodies without persistence', async () => configured(async () => {
  const sdk = new Stripe('sk_test_synthetic');
  const event = { id: 'evt_synthetic', object: 'event', type: 'invoice.paid', livemode: false, created: 123, data: { object: {} } };
  for (const variant of ['tampered', 'old', 'wrong-secret', 'wrong-mode', 'wrong-account', 'too-large', 'length-spoof']) {
    const f = adversarialFixture();
    let payload = JSON.stringify({ ...event, ...(variant === 'wrong-mode' ? { livemode: true } : {}), ...(variant === 'wrong-account' ? { account: 'acct_other' } : {}) });
    if (variant === 'too-large' || variant === 'length-spoof') payload += ' '.repeat(262145);
    const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: variant === 'wrong-secret' ? 'whsec_other' : process.env.STRIPE_WEBHOOK_SECRET,
      ...(variant === 'old' ? { timestamp: Math.floor(Date.now() / 1000) - 301 } : {}) });
    if (variant === 'tampered') payload += ' ';
    const headers = { 'stripe-signature': signature, ...(variant === 'length-spoof' ? { 'content-length': '1' } : {}) };
    const result = await f.routes()('webhook').POST(new Request(`${config.origin}/api/billing/webhook`, { method: 'POST', body: payload, headers }));
    assert.equal(result.status, variant.includes('large') || variant === 'length-spoof' ? 413 : 400, variant);
    assert.equal(f.state.effects.events, 0); assert.equal(f.state.requests.length, 0);
  }
}));

test('webhook storage failure retries safely, and cancellation boundaries never extend an expired trial', async () => configured(async () => {
  const f = adversarialFixture(), sdk = new Stripe('sk_test_synthetic');
  const payload = JSON.stringify({ id: 'evt_retry', object: 'event', type: 'invoice.paid', livemode: false, created: 123, data: { object: {} } });
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const send = () => f.routes()('webhook').POST(new Request(`${config.origin}/api/billing/webhook`, { method: 'POST', body: payload, headers: { 'stripe-signature': signature } }));
  f.state.failEvents = true; assert.equal((await send()).status, 503); assert.equal(f.state.effects.events, 0);
  f.state.failEvents = false; for (let n = 0; n < 10; n++) assert.equal((await send()).status, 200);
  assert.equal(f.state.effects.events, 1);
  const now = 1800000000000, start = now / 1000 - 7 * 86400;
  for (const skew of [-1, 0, 1]) {
    const sub = paid('cus_fixture', { status: 'trialing', trial_start: start, trial_end: now / 1000,
      cancel_at_period_end: true, items: { data: [{ price, current_period_end: now / 1000 }] } });
    assert.equal(subscriptionAllowsAI(sub, config.priceId, now + skew), skew < 0);
  }
}));
