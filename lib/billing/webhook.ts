import type Stripe from 'stripe';
import { BillingError } from './config.ts';
import type { BillingStore } from './service.ts';

export const BILLING_EVENTS = new Set([
  'checkout.session.completed', 'checkout.session.expired',
  'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed',
]);

/** Preserve the original bytes for Stripe signature verification, with size/time bounds. */
export async function webhookBody(request: Request): Promise<Buffer> {
  if (!request.body) throw new BillingError('Missing webhook body.', 400);
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 262144)) throw new BillingError('Webhook too large.', 413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new BillingError('Webhook timed out.', 408)); }, 10_000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      size += value.byteLength;
      if (size > 262144) throw new BillingError('Webhook too large.', 413);
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function acceptBillingEvent(event: Stripe.Event, store: BillingStore, accountId: string, livemode = false) {
  if (event.livemode !== livemode || (event.account && event.account !== accountId)) throw new BillingError('Unexpected Stripe account or mode.', 400);
  if (!BILLING_EVENTS.has(event.type)) return;
  // Durable deduplication, no payment details or full payload persisted. Entitlement
  // reads retrieve current Stripe state, so old or reordered events cannot grant access.
  await store.recordEvent(event.id, event.type, event.created);
}
