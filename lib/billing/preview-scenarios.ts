import type { BillingStatus } from '@/components/billing/useBilling';

export const previewScenarios = {
  locked: 'Locked · first-time trial',
  trial: 'Trial active',
  trialCanceled: 'Trial canceled · access remaining',
  paid: 'Paid subscription',
  paidCanceled: 'Renewal canceled · access remaining',
  expired: 'Expired · trial already used',
  pastDue: 'Payment needs attention',
  pending: 'Returned from checkout · confirming',
  abandoned: 'Checkout canceled',
  setup: 'Checkout not enabled',
  loading: 'Checking access',
  error: 'Billing unavailable',
} as const;
export type PreviewScenario = keyof typeof previewScenarios;

/** Synthetic presentation data. Never persist it or use it for authorization. */
export function previewScenario(key: PreviewScenario, now: number) {
  const future = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const status: BillingStatus = { enabled: true, subscriptionRequired: true, checkoutEnabled: true,
    aiAccess: false, hasSubscription: false, canManage: false, trialEligible: true, status: 'none' };
  if (['trial', 'trialCanceled', 'paid', 'paidCanceled'].includes(key)) {
    const trial = key === 'trial' || key === 'trialCanceled';
    Object.assign(status, { aiAccess: true, hasSubscription: true, canManage: true, trialEligible: false,
      status: trial ? 'trialing' : 'active', cancelAtPeriodEnd: key.endsWith('Canceled'),
      trialEndsAt: trial ? future(7) : null, accessEndsAt: future(trial ? 7 : 30) });
  }
  if (key === 'expired') Object.assign(status, { trialEligible: false, status: 'canceled' });
  if (key === 'pastDue') Object.assign(status, { hasSubscription: true, canManage: true, trialEligible: false, status: 'past_due' });
  if (key === 'setup') status.enabled = false;
  return { status: key === 'loading' || key === 'error' ? null : status,
    checking: key === 'loading', error: key === 'error' ? 'Could not verify AI access. Please try again.' : '',
    returnState: key === 'pending' ? 'success' : key === 'abandoned' ? 'canceled' : '' };
}
