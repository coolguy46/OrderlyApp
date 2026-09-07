import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { readFile } from 'node:fs/promises';
import {
  clearCurrentProjectAuthStorage,
  signOutWithLocalFallback,
  supabaseAuthStorageKey,
  withLogoutTransportDeadline,
} from '../lib/auth/logout-safety.ts';

const project = 'https://logout-fixture.supabase.co';
const key = supabaseAuthStorageKey(project);
const fixtureUser = {
  id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
  app_metadata: {}, user_metadata: { padding: 'x'.repeat(5000) }, created_at: new Date().toISOString(),
};
const token = () => [
  { alg: 'HS256', typ: 'JWT' },
  { sub: fixtureUser.id, exp: Math.floor(Date.now() / 1000) + 3600 },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.fixture';

function browserStorage() {
  const cookies = new Map([['unrelated-preference', 'keep'], ['sb-other-auth-token', 'keep-other-project']]);
  const mapStorage = () => {
    const values = new Map([[key, 'legacy-auth'], ['unrelated', 'keep']]);
    return { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
      removeItem: name => values.delete(name), values };
  };
  const document = {
    get cookie() { return [...cookies].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; '); },
    set cookie(serialized) {
      const [pair] = serialized.split(';');
      const [parsed] = parseCookieHeader(pair);
      if (/max-age=0/i.test(serialized)) cookies.delete(parsed.name);
      else cookies.set(parsed.name, parsed.value);
    },
  };
  return { document, localStorage: mapStorage(), sessionStorage: mapStorage(), cookies };
}

function clientFor(browser, fetcher) {
  return createBrowserClient(project, 'fixture-public-key', {
    isSingleton: false,
    cookies: {
      getAll: () => parseCookieHeader(browser.document.cookie).map(({ name, value }) => ({ name, value: value ?? '' })),
      setAll: values => values.forEach(({ name, value, options }) => { browser.document.cookie = serializeCookieHeader(name, value, options); }),
    },
    auth: { autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withLogoutTransportDeadline(fetcher, project, 15) },
  });
}

async function signedInFixture(logout) {
  const browser = browserStorage();
  const fetcher = async (input, init) => {
    const url = new URL(input.toString());
    if (url.pathname === '/auth/v1/user') return Response.json({ user: fixtureUser });
    if (url.pathname === '/auth/v1/logout') return logout(input, init);
    throw new Error(`Unexpected fixture request ${url.pathname}`);
  };
  const client = clientFor(browser, fetcher);
  const { error } = await client.auth.setSession({ access_token: token(), refresh_token: 'fixture-refresh-token' });
  assert.equal(error, null);
  assert.ok([...browser.cookies.keys()].filter(name => name.startsWith(`${key}.`)).length >= 2,
    'exercise real SDK cookie chunking rather than a fake localStorage-only session');
  return { browser, client };
}

function assertLocalCredentialsGone(browser) {
  assert.equal([...browser.cookies.keys()].some(name => name === key || name.startsWith(`${key}.`) || name.startsWith(`${key}-`)), false);
  assert.equal(browser.cookies.get('sb-other-auth-token'), 'keep-other-project');
  assert.equal(browser.cookies.get('unrelated-preference'), 'keep');
}

test('successful SDK logout removes its actual chunked cookies without a forced reload', async () => {
  const { browser, client } = await signedInFixture(async () => new Response(null, { status: 204 }));
  const result = await signOutWithLocalFallback(client.auth, () => clearCurrentProjectAuthStorage(project, browser));
  assert.deepEqual(result, { remoteConfirmed: true, requiresReload: false });
  assertLocalCredentialsGone(browser);
  assert.equal((await client.auth.getSession()).data.session, null);
  await client.auth.dispose();
});

test('offline SDK logout clears cookies and legacy local credentials without claiming remote revocation', async () => {
  const { browser, client } = await signedInFixture(async () => { throw new TypeError('Network unavailable'); });
  browser.cookies.set(`${key}-code-verifier`, 'fixture-pkce');
  const result = await signOutWithLocalFallback(client.auth, () => clearCurrentProjectAuthStorage(project, browser));
  assert.deepEqual(result, { remoteConfirmed: false, requiresReload: true });
  assertLocalCredentialsGone(browser);
  assert.equal(browser.localStorage.values.has(key), false);
  assert.equal(browser.sessionStorage.values.has(key), false);
  const reloaded = clientFor(browser, async () => { throw new Error('No network expected for a signed-out reload'); });
  assert.equal((await reloaded.auth.getSession()).data.session, null);
  await client.auth.dispose();
  await reloaded.auth.dispose();
});

test('a hanging logout transport is aborted before returning and SDK cookies are cleared', async () => {
  let requestSignal;
  let releaseNetwork;
  const { browser, client } = await signedInFixture(async (_input, init) => {
    requestSignal = init.signal;
    return new Promise(resolve => { releaseNetwork = resolve; });
  });
  const result = await signOutWithLocalFallback(client.auth, () => clearCurrentProjectAuthStorage(project, browser), 1000);
  assert.equal(result.remoteConfirmed, false);
  assert.equal(result.requiresReload, true);
  assert.equal(requestSignal.aborted, true);
  assertLocalCredentialsGone(browser);
  releaseNetwork(new Response(null, { status: 204 }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal((await client.auth.getSession()).data.session, null);
  await client.auth.dispose();
});

test('outer SDK timeout still clears actual SSR cookies when no HTTP logout is reached', async () => {
  const { browser, client } = await signedInFixture(async () => new Response(null, { status: 204 }));
  const result = await signOutWithLocalFallback(
    { signOut: () => new Promise(() => {}) },
    () => clearCurrentProjectAuthStorage(project, browser),
    15,
  );
  assert.deepEqual(result, { remoteConfirmed: false, requiresReload: true });
  assertLocalCredentialsGone(browser);
  assert.equal((await client.auth.getSession()).data.session, null);
  await client.auth.dispose();
});

test('local cleanup failure cannot be reported as successful sign-out', async () => {
  await assert.rejects(signOutWithLocalFallback(
    { signOut: async () => ({ error: new Error('offline') }) },
    async () => { throw new Error('cookie cleanup failed'); },
  ), /cookie cleanup failed/);
});

test('transport deadline does not intercept unrelated providers or ordinary data requests', async () => {
  let calls = 0;
  const fetcher = withLogoutTransportDeadline(async (_input, init) => {
    calls += 1;
    assert.equal(init?.signal, undefined);
    return new Response(null, { status: 204 });
  }, project);
  await fetcher('https://other.supabase.co/auth/v1/logout', { method: 'POST' });
  await fetcher(`${project}/rest/v1/tasks`, { method: 'GET' });
  assert.equal(calls, 2);
});

test('fallback clears application state before forcing a full document replacement', async () => {
  const source = await readFile(new URL('../lib/store.ts', import.meta.url), 'utf8');
  const start = source.indexOf('logout: async () =>');
  const logout = source.slice(start, source.indexOf('// Theme actions', start));
  assert.match(logout, /await db\.signOut\(\)/);
  assert.doesNotMatch(logout, /withTimeout\(db\.signOut/);
  assert.ok(logout.indexOf('clearAuthenticatedState()') < logout.indexOf("window.location.replace('/auth/login?localSignOut=1')"));
});
