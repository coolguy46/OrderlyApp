import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function source(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('auth events never await profile or full-data hydration', async () => {
  const store = await source('lib/store.ts');

  assert.doesNotMatch(store, /onAuthStateChange\s*\(\s*async/);
  assert.doesNotMatch(store, /dataLoadQueue/);
  assert.doesNotMatch(store, /new Promise\s*\(\s*resolve\s*=>\s*setTimeout/);

  const startupLoad = store.slice(
    store.indexOf('loadUserData: async'),
    store.indexOf('// Refresh data from database'),
  );
  assert.doesNotMatch(startupLoad, /getFriends/);
  assert.match(startupLoad, /Promise\.allSettled/);
});

test('registration handles email confirmation without pretending to be signed in', async () => {
  const registerPage = await source('app/auth/register/page.tsx');

  assert.match(registerPage, /confirmation-required/);
  assert.doesNotMatch(registerPage, /thousands of students/i);
  assert.doesNotMatch(registerPage, /pomodoro timer with gamification/i);
  assert.doesNotMatch(registerPage, /social study competitions/i);
});

test('Proxy refreshes only protected app pages', async () => {
  const proxy = await source('proxy.ts');

  assert.match(proxy, /supabase\.auth\.getClaims\(\)/);
  assert.match(proxy, /'\/tasks\/:path\*'/);
  assert.doesNotMatch(proxy, /'\/auth\/:path\*'/);
  assert.doesNotMatch(proxy, /'\/api\/:path\*'/);
  assert.doesNotMatch(proxy, /'\/landing\/:path\*'/);
});

test('Google OAuth no longer forces a consent prompt on every login', async () => {
  const services = await source('lib/supabase/services.ts');
  const googleSignIn = services.slice(services.indexOf('export async function signInWithGoogle'));

  assert.doesNotMatch(googleSignIn, /prompt\s*:\s*['"]consent['"]/);
  assert.doesNotMatch(googleSignIn, /access_type\s*:\s*['"]offline['"]/);
});
