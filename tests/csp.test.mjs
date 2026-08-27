import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildContentSecurityPolicy,
  configuredSupabaseConnectSources,
} from '../lib/security/csp.ts';

test('allows the exact configured custom Supabase HTTP and websocket origins', () => {
  assert.deepEqual(
    configuredSupabaseConnectSources('https://database.example.edu/rest/v1'),
    ['https://database.example.edu', 'wss://database.example.edu'],
  );
});

test('supports loopback Supabase development without broadening production CSP', () => {
  assert.deepEqual(
    configuredSupabaseConnectSources('http://127.0.0.1:54321'),
    ['http://127.0.0.1:54321', 'ws://127.0.0.1:54321'],
  );
});

test('ignores malformed, credential-bearing, and non-http configuration', () => {
  assert.deepEqual(configuredSupabaseConnectSources('not a url'), []);
  assert.deepEqual(configuredSupabaseConnectSources('javascript:alert(1)'), []);
  assert.deepEqual(configuredSupabaseConnectSources('https://user:secret@example.com'), []);
});

test('production CSP uses nonce-only scripts and exact Supabase origins', () => {
  const policy = buildContentSecurityPolicy({
    nonce: 'test-nonce',
    nodeEnv: 'production',
    supabaseUrl: 'https://database.example.edu/rest/v1',
  });
  const scriptDirective = policy.split('; ').find((directive) => directive.startsWith('script-src '));
  assert.match(scriptDirective, /'nonce-test-nonce'/);
  assert.match(scriptDirective, /'strict-dynamic'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-inline'/);
  assert.doesNotMatch(scriptDirective, /'unsafe-eval'/);
  assert.match(policy, /connect-src 'self' https:\/\/database\.example\.edu wss:\/\/database\.example\.edu/);
  assert.doesNotMatch(policy, /\*\.supabase\.co/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test('development CSP permits eval only for the Next.js development runtime', () => {
  const policy = buildContentSecurityPolicy({
    nonce: 'dev-nonce',
    nodeEnv: 'development',
    supabaseUrl: undefined,
  });
  const scriptDirective = policy.split('; ').find((directive) => directive.startsWith('script-src '));
  assert.match(scriptDirective, /'unsafe-eval'/);
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});
