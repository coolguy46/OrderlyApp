import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
import { checkRateLimit, rateLimitResponse, RATE_LIMIT_POLICIES } from '../lib/security/rate-limit.ts';

const first = '10000000-0000-4000-8000-000000000001';
const second = '10000000-0000-4000-8000-000000000002';
const db = new PGlite();
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;`);
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [first, second]);
  const migration = await readFile(new URL('../lib/supabase/security-rate-limit-migration.sql', import.meta.url), 'utf8');
  await db.exec(migration); await db.exec(migration);
});
after(() => db.close());

async function asRole(role, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role};`);
  try { return await db.query(sql, params); }
  finally { await db.exec('ROLLBACK'); }
}
const consume = async (id, scope = 'billing_status', max = 3, window = 3600) =>
  (await db.query('SELECT consume_security_rate_limit($1,$2,$3,$4) AS value', [id, scope, max, window])).rows[0].value;

test('browser roles cannot read, reset, forge identity or bypass shared counters through direct RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const sql of ['SELECT * FROM security_rate_limits', 'DELETE FROM security_rate_limits',
      'UPDATE security_rate_limits SET tokens=10000',
      `INSERT INTO security_rate_limits VALUES ('${first}','forged',10000,now())`,
      `SELECT consume_security_rate_limit('${first}','billing_status',10000,1)`,
      `SELECT consume_security_rate_limit('${second}','billing_status',10000,1)`]) {
      await assert.rejects(asRole(role, sql), error => error.code === '42501');
    }
  }
  assert.equal((await asRole('service_role', 'SELECT consume_security_rate_limit($1,$2,$3,$4) AS value', [first, 'backend', 1, 60])).rows[0].value.allowed, true);
});

test('simultaneous burst requests consume a fixed shared bucket, with independent users and operations', async () => {
  const decisions = await Promise.all(Array.from({ length: 50 }, () => consume(first)));
  assert.equal(decisions.filter(item => item.allowed).length, 3);
  assert.ok(decisions.filter(item => !item.allowed).every(item => item.retry_after > 0));
  assert.equal((await consume(second)).allowed, true);
  assert.equal((await consume(first, 'billing_portal')).allowed, true);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM security_rate_limits WHERE user_id=$1 AND scope=$2', [first, 'billing_status'])).rows[0].n, 1);
});

test('repeated denials do not grow storage or postpone refill; elapsed time restores access', async () => {
  const before = (await db.query('SELECT updated_at,tokens FROM security_rate_limits WHERE user_id=$1 AND scope=$2', [first, 'billing_status'])).rows[0];
  for (let i = 0; i < 20; i++) assert.equal((await consume(first)).allowed, false);
  const after = (await db.query('SELECT updated_at,tokens FROM security_rate_limits WHERE user_id=$1 AND scope=$2', [first, 'billing_status'])).rows[0];
  assert.deepEqual(after, before);
  await db.query("UPDATE security_rate_limits SET updated_at=now()-interval '2 hours' WHERE user_id=$1", [first]);
  assert.equal((await consume(first)).allowed, true);
});

test('SQL rejects malformed policies, missing accounts, and caps unexpected scope growth', async () => {
  for (const [scope, max, seconds] of [['bad scope', 1, 60], ['a'.repeat(49), 1, 60], ['valid', 0, 60],
    ['valid', 10001, 60], ['valid', 1, 0], ['valid', 1, 86401], [null, 1, 60], ['valid', null, 60]]) {
    await assert.rejects(consume(first, scope, max, seconds), error => error.code === '22023');
  }
  await assert.rejects(consume('10000000-0000-4000-8000-000000000009'), error => error.code === '23503');
  for (let i = 0; i < 31; i++) await consume(second, `scope_${i}`);
  await assert.rejects(consume(second, 'scope_overflow'), error => error.code === '54000');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM security_rate_limits WHERE user_id=$1', [second])).rows[0].n, 32);
});

test('deleting a synthetic account removes its counters without affecting the other account', async () => {
  await db.query('DELETE FROM auth.users WHERE id=$1', [second]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM security_rate_limits WHERE user_id=$1', [second])).rows[0].n, 0);
  assert.ok((await db.query('SELECT count(*)::int AS n FROM security_rate_limits WHERE user_id=$1', [first])).rows[0].n > 0);
});

test('RPC results and identity/policies are strictly checked, fail closed and never leak private errors', async () => {
  const policy = RATE_LIMIT_POLICIES.billingCheckout;
  let calls = 0;
  const client = data => ({ rpc(name, args) {
    calls++; assert.equal(name, 'consume_security_rate_limit'); assert.equal(args.p_user_id, first);
    assert.equal(args.p_scope, policy.scope); return Promise.resolve({ data, error: null });
  } });
  const allowed = await checkRateLimit(client({ allowed: true, retry_after: 0 }), first, policy);
  assert.equal(rateLimitResponse(allowed), null);
  const limited = rateLimitResponse(await checkRateLimit(client({ allowed: false, retry_after: 10 }), first, policy));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '10');
  assert.match(limited.headers.get('Cache-Control'), /private, no-store/);
  for (const data of [null, {}, [], { allowed: 'true', retry_after: 0 }, { allowed: true, retry_after: 5 },
    { allowed: false, retry_after: 0 }, { allowed: false, retry_after: 1000 }, { allowed: false, retry_after: 1.5 }]) {
    assert.equal(rateLimitResponse(await checkRateLimit(client(data), first, policy)).status, 503);
  }
  const throwing = { rpc: () => { throw new Error('private key and raw database error'); } };
  const response = rateLimitResponse(await checkRateLimit(throwing, first, policy));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /private key|database error/);
  const prior = calls;
  for (const userId of ['', 'attacker', "';DROP TABLE users", null]) {
    assert.equal((await checkRateLimit(client({ allowed: true, retry_after: 0 }), userId, policy)).allowed, false);
  }
  for (const patch of [{ scope: '../forged' }, { maxRequests: NaN }, { windowSeconds: 0 }]) {
    assert.equal((await checkRateLimit(client({ allowed: true, retry_after: 0 }), first, { ...policy, ...patch })).allowed, false);
  }
  assert.equal(calls, prior);
  assert.equal((await checkRateLimit(null, first, policy)).unavailable, true);
});

test('stalled limiter storage has a bounded wait and cannot authorize an action', async () => {
  const result = await checkRateLimit({ rpc: () => new Promise(() => {}) }, first, RATE_LIMIT_POLICIES.billingStatus, 5);
  assert.equal(result.unavailable, true); assert.equal(result.allowed, false);
});

test('production limiter uses a private no-session client, preserves aborts and denies missing configuration', async () => {
  const ts = createRequire(import.meta.url)('typescript');
  const source = await readFile(new URL('../lib/security/rate-limit-server.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let options, creations = 0;
  const loaded = { exports: {} };
  const stubs = {
    'server-only': {},
    './rate-limit': { checkRateLimit, rateLimitResponse },
    '@supabase/supabase-js': { createClient(url, key, config) {
      creations++; options = config;
      assert.equal(url, 'https://fixture.invalid'); assert.equal(key, 'fixture-service-role');
      return { rpc: async () => ({ data: { allowed: true, retry_after: 0 }, error: null }) };
    } },
  };
  new Function('require', 'module', 'exports', output)(name => {
    assert.ok(name in stubs, `Unexpected external module: ${name}`); return stubs[name];
  }, loaded, loaded.exports);
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalFetch = globalThis.fetch;
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal((await loaded.exports.enforceRateLimit(first, RATE_LIMIT_POLICIES.billingStatus)).status, 503);
    assert.equal(creations, 0);
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-service-role';
    assert.equal(await loaded.exports.enforceRateLimit(first, RATE_LIMIT_POLICIES.billingStatus), null);
    assert.deepEqual(options.auth, { persistSession: false, autoRefreshToken: false });
    let signal, redirect, fetches = 0;
    globalThis.fetch = async (_, init) => { fetches++; signal = init.signal; redirect = init.redirect; return new Response('{}'); };
    const cancel = new AbortController();
    await options.global.fetch('https://fixture.invalid/rest/v1/rpc/consume_security_rate_limit', { signal: cancel.signal });
    cancel.abort(); assert.equal(signal.aborted, true);
    assert.equal(redirect, 'error');
    for (const abortRequest of [true, false]) {
      const requestCancel = new AbortController(), initCancel = new AbortController();
      await options.global.fetch(new Request('https://fixture.invalid/rest/v1/rpc/consume_security_rate_limit',
        { signal: requestCancel.signal, redirect: 'follow' }), { signal: initCancel.signal, redirect: 'follow' });
      assert.equal(redirect, 'error');
      (abortRequest ? requestCancel : initCancel).abort(); assert.equal(signal.aborted, true);
    }
    const beforeAbort = fetches;
    for (const abortRequest of [true, false]) {
      const requestCancel = new AbortController(), initCancel = new AbortController();
      (abortRequest ? requestCancel : initCancel).abort();
      assert.throws(() => options.global.fetch(new Request('https://fixture.invalid/rest/v1/rpc/consume_security_rate_limit',
        { signal: requestCancel.signal }), { signal: initCancel.signal }), error => error.name === 'AbortError');
    }
    assert.equal(fetches, beforeAbort);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
