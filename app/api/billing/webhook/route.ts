import Stripe from 'stripe';
import { billingConfig, BillingError, billingFailure, billingJson } from '@/lib/billing/config';
import { billingServer } from '@/lib/billing/server';
import { acceptBillingEvent, webhookBody } from '@/lib/billing/webhook';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    const config = billingConfig();
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new BillingError('Missing webhook signature.', 400);
    const raw = await webhookBody(request);
    let event: Stripe.Event;
    try { event = new Stripe(config.secretKey).webhooks.constructEvent(raw, signature, config.webhookSecret); }
    catch { throw new BillingError('Invalid webhook signature.', 400); }
    // No database or Stripe network work occurs for an unsigned request.
    const { store } = await billingServer();
    await acceptBillingEvent(event, store, config.accountId, config.livemode);
    return billingJson({ received: true });
  } catch (error) { return billingFailure(error); }
}
