// Opt-in sandbox-only setup. No production secrets, users, or database access.
// https://docs.stripe.com/api/payment-link/create
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import Stripe from 'stripe';

const accountId = 'acct_1UE0rgCjmnlmrlsX';
const priceId = 'price_1UE1DQCjmnlmrlsXHxHfcpa4';
const purpose = 'owner-billing-preview-v1';
const returnUrl = 'https://www.myorderlyapp.com/planner?billingPreviewReturn=1';
let phase = 'configuration';
const check = condition => { if (!condition) throw new Error('Verification failed'); };
try {
  check(process.argv.includes('--run'));
  const values = parseEnv(readFileSync('.env.local', 'utf8'));
  check(values.STRIPE_SECRET_KEY?.startsWith('sk_test_'));
  const stripe = new Stripe(values.STRIPE_SECRET_KEY, { timeout: 12000, maxNetworkRetries: 1 });
  phase = 'verify_account_and_price';
  check((await stripe.accounts.retrieve(null)).id === accountId);
  const price = await stripe.prices.retrieve(priceId);
  check(!price.livemode && price.active && price.unit_amount === 499 && price.currency === 'usd'
    && price.recurring?.interval === 'month' && price.recurring.interval_count === 1);
  const existing = [];
  for await (const link of stripe.paymentLinks.list({ limit: 100 })) {
    if (link.metadata.orderly_purpose === purpose) existing.push(link);
  }
  for (const kind of ['trial', 'subscription']) {
    phase = `setup_${kind}`;
    let link = existing.find(item => item.active && item.metadata.preview_kind === kind);
    if (!link) link = await stripe.paymentLinks.create({
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ['card'], payment_method_collection: 'always',
      automatic_tax: { enabled: false },
      after_completion: { type: 'redirect', redirect: { url: returnUrl } },
      metadata: { orderly_purpose: purpose, preview_kind: kind },
      custom_text: { submit: { message: 'Orderly owner preview — test mode only. This will not change your real Orderly subscription. Use a Stripe test card, not a real card.' } },
      subscription_data: { metadata: { orderly_purpose: purpose, preview_kind: kind },
        ...(kind === 'trial' ? { trial_period_days: 7, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}) },
    }, { idempotencyKey: `${purpose}-${kind}` });
    phase = `verify_${kind}`;
    link = await stripe.paymentLinks.retrieve(link.id);
    const items = await stripe.paymentLinks.listLineItems(link.id);
    check(!link.livemode && link.active && link.url.startsWith('https://buy.stripe.com/test_'));
    check(items.data.length === 1 && items.data[0].price?.id === priceId && items.data[0].quantity === 1);
    check(link.payment_method_collection === 'always' && link.payment_method_types?.join() === 'card');
    check(link.subscription_data?.trial_period_days === (kind === 'trial' ? 7 : null));
    check(link.after_completion.redirect?.url === returnUrl && !link.automatic_tax.enabled);
    console.log(JSON.stringify({ kind, id: link.id, url: link.url, verifiedSandbox: true }));
  }
} catch {
  // Never print raw Stripe errors or credential values.
  console.error(JSON.stringify({ success: false, failedPhase: phase })); process.exitCode = 1;
}
