export class BillingError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}

export function billingConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.STRIPE_BILLING_ENABLED !== 'true') throw new BillingError('Billing is not enabled yet.');
  const mode = env.STRIPE_MODE || 'test';
  if (!['test', 'live'].includes(mode)) throw new BillingError('Invalid Stripe mode.');
  const livemode = mode === 'live';
  if (!env.STRIPE_SECRET_KEY?.startsWith(livemode ? 'sk_live_' : 'sk_test_')) {
    throw new BillingError('Stripe key does not match the configured mode.');
  }
  if (env.VERCEL_ENV === 'production' && !livemode) throw new BillingError('Sandbox billing cannot run in production.');
  if (env.VERCEL_ENV === 'preview' && livemode) throw new BillingError('Live billing cannot run in a preview deployment.');
  const origin = new URL(env.STRIPE_APP_ORIGIN || 'http://localhost:3000');
  if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new BillingError('Billing return address is not configured correctly.');
  }
  if (livemode && origin.origin !== 'https://www.myorderlyapp.com') {
    throw new BillingError('Live checkout must return to the main Orderly website.');
  }
  if (!/^price_[A-Za-z0-9]+$/.test(env.STRIPE_AI_PRICE_ID || '') ||
      !/^acct_[A-Za-z0-9]+$/.test(env.STRIPE_ACCOUNT_ID || '') ||
      !env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_')) {
    throw new BillingError('Billing credentials, price, or webhook signing secret are missing.');
  }
  if (livemode && !/^bpc_[A-Za-z0-9]+$/.test(env.STRIPE_PORTAL_CONFIGURATION_ID || '')) {
    throw new BillingError('Live subscription management is not configured.');
  }
  return {
    livemode,
    // Separately staged: webhook/portal/status can remain available when sales stop.
    checkoutEnabled: env.STRIPE_CHECKOUT_ENABLED === 'true' || (!livemode && env.STRIPE_CHECKOUT_ENABLED !== 'false'),
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    accountId: env.STRIPE_ACCOUNT_ID!,
    priceId: env.STRIPE_AI_PRICE_ID!,
    origin: origin.origin,
    portalConfiguration: env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
  };
}

export function billingJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export function billingFailure(error: unknown) {
  return billingJson({ error: error instanceof BillingError ? error.message : 'Billing is temporarily unavailable. Please try again.' }, error instanceof BillingError ? error.status : 503);
}
