import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');

async function configured(run, overrides = {}) {
  const values = {
    AI_SUBSCRIPTION_REQUIRED: 'true', STRIPE_BILLING_ENABLED: 'true', STRIPE_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_fixture_only', STRIPE_WEBHOOK_SECRET: 'whsec_fixture_only',
    STRIPE_AI_PRICE_ID: 'price_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture',
    STRIPE_APP_ORIGIN: 'http://localhost:3000', VERCEL_ENV: 'preview',
    NEXT_PUBLIC_SUPABASE_URL: 'https://billing-fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture_only',
    DEEPSEEK_API_KEY: 'fixture_only', AI_ASSISTANT_ENABLED: 'true', ...overrides,
  };
  const prior = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    Object.assign(process.env, values);
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

// Load actual route validation, billing guard, billing service and access policy.
// Only auth, Stripe and database transports are fake; no live keys/data/network.
function fixture({ paid = false, trial = false, subscriptionPatch = {}, stripeFailure = false, wrongAccount = false, anonymous = false } = {}) {
  const owner = randomUUID();
  const calls = { stripe: [], billingReads: [], provider: [], rpc: [] };
  const receipts = new Map();
  const subscription = {
    id: 'sub_fixture', livemode: false, status: 'active', pause_collection: null,
    latest_invoice: { status: 'paid' }, cancel_at_period_end: false,
    items: { data: [{ price: { id: 'price_fixture' }, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
    ...(trial ? { status: 'trialing', latest_invoice: null, trial_start: Math.floor(Date.now() / 1000) - 86400,
      trial_end: Math.floor(Date.now() / 1000) + 86400 } : {}),
    ...subscriptionPatch,
  };
  const billingAccount = { user_id: owner, customer_id: 'cus_fixture', closed: false };
  const authClient = {
    auth: { async getUser() { return { data: { user: anonymous ? null : { id: owner } }, error: null }; } },
    from(table) {
      assert.equal(table, 'assistant_action_receipts');
      const filters = {};
      return {
        select() { return this; }, eq(key, value) { filters[key] = value; return this; },
        async maybeSingle() {
          assert.equal(filters.user_id, owner);
          const response = receipts.get(filters.request_id);
          return { data: response ? { response } : null, error: null };
        },
      };
    },
    async rpc(name, parameters) {
      calls.rpc.push([name, parameters]);
      if (name === 'assistant_calendar_snapshot') return { data: { revision: 'fixture-revision' }, error: null };
      if (name === 'apply_assistant_calendar_changes') return {
        data: { ...parameters.p_response, saved: true, requestId: parameters.p_request_id }, error: null,
      };
      assert.fail(`Unexpected RPC after billing denial: ${name}`);
    },
  };
  class FakeStripe {
    accounts = { retrieve: async () => {
      calls.stripe.push('account');
      if (stripeFailure) throw new Error('PRIVATE_PROVIDER_FAILURE');
      return { id: wrongAccount ? 'acct_other' : 'acct_fixture', charges_enabled: true };
    } };
    customers = { retrieve: async id => {
      calls.stripe.push(['customer', id]); assert.equal(id, 'cus_fixture');
      return { id, livemode: false };
    } };
    subscriptions = { list: ({ customer }) => {
      calls.stripe.push(['subscriptions', customer]); assert.equal(customer, 'cus_fixture');
      return (async function* () { if (paid || trial) yield subscription; })();
    } };
  }
  const stubs = {
    'server-only': {}, 'next/server': { NextResponse: Response }, stripe: FakeStripe,
    '@/lib/supabase/server': { createSupabaseServerClient: async () => authClient },
    '@supabase/supabase-js': { createClient: () => ({ from(table) {
      assert.equal(table, 'billing_accounts');
      return { select() { return this; }, eq(key, id) {
        assert.equal(key, 'user_id'); assert.equal(id, owner);
        calls.billingReads.push(id); return this;
      }, async maybeSingle() { return { data: billingAccount, error: null }; } };
    } }) },
    '@/lib/planner/assistant-abuse-server': { createAssistantAbuseClient() { assert.fail('Denied AI must not claim a provider lease'); } },
  };
  const cache = new Map();
  function load(file) {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const output = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    new Function('require', 'module', 'exports', output)(specifier => {
      if (specifier in stubs) return stubs[specifier];
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const target = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
      return load(/\.tsx?$/.test(target) ? target : `${target}.ts`);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  globalThis.fetch = async (...args) => { calls.provider.push(args); throw new Error('Unexpected network call'); };
  const input = {
    requestId: randomUUID(), conversationId: randomUUID(), timeZone: 'UTC',
    messages: [{ role: 'user', content: 'Plan my week' }],
  };
  const request = (name, body = name === 'command' ? { prompt: 'Plan my week', context: {} } : input, origin = 'http://localhost:3000') =>
    new Request(`http://localhost:3000/api/planner/${name}`, {
      method: 'POST', headers: { origin, 'content-type': 'application/json', cookie: 'fixture_only' }, body: JSON.stringify(body),
    });
  return {
    owner, calls, receipts, input, request, load,
    route: name => load(`app/api/planner/${name}/route.ts`).POST,
    guard: () => load('lib/billing/server.ts').requireAssistantSubscription(owner),
  };
}

test('real subscription guard grants only verified paid access and sanitizes billing failures', async () => configured(async () => {
  const paid = fixture({ paid: true }); assert.equal(await paid.guard(), null);
  assert.deepEqual(paid.calls.billingReads, [paid.owner]);
  const unpaid = fixture(); const denied = await unpaid.guard();
  assert.equal(denied.status, 402); assert.equal((await denied.json()).code, 'subscription_required');
  for (const options of [{ stripeFailure: true }, { wrongAccount: true }]) {
    const failed = fixture(options); const response = await failed.guard();
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER_FAILURE|acct_other/);
    assert.deepEqual(failed.calls.billingReads, []);
  }
}));

test('billing-disabled with enforcement enabled fails closed; enforcement disabled performs no billing request', async () => configured(async () => {
  process.env.STRIPE_BILLING_ENABLED = 'false';
  const badRollout = fixture(); assert.equal((await badRollout.guard()).status, 503);
  assert.deepEqual(badRollout.calls.stripe, []);
  process.env.AI_SUBSCRIPTION_REQUIRED = 'false';
  const free = fixture(); assert.equal(await free.guard(), null); assert.deepEqual(free.calls.stripe, []);
}));

test('real guard allows verified trials without a paid invoice and stops expired or canceled trial access', async () => configured(async () => {
  for (const patch of [{}, { cancel_at_period_end: true }]) {
    const f = fixture({ trial: true, subscriptionPatch: patch });
    assert.equal(await f.guard(), null);
    const { service } = await f.load('lib/billing/server.ts').billingServer();
    const status = await service.status(f.owner);
    assert.equal(status.status, 'trialing'); assert.equal(status.aiAccess, true);
    assert.equal(status.trialEligible, false); assert.ok(Date.parse(status.trialEndsAt) > Date.now());
    assert.ok(Date.parse(status.accessEndsAt) > Date.now());
    assert.equal(status.cancelAtPeriodEnd, Boolean(patch.cancel_at_period_end));
  }
  const past = Math.floor(Date.now() / 1000) - 1;
  for (const patch of [{ trial_end: past }, { cancel_at: past }, { status: 'canceled' }, { status: 'past_due' }]) {
    const f = fixture({ trial: true, subscriptionPatch: patch });
    assert.equal((await f.guard()).status, 402);
    assert.deepEqual(f.calls.provider, []);
  }
}));

test('all actual AI handlers deny unpaid users and billing outages before paid calls, usage reservations or mutations', async () => configured(async () => {
  for (const name of ['conversation', 'chat', 'command']) {
    for (const [options, expected] of [[{}, 402], [{ stripeFailure: true }, 503]]) {
      const f = fixture(options); const response = await f.route(name)(f.request(name));
      assert.equal(response.status, expected, name); assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.json(); assert.equal(body.aiUsed, false); assert.equal(body.saved, false);
      assert.deepEqual(f.calls.provider, []);
      assert.ok(f.calls.rpc.every(([rpc]) => rpc === 'assistant_calendar_snapshot'));
    }
  }
}));

test('signed-out and cross-site AI requests are rejected before privileged billing transport', async () => configured(async () => {
  for (const name of ['conversation', 'chat', 'command']) {
    const anonymous = fixture({ anonymous: true });
    assert.equal((await anonymous.route(name)(anonymous.request(name))).status, 401);
    assert.deepEqual(anonymous.calls.stripe, []);
    const foreign = fixture();
    assert.equal((await foreign.route(name)(foreign.request(name, undefined, 'https://attacker.invalid'))).status, 403);
    assert.deepEqual(foreign.calls.stripe, []);
  }
}));

test('confirmed receipts and Undo remain available after subscription loss or billing outage', async () => configured(async () => {
  const recovered = fixture({ stripeFailure: true });
  const receipt = { saved: true, reply: 'Already saved', requestId: recovered.input.requestId };
  recovered.receipts.set(recovered.input.requestId, receipt);
  assert.deepEqual(await (await recovered.route('conversation')(recovered.request('conversation'))).json(), receipt);
  assert.deepEqual(recovered.calls.stripe, []); assert.deepEqual(recovered.calls.rpc, []);
  const undo = fixture({ stripeFailure: true }); const originalId = randomUUID();
  undo.receipts.set(originalId, { saved: true, revision: 'original', undoOperations: [{ entity: 'event', op: 'delete', id: randomUUID() }] });
  const response = await undo.route('conversation')(undo.request('conversation', { ...undo.input, undoRequestId: originalId }));
  assert.equal(response.status, 200); assert.equal((await response.json()).saved, true);
  assert.equal(undo.calls.rpc.filter(([name]) => name === 'apply_assistant_calendar_changes').length, 1);
  assert.deepEqual(undo.calls.stripe, []); assert.deepEqual(undo.calls.provider, []);
}));

test('deterministic correction of an existing draft remains free without billing or provider calls', async () => configured(async () => {
  const f = fixture({ stripeFailure: true });
  const commands = ['can you add a hiking even on saturday morning from 4 am to 9 am', 'add a pickleball task from 4 to 5 pm or saturday'];
  const body = {
    messages: [{ role: 'user', content: commands.join(' and then ') },
      { role: 'assistant', content: 'Both items are in your calendar draft.' },
      { role: 'user', content: 'i menat hiking event not task' }],
    context: { activeDraft: { kind: 'exact_commands', summary: 'Create two calendar items.', taskScope: null,
      taskIds: [], normalizedCommands: commands, createdAt: '2026-08-27T19:00:00.000Z' } },
  };
  const response = await f.route('chat')(f.request('chat', body));
  assert.equal(response.status, 200); const result = await response.json();
  assert.equal(result.aiUsed, false); assert.deepEqual(result.normalizedCommands, commands);
  assert.deepEqual(f.calls.stripe, []); assert.deepEqual(f.calls.provider, []);
}));
