import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import Stripe from 'stripe';
import { createBillingService } from '../../lib/billing/service.ts';
import { withTestOwner } from './billing-owner.mjs';

const require = createRequire(import.meta.url);
const ts = require('typescript');
export const users = ['5b296c23-385e-45be-8eb1-a283f20dd55a', '8c76e47c-bafe-4287-bcb0-d679e346ca81'];
export const config = { newTrialDays: 7, priceId: 'price_synthetic', origin: 'http://localhost:3000', accountId: 'acct_synthetic', livemode: false };
export const price = { id: config.priceId, active: true, livemode: false, currency: 'usd', unit_amount: 899,
  type: 'recurring', billing_scheme: 'per_unit', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } };
export function paid(customer, patch = {}) {
  return { id: `sub_${customer}`, object: 'subscription', customer, livemode: false, status: 'active',
    items: { data: [{ price, current_period_end: Math.floor(Date.now() / 1000) + 86400 }] },
    latest_invoice: { id: `in_${customer}`, customer, livemode: false, status: 'paid' }, ...patch };
}
export function random(seed) {
  let value = seed >>> 0;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
export function deferred() {
  let resolvePromise;
  const promise = new Promise(resolve => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

/** Real SDK serialization/pagination/signatures, synthetic transport and durable-store model only. */
export function adversarialFixture(options = {}) {
  const state = { accounts: new Map(), customers: new Map(), sessions: new Map(), subscriptions: [], events: new Map(),
    requests: [], effects: { customers: 0, checkouts: 0, portals: 0, expirations: 0, events: 0, closes: 0 },
    leases: new Map(), idem: new Map(), hooks: new Map(), storeFailures: new Map(), rateCalls: [], failEvents: false };
  async function hook(name, value) { const fn = state.hooks.get(name); if (fn) await fn(value); }
  function newAccount(userId) {
    return { user_id: userId, customer_id: null, attempt_id: crypto.randomUUID(), attempt_started_at: new Date().toISOString(),
      attempt_trial_days: null, checkout_session_id: null, closed: false };
  }
  const store = {
    async load(id) { await hook('load', id); return structuredClone(state.accounts.get(id) || null); },
    async claim(id, token) {
      if (state.leases.has(id)) return null;
      state.leases.set(id, token);
      if (!state.accounts.has(id)) state.accounts.set(id, newAccount(id));
      await hook('claim', id);
      return structuredClone(state.accounts.get(id));
    },
    async save(id, token, patch) {
      assert.equal(state.leases.get(id), token, 'lost leases cannot write');
      for (const field of Object.keys(patch)) {
        const count = state.storeFailures.get(field) || 0;
        if (count) { state.storeFailures.set(field, count - 1); throw new Error('synthetic storage unavailable'); }
      }
      Object.assign(state.accounts.get(id), structuredClone(patch));
      if (patch.closed) state.effects.closes++;
      await hook('saved', { id, patch });
    },
    async release(id, token) { if (state.leases.get(id) === token) state.leases.delete(id); },
    async recordEvent(id, type, created) {
      if (state.failEvents) throw new Error('synthetic storage unavailable');
      if (!state.events.has(id)) { state.events.set(id, { id, type, created }); state.effects.events++; }
    },
  };
  function response(data) { return Response.json(data, { headers: { 'request-id': 'req_synthetic' } }); }
  const transport = async (url, init) => {
    const target = new URL(String(url));
    assert.equal(target.origin, 'https://api.stripe.com', 'SDK transport must target only the intended Stripe API');
    assert.notEqual(init.redirect, 'follow'); // This fixture intercepts the SDK before any actual network.
    const method = init.method || 'GET';
    const params = new URLSearchParams(method === 'GET' ? target.search : String(init.body || ''));
    const path = target.pathname;
    const key = new Headers(init.headers).get('idempotency-key');
    const request = { path, method, params: Object.fromEntries(params), key };
    state.requests.push(request);
    await hook('beforeRequest', request);
    const saved = key && state.idem.get(`${path}:${key}`);
    if (saved) {
      assert.deepEqual(request.params, saved.params, 'uncertain retries must preserve all parameters');
      return response(saved.data);
    }
    let data;
    if (method === 'GET' && path === `/v1/prices/${config.priceId}`) data = price;
    else if (method === 'POST' && path === '/v1/customers') {
      const id = `cus_synthetic${++state.effects.customers}`;
      data = { id, object: 'customer', livemode: false, metadata: { orderly_user_id: params.get('metadata[orderly_user_id]') } };
      state.customers.set(id, data);
    } else if (method === 'GET' && path.startsWith('/v1/customers/')) {
      data = state.customers.get(path.split('/').at(-1));
      assert.ok(data, 'only synthetic owned customers may be retrieved');
    } else if (method === 'GET' && path === '/v1/subscriptions') {
      assert.equal(params.get('status'), 'all'); assert.equal(params.get('expand[0]'), 'data.latest_invoice');
      data = { object: 'list', data: state.subscriptions.filter(sub => sub.customer === params.get('customer')), has_more: false, url: path };
      await hook('subscriptionSnapshot', data);
    } else if (method === 'POST' && path === '/v1/billing_portal/sessions') {
      state.effects.portals++; data = { id: 'bps_synthetic', url: 'https://billing.stripe.com/synthetic' };
    } else if (method === 'POST' && path === '/v1/checkout/sessions') {
      const id = `cs_synthetic${++state.effects.checkouts}`;
      data = { id, object: 'checkout.session', status: 'open', mode: 'subscription', customer: params.get('customer'),
        livemode: false, metadata: { orderly_trial_days: params.get('metadata[orderly_trial_days]') }, url: `https://checkout.stripe.com/${id}` };
      state.sessions.set(id, data);
    } else if (method === 'GET' && path === '/v1/checkout/sessions') {
      data = { object: 'list', data: [...state.sessions.values()].filter(session => session.customer === params.get('customer') && session.status === params.get('status')), has_more: false, url: path };
    } else if (method === 'POST' && /^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(path)) {
      data = state.sessions.get(path.split('/').at(-2)); assert.ok(data);
      await hook('beforeExpire', data);
      if (data.status === 'complete') return Response.json({ error: { type: 'invalid_request_error', message: 'Synthetic completed checkout' } }, { status: 400 });
      data.status = 'expired'; state.effects.expirations++;
    } else if (method === 'GET' && /^\/v1\/checkout\/sessions\/[^/]+\/line_items$/.test(path)) {
      assert.ok(state.sessions.has(path.split('/').at(-2)));
      data = { object: 'list', data: [{ id: 'li_synthetic', price, quantity: 1 }], has_more: false, url: path };
    } else if (method === 'GET' && path.startsWith('/v1/checkout/sessions/')) {
      data = state.sessions.get(path.split('/').at(-1)); assert.ok(data);
    } else throw new Error(`Unexpected synthetic transport path: ${method} ${path}`);
    if (key) state.idem.set(`${path}:${key}`, { params: structuredClone(request.params), data: structuredClone(data) });
    await hook('afterEffect', { request, data });
    return response(data);
  };
  const stripe = new Stripe('sk_test_synthetic', { maxNetworkRetries: 0, httpClient: Stripe.createFetchHttpClient(transport) });
  const service = createBillingService(stripe, store, { ...config, newTrialDays: 7, ...options });
  function seedAccount(userId, subscriptions = []) {
    const account = newAccount(userId); account.customer_id = `cus_seed${state.customers.size}`;
    state.accounts.set(userId, account); state.customers.set(account.customer_id, { id: account.customer_id, livemode: false });
    state.subscriptions.push(...subscriptions.map(sub => ({ ...sub, customer: account.customer_id })));
    return account;
  }
  function routes(user = { id: users[0] }, routeOptions = {}) {
    const cache = new Map();
    const stubs = { 'server-only': {},
      '@/lib/supabase/server': { async createSupabaseServerClient() { return { auth: { async getUser() {
        return { data: { user }, error: routeOptions.authError || null };
      } } }; } },
      '@/lib/security/rate-limit-server': { async enforceRateLimit(id, policy) {
        state.rateCalls.push({ id, scope: policy.scope }); return routeOptions.limited ? Response.json({ error: 'Slow down' }, { status: 429 }) : null;
      } },
      '@/lib/billing/server': { async billingServer() { return { service, store, stripe, config }; }, billingStore() { return store; } },
    };
    function load(file) {
      if (cache.has(file)) return cache.get(file).exports;
      const loadedModule = { exports: {} }; cache.set(file, loadedModule);
      const source = ts.transpileModule(withTestOwner(readFileSync(file, 'utf8')), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      new Function('require', 'module', 'exports', source)(specifier => {
        if (specifier in stubs) return stubs[specifier];
        if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
        const target = specifier.startsWith('@/') ? resolve(specifier.slice(2)) : resolve(dirname(file), specifier);
        return load(target.endsWith('.ts') ? target : target + '.ts');
      }, loadedModule, loadedModule.exports);
      return loadedModule.exports;
    }
    return name => load(resolve(`app/api/billing/${name}/route.ts`));
  }
  return { state, store, stripe, service, routes, seedAccount, transport };
}

export async function configured(run) {
  const values = { NODE_ENV: 'test', VERCEL_ENV: 'preview', AI_SUBSCRIPTION_REQUIRED: 'true', STRIPE_BILLING_ENABLED: 'true',
    STRIPE_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_synthetic', STRIPE_WEBHOOK_SECRET: 'whsec_synthetic_only',
    STRIPE_ACCOUNT_ID: config.accountId, STRIPE_AI_PRICE_ID: config.priceId, STRIPE_APP_ORIGIN: config.origin };
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const [key, value] of Object.entries(before)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } }
}
export function request(name, payload = {}, extra = {}) {
  return new Request(`${config.origin}/api/billing/${name}`, { method: 'POST',
    headers: { origin: config.origin, 'content-type': 'application/json', ...extra }, body: JSON.stringify(payload) });
}
