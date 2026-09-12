import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import Stripe from 'stripe';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');

function fixture({ user = { id: 'owner' }, failed = false } = {}) {
  const calls = [];
  const stubs = {
    'server-only': {},
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user }, error: null }) } }) },
    '@/lib/billing/server': { billingServer: async () => {
      calls.push(['server']);
      if (failed) throw new Error('private Stripe error with sensitive details');
      return { service: {
        async checkout(id) { calls.push(['checkout', id]); return { url: 'https://checkout.stripe.com/test' }; },
        async portal(id) { calls.push(['portal', id]); return { url: 'https://billing.stripe.com/test' }; },
        async status(id) { calls.push(['status', id]); return { enabled: true, aiAccess: false }; },
      }, store: { async recordEvent(...args) { calls.push(['event', ...args]); } } };
    } },
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} }; cache.set(file, loadedModule);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', source)(specifier => {
      if (specifier in stubs) return stubs[specifier];
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return require(specifier);
      const target = specifier.startsWith('@/') ? resolve(root, specifier.slice(2)) : resolve(dirname(file), specifier);
      return load(target.endsWith('.ts') ? target : target + '.ts');
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { calls, route: name => load(resolve(root, `app/api/billing/${name}/route.ts`)) };
}

async function configured(fn) {
  const values = { STRIPE_BILLING_ENABLED: 'true', STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture', STRIPE_AI_PRICE_ID: 'price_fixture', STRIPE_ACCOUNT_ID: 'acct_fixture', STRIPE_APP_ORIGIN: 'http://localhost:3000', VERCEL_ENV: 'preview' };
  const prior = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  Object.assign(process.env, values);
  try { await fn(); } finally { for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}
const request = (name, origin = 'http://localhost:3000') => new Request(`http://localhost:3000/api/billing/${name}`, { method: 'POST', headers: { origin, cookie: 'fixture-only', 'content-type': 'application/json' }, body: JSON.stringify({ user_id: 'attacker', customer: 'cus_other', price: 'price_free', return_url: 'https://attacker.invalid' }) });

test('real checkout/portal handlers refuse signed-out and cross-site requests before Stripe access', async () => configured(async () => {
  for (const name of ['checkout', 'portal']) {
    const signedOut = fixture({ user: null }); assert.equal((await signedOut.route(name).POST(request(name))).status, 401); assert.deepEqual(signedOut.calls, []);
    const otherOrigin = fixture(); assert.equal((await otherOrigin.route(name).POST(request(name, 'https://attacker.invalid'))).status, 403); assert.deepEqual(otherOrigin.calls, []);
  }
}));

test('real checkout/portal handlers use authenticated owner and never accept body overrides', async () => configured(async () => {
  for (const name of ['checkout', 'portal']) {
    const f = fixture(); const response = await f.route(name).POST(request(name));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(f.calls, [['server'], [name, 'owner']]);
  }
}));

test('wrong configured return origin is denied, and upstream failure exposes no sensitive error', async () => configured(async () => {
  const f = fixture(); process.env.STRIPE_APP_ORIGIN = 'https://preview.example';
  assert.equal((await f.route('checkout').POST(request('checkout'))).status, 403); assert.deepEqual(f.calls, []);
  process.env.STRIPE_APP_ORIGIN = 'http://localhost:3000';
  const failed = fixture({ failed: true }); const response = await failed.route('checkout').POST(request('checkout'));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private|sensitive/);
}));

test('success query does not affect the real status handler', async () => configured(async () => {
  const f = fixture(); const response = await f.route('status').GET(new Request('http://localhost:3000/api/billing/status?checkout=success&user_id=attacker'));
  assert.equal((await response.json()).aiAccess, false); assert.deepEqual(f.calls, [['server'], ['status', 'owner']]);
}));

test('real webhook handler rejects forgery before database access; signed events persist, failed saves return 503', async () => configured(async () => {
  const sdk = new Stripe('sk_test_fixture');
  const payload = JSON.stringify({ id: 'evt_fixture', object: 'event', type: 'invoice.paid', livemode: false, created: 123, data: { object: {} } });
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const req = header => new Request('http://localhost:3000/api/billing/webhook', { method: 'POST', body: payload, headers: header ? { 'stripe-signature': header } : {} });
  const f = fixture(); assert.equal((await f.route('webhook').POST(req())).status, 400);
  assert.equal((await f.route('webhook').POST(req('bad-signature'))).status, 400); assert.deepEqual(f.calls, []);
  assert.equal((await f.route('webhook').POST(req(signature))).status, 200);
  assert.deepEqual(f.calls[1], ['event', 'evt_fixture', 'invoice.paid', 123]);
  assert.equal((await fixture({ failed: true }).route('webhook').POST(req(signature))).status, 503);
}));
