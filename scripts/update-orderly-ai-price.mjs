// Explicitly authorized $8.99 price preparation. No subscription/charge creation,
// customer updates, production database access, or automatic checkout activation.
// Run with --apply only after reviewing the exact accounts and old-price usage.
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import Stripe from 'stripe';
import { ORDERLY_AI_MONTHLY_PRICE_CENTS } from '../lib/billing/plan.ts';

const targets = [
  { mode: 'live', file: '.env.stripe-live.local', account: 'acct_1UE0rYCchZxGFzZ8', oldPrice: 'price_1UEeraCchZxGFzZ81FrIVc1K' },
  { mode: 'test', file: '.env.local', account: 'acct_1UE0rgCjmnlmrlsX', oldPrice: 'price_1UE1DQCjmnlmrlsXHxHfcpa4' },
];
const productId = 'prod_VEUB0jmCeXN7lx';
const check = value => { if (!value) throw new Error('Verification failed'); };
let phase = 'configuration';
let mode;
try {
  check(ORDERLY_AI_MONTHLY_PRICE_CENTS === 899);
  for (const target of targets) {
    mode = target.mode;
    const env = parseEnv(readFileSync(target.file, 'utf8'));
    check(env.STRIPE_SECRET_KEY?.startsWith(`sk_${mode}_`));
    const stripe = new Stripe(env.STRIPE_SECRET_KEY, { timeout: 12000, maxNetworkRetries: 0 });
    phase = 'verify_account';
    check((await stripe.accounts.retrieve(null)).id === target.account);
    const old = await stripe.prices.retrieve(target.oldPrice);
    check(old.product === productId && old.unit_amount === 499 && old.currency === 'usd' && old.livemode === (mode === 'live'));
    phase = 'verify_no_existing_contracts';
    let inspected = 0;
    for await (const subscription of stripe.subscriptions.list({ price: old.id, status: 'all', limit: 100 })) {
      check(++inspected <= 1000 && ['canceled', 'incomplete_expired'].includes(subscription.status));
    }
    inspected = 0;
    for await (const session of stripe.checkout.sessions.list({ status: 'open', limit: 100 })) {
      check(++inspected <= 1000);
      const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });
      check(!items.has_more);
      if (items.data.some(item => item.price?.id === old.id)) {
        // Only the two verified, owner-only sandbox preview links may be retired.
        // An unknown/live checkout needs review rather than silent expiration.
        check(mode === 'test' && session.livemode === false && session.metadata?.orderly_purpose === 'owner-billing-preview-v1' &&
          ['plink_1UEwGSCjmnlmrlsXtsHivAd3', 'plink_1UEwGTCjmnlmrlsX79DHGqQy'].includes(session.payment_link));
        if (process.argv.includes('--apply')) {
          const expired = await stripe.checkout.sessions.expire(session.id);
          check(expired.status === 'expired' && expired.livemode === false);
        }
      }
    }
    phase = 'find_replacement';
    const prices = await stripe.prices.list({ product: productId, lookup_keys: ['orderly_ai_monthly_usd_899_v1'], limit: 10 });
    check(!prices.has_more && prices.data.length <= 1);
    let replacement = prices.data[0];
    if (process.argv.includes('--apply')) {
      phase = 'create_replacement';
      replacement ??= await stripe.prices.create({ product: productId, currency: 'usd',
        unit_amount: 899, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
        tax_behavior: old.tax_behavior || 'unspecified', lookup_key: 'orderly_ai_monthly_usd_899_v1',
        nickname: 'Orderly AI monthly — September 14, 2026',
      }, { idempotencyKey: `orderly-ai-price-899-${mode}-2026-09-14` });
      check(replacement.active && replacement.livemode === (mode === 'live') && replacement.product === productId &&
        replacement.unit_amount === 899 && replacement.currency === 'usd' && replacement.recurring?.interval === 'month' &&
        replacement.recurring.interval_count === 1 && replacement.recurring.usage_type === 'licensed');
      phase = 'set_product_default';
      const product = await stripe.products.update(productId, { default_price: replacement.id },
        { idempotencyKey: `orderly-ai-default-899-${mode}-2026-09-14` });
      check(product.default_price === replacement.id);
      replacement = await stripe.prices.retrieve(replacement.id);
      check(replacement.unit_amount === 899 && replacement.active && replacement.livemode === (mode === 'live'));
      if (process.argv.includes('--retire-old')) {
        phase = 'verify_replacement_links';
        if (mode === 'test') {
          for (const id of ['plink_1UFg03CjmnlmrlsXPqqor49F', 'plink_1UFg03CjmnlmrlsXehXANZPl']) {
            const link = await stripe.paymentLinks.retrieve(id);
            const items = await stripe.paymentLinks.listLineItems(id, { limit: 2 });
            check(link.active && !link.livemode && link.metadata.orderly_purpose === 'owner-billing-preview-899-v1' &&
              !items.has_more && items.data.length === 1 && items.data[0].price?.id === replacement.id && items.data[0].quantity === 1);
          }
          phase = 'retire_old_preview_links';
          for (const id of ['plink_1UEwGSCjmnlmrlsXtsHivAd3', 'plink_1UEwGTCjmnlmrlsX79DHGqQy']) {
            const link = await stripe.paymentLinks.retrieve(id);
            const items = await stripe.paymentLinks.listLineItems(id, { limit: 2 });
            check(!link.livemode && link.metadata.orderly_purpose === 'owner-billing-preview-v1' &&
              !items.has_more && items.data.length === 1 && items.data[0].price?.id === old.id);
            const retired = await stripe.paymentLinks.update(id, { active: false });
            check(retired.active === false);
          }
        } else {
          phase = 'update_webhook_description';
          const endpoint = await stripe.webhookEndpoints.retrieve('we_1UFfMFCchZxGFzZ8f9a2w4zf');
          check(endpoint.livemode && endpoint.url === 'https://www.myorderlyapp.com/api/billing/webhook');
          const updated = await stripe.webhookEndpoints.update(endpoint.id, {
            description: 'Orderly subscription event receipts. Production-only; seven-day eligible trial and $8.99 monthly plan.',
          });
          check(updated.description.includes('$8.99') && updated.status === endpoint.status);
        }
        phase = 'archive_old_price';
        const retired = await stripe.prices.update(old.id, { active: false });
        check(retired.active === false && retired.unit_amount === 499);
      }
    }
    console.log(JSON.stringify({ mode, account: target.account, product: productId, oldPrice: old.id,
      replacementPrice: replacement?.id || null, amount: replacement?.unit_amount || null,
      applied: process.argv.includes('--apply'), existingSubscriptionsModified: false,
      oldPriceArchived: process.argv.includes('--apply') && process.argv.includes('--retire-old'), checkoutActivated: false }));
  }
} catch {
  // Never print SDK exceptions: they can contain request credentials or private data.
  console.error(JSON.stringify({ success: false, mode, failedPhase: phase }));
  process.exitCode = 1;
}
