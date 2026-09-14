import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeadlineFetch } from '../lib/security/server-fetch.ts';

test('server requests preserve parameters but refuse credential-bearing redirects', async () => {
  let seen;
  const fetcher = createDeadlineFetch(undefined, 1000, async (input, init) => {
    seen = { input, init }; return new Response('{}');
  });
  await fetcher('https://example.invalid', { method: 'POST', headers: { authorization: 'synthetic' }, body: '{}', redirect: 'follow' });
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers.authorization, 'synthetic');
  assert.equal(seen.init.body, '{}');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('expired end-to-end deadlines and either caller abort prevent network dispatch', async () => {
  let calls = 0;
  const transport = async () => { calls++; return new Response('{}'); };
  await assert.rejects(createDeadlineFetch(Date.now() - 1, 1000, transport)('https://example.invalid'), /deadline/);
  const c = new AbortController(); c.abort();
  const f = createDeadlineFetch(undefined, 1000, transport);
  await assert.rejects(f(new Request('https://example.invalid', { signal: c.signal })));
  await assert.rejects(f('https://example.invalid', { signal: c.signal }));
  assert.equal(calls, 0);
});

test('a stalled server fetch is interrupted rather than occupying its entire function budget', async () => {
  let signal;
  const f = createDeadlineFetch(undefined, 20, async (_input, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('synthetic-aborted')), { once: true });
    });
  });
  // AbortSignal.timeout uses unref timers, so keep this isolated test alive.
  const timer = setTimeout(() => {}, 1000);
  try { await assert.rejects(f('https://example.invalid'), /synthetic-aborted/); }
  finally { clearTimeout(timer); }
  assert.equal(signal.aborted, true);
});
