import assert from 'node:assert/strict';
import test from 'node:test';
import { billingFetch, createBillingStripe } from '../lib/billing/transport.ts';

test('billing request transport preserves caller abort and shares a bounded whole-operation deadline', async () => {
  const controller = new AbortController();
  let signal;
  const transport = billingFetch(Date.now() + 1000, async (_, init) => { signal = init.signal; return new Response('{}'); });
  await transport('https://api.stripe.com/v1/account', { signal: controller.signal });
  assert.equal(signal.aborted, false);
  controller.abort(); assert.equal(signal.aborted, true);
  let calls = 0;
  const expired = billingFetch(Date.now() - 1, () => { calls++; throw new Error('must not execute'); });
  assert.throws(() => expired('https://api.stripe.com/v1/account'), /Billing timed out/);
  assert.equal(calls, 0);
});

test('billing has explicit per-request timeout and limited retries, never Stripe defaults', () => {
  const stripe = createBillingStripe('sk_test_fixture_only');
  assert.equal(stripe.getApiField('timeout'), 12000);
  assert.equal(stripe.getApiField('maxNetworkRetries'), 1);
  assert.equal(stripe.getApiField('httpClient').getClientName(), 'fetch');
});

test('whole-operation deadline aborts a stalled underlying fetch instead of only abandoning its promise', async () => {
  // Keep the test process alive because native AbortSignal.timeout is unref'ed.
  const keepAlive = setTimeout(() => {}, 1000);
  let aborted = false;
  const transport = billingFetch(Date.now() + 100, async (_, init) => new Promise((_, reject) => {
    const stop = () => { aborted = true; reject(init.signal.reason); };
    if (init.signal.aborted) stop(); else init.signal.addEventListener('abort', stop, { once: true });
  }));
  try {
    await assert.rejects(transport('https://api.stripe.com/v1/account'), error => error.name === 'TimeoutError');
    assert.equal(aborted, true);
  } finally { clearTimeout(keepAlive); }
});

test('privileged Stripe transport rejects redirects and preserves Request and init cancellation independently', async () => {
  let calls = 0, captured;
  const transport = billingFetch(Date.now() + 1000, async (_, init) => {
    calls++; captured = init; return new Response('{}');
  });
  for (const cancelRequest of [true, false]) {
    const requestCancel = new AbortController(), initCancel = new AbortController();
    const request = new Request('https://api.stripe.com/v1/account', { signal: requestCancel.signal, redirect: 'follow' });
    await transport(request, { signal: initCancel.signal, redirect: 'follow' });
    assert.equal(captured.redirect, 'error'); assert.equal(captured.signal.aborted, false);
    (cancelRequest ? requestCancel : initCancel).abort();
    assert.equal(captured.signal.aborted, true);
  }
  const prior = calls;
  for (const cancelRequest of [true, false]) {
    const requestCancel = new AbortController(), initCancel = new AbortController();
    (cancelRequest ? requestCancel : initCancel).abort();
    assert.throws(() => transport(new Request('https://api.stripe.com/v1/account', { signal: requestCancel.signal }),
      { signal: initCancel.signal }), error => error.name === 'AbortError');
  }
  assert.equal(calls, prior, 'pre-aborted requests never reach underlying transport');
});
