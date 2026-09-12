import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');
const email = 'preview-owner@example.invalid';
const digest = createHash('sha256').update(email).digest('hex');
const owner = { id: 'verified-owner', email, email_confirmed_at: '2026-01-01T00:00:00Z', identities: [
  { provider: 'google', identity_data: { email, email_verified: true } },
] };

function fixture(user = owner, failed = false) {
  const cache = new Map();
  const stubs = {
    'server-only': {},
    '@/lib/supabase/server': { createSupabaseServerClient: async () => {
      if (failed) throw new Error('private authentication internals');
      return { auth: { getUser: async () => ({ data: { user }, error: null }) } };
    } },
  };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    // Substitute only the approved identity fingerprint in this isolated fixture.
    // No real user's email is stored in test code or sent to an external service.
    const input = readFileSync(file, 'utf8').replace(/const OWNER_EMAIL_HASH = '[a-f0-9]{64}'/, `const OWNER_EMAIL_HASH = '${digest}'`);
    const source = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', source)(id => {
      if (id in stubs) return stubs[id];
      if (!id.startsWith('.') && !id.startsWith('@/')) return require(id);
      const target = id.startsWith('@/') ? resolve(root, id.slice(2)) : resolve(dirname(file), id);
      return load(target + '.ts');
    }, mod, mod.exports);
    return mod.exports;
  }
  return name => load(resolve(root, name));
}
const route = 'app/api/billing/preview/route.ts';
const checkout = 'app/api/billing/preview/checkout/route.ts';
const req = (kind = 'trial', origin = 'https://www.myorderlyapp.com') => new Request(`https://www.myorderlyapp.com/api/billing/preview/checkout?kind=${kind}`, {
  method: 'POST', headers: { origin, cookie: 'fixture' },
  body: JSON.stringify({ user: 'verified-owner', url: 'https://attacker.invalid', livemode: true, price: 'price_fake' }),
});

test('preview checks verified primary email AND matching verified Google identity', () => {
  const { isBillingPreviewOwner: allowed } = fixture()('lib/billing/preview-access.ts');
  assert.equal(allowed(owner), true);
  assert.equal(allowed({ ...owner, email: ` ${email.toUpperCase()} ` }), true);
  for (const user of [null, { ...owner, id: '' }, { ...owner, email_confirmed_at: null },
    { ...owner, email: 'other@example.invalid' }, { ...owner, identities: [] },
    { ...owner, identities: [{ provider: 'email', identity_data: { email, email_verified: true } }] },
    { ...owner, identities: [{ provider: 'google', identity_data: { email, email_verified: false } }] },
    { ...owner, identities: [{ provider: 'google', identity_data: { email: 'other@example.invalid', email_verified: true } }] },
    { id: 'attacker', email: 'other@example.invalid', user_metadata: { email, email_verified: true, provider: 'google', admin: true } },
  ]) assert.equal(allowed(user), false);
});
test('owner-only GET returns minimal uncached eligibility even while real billing is disabled', async () => {
  const response = await fixture()(route).GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { allowed: true, userId: owner.id });
  assert.match(response.headers.get('cache-control'), /private, no-store/);
});
test('both preview routes deny signed-out, other and unverified users', async () => {
  for (const [user, status] of [[null, 401], [{ ...owner, email: 'other@example.invalid' }, 403], [{ ...owner, identities: [] }, 403]]) {
    const load = fixture(user);
    assert.equal((await load(route).GET()).status, status);
    assert.equal((await load(checkout).POST(req())).status, status);
  }
});
test('preview failures hide authentication details', async () => {
  for (const response of [await fixture(owner, true)(route).GET(), await fixture(owner, true)(checkout).POST(req())]) {
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private authentication/);
  }
});
test('preview checkout refuses cross-origin requests and invalid kinds', async () => {
  const { POST } = fixture()(checkout);
  assert.equal((await POST(req('trial', 'https://attacker.invalid'))).status, 403);
  for (const value of ['live', '__proto__', 'constructor', '', 'https://attacker.invalid']) assert.equal((await POST(req(value))).status, 400);
});
test('owner checkout only returns fixed test-mode links, ignoring forged body fields', async () => {
  const { POST } = fixture()(checkout);
  const urls = [];
  for (const kind of ['trial', 'subscription']) {
    const response = await POST(req(kind)); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.sandbox, true);
    assert.match(result.url, /^https:\/\/buy\.stripe\.com\/test_[A-Za-z0-9]+$/); urls.push(result.url);
  }
  assert.notEqual(urls[0], urls[1]);
});
test('synthetic screen states stay local and cover billing lifecycle', () => {
  const { previewScenarios, previewScenario } = fixture()('lib/billing/preview-scenarios.ts');
  assert.equal(Object.keys(previewScenarios).length, 12);
  for (const key of Object.keys(previewScenarios)) {
    const sample = previewScenario(key, 0);
    assert.equal(sample.status?.aiAccess === true, ['trial', 'trialCanceled', 'paid', 'paidCanceled'].includes(key));
  }
  assert.equal(previewScenario('expired', 0).status.trialEligible, false);
  assert.equal(previewScenario('pastDue', 0).status.canManage, true);
});
test('preview never imports production billing service or grants server AI access', () => {
  for (const file of ['lib/billing/preview-access.ts', 'lib/billing/preview-checkout.ts', 'app/api/billing/preview/checkout/route.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /from ['"]stripe['"]|billingServer\(|\.from\(|\.rpc\(/);
  }
  assert.doesNotMatch(readFileSync('lib/billing/server.ts', 'utf8'), /preview|OWNER_EMAIL_HASH/);
  assert.doesNotMatch(readFileSync('components/billing/BillingPreviewControl.tsx', 'utf8'), /useBilling\(|\/api\/billing\/\$|\/api\/assistant|setState\(/);
});
