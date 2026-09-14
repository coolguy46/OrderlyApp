import 'server-only';
import { BillingError } from './config';

// Verified in sandbox acct_1UE0rgCjmnlmrlsX. These have no Orderly user/customer mapping.
const links = {
  trial: 'https://buy.stripe.com/test_eVqaEWeKFbqd1YNeEigYU02',
  subscription: 'https://buy.stripe.com/test_8x24gy5a52THgTH67MgYU03',
} as const;

export function previewCheckout(kind: string | null) {
  if (kind !== 'trial' && kind !== 'subscription') throw new BillingError('Choose a valid test checkout.', 400);
  const url = new URL(links[kind]);
  if (url.origin !== 'https://buy.stripe.com' || !/^\/test_[A-Za-z0-9]+$/.test(url.pathname)
    || url.search || url.hash || url.username || url.password) throw new BillingError('Test checkout is unavailable.');
  return { url: url.href, sandbox: true };
}
