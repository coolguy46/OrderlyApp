import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');
function loadRoute(user, claims) {
  const calls = [];
  const admin = { from(table) {
    calls.push(['table', table]);
    return {
      async upsert(value) { calls.push(['enqueue', value]); return { error: null }; },
      select() { return { eq(field, value) {
        calls.push(['filter', field, value]);
        return { async maybeSingle() { return { data: { status: 'queued' } }; } };
      } }; },
    };
  } };
  const stubs = {
    'server-only': {},
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ auth: {
      getUser: async () => ({ data: { user }, error: null }),
      getClaims: async () => ({ data: { claims }, error: null }),
    } }) },
    '@supabase/supabase-js': { createClient() { calls.push(['admin']); return admin; } },
    '@/lib/account-deletion': {
      async claimAccountDeletionRequests(_admin, count, id) { calls.push(['claim', count, id]); return []; },
      async processAccountDeletionRequest() { assert.fail('must not delete real users'); },
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const loadedModule = { exports: {} }; cache.set(path, loadedModule);
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', output)((specifier) => {
      if (stubs[specifier]) return stubs[specifier];
      if (specifier.startsWith('@/')) return load(resolve(root, specifier.slice(2) + '.ts'));
      if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier.endsWith('.ts') ? specifier : specifier + '.ts'));
      return require(specifier);
    }, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { route: load(resolve(root, 'app/api/account/route.ts')), calls };
}
function request(origin = 'https://orderly.example', body) {
  return new Request('https://orderly.example/api/account', {
    method: 'DELETE', headers: { origin, cookie: 'fixture-only', 'content-type': 'application/json' }, body,
  });
}
test('real deletion route rejects anonymous and cross-origin callers before privileged operations', async () => {
  const { route, calls } = loadRoute(null, null);
  assert.equal((await route.DELETE(request())).status, 401);
  assert.equal((await route.DELETE(request('https://attacker.example'))).status, 403);
  assert.deepEqual(calls, []);
});
test('another device signing in does not authorize an old session to delete the account', async () => {
  const user = { id: 'owner-fixture', last_sign_in_at: new Date().toISOString() };
  const claims = { sub: user.id, amr: [{ method: 'password', timestamp: Date.now() / 1000 - 3600 }] };
  const { route, calls } = loadRoute(user, claims);
  assert.equal((await route.DELETE(request())).status, 403);
  assert.deepEqual(calls, []);
});
test('recent authenticated deletion enqueues only the verified owner, never a body user ID', async () => {
  const savedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-not-a-secret';
  try {
    const user = { id: 'owner-fixture' };
    const { route, calls } = loadRoute(user, { sub: user.id, amr: [{ method: 'oauth', timestamp: Math.floor(Date.now() / 1000) }] });
    const response = await route.DELETE(request(undefined, JSON.stringify({ user_id: 'other-fixture' })));
    assert.equal(response.status, 202);
    assert.deepEqual(calls.find(call => call[0] === 'enqueue'), ['enqueue', { user_id: user.id }]);
    assert.ok(!JSON.stringify(calls).includes('other-fixture'));
  } finally {
    if (savedUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }
});
