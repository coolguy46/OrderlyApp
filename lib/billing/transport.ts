import Stripe from 'stripe';
import { BillingError } from './config.ts';

/** One shared deadline covers account checks, pagination, and subsequent writes. */
export function billingFetch(deadline: number, transport: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BillingError('Billing timed out. Retry the same checkout shortly.');
    const signal = AbortSignal.any([AbortSignal.timeout(remaining),
      ...(input instanceof Request ? [input.signal] : []), ...(init?.signal ? [init.signal] : [])]);
    signal.throwIfAborted();
    // Never forward privileged headers/body to a redirected destination, even
    // if a Request or SDK supplied redirect:'follow'. Preserve both abort sources.
    return transport(input, { ...init, signal, redirect: 'error' });
  };
}

export function createBillingStripe(secretKey: string, deadline = Date.now() + 45_000): Stripe {
  return new Stripe(secretKey, { timeout: 12_000, maxNetworkRetries: 1,
    httpClient: Stripe.createFetchHttpClient(billingFetch(deadline)),
  });
}
