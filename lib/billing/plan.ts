// Public plan information shared by the UI, terms, and server-side price checks.
// Changing this does not change Stripe objects or existing subscriptions.
export const ORDERLY_AI_MONTHLY_PRICE_CENTS = 899;
export const ORDERLY_AI_NEW_TRIAL_DAYS: 0 | 7 = 0;
export const ORDERLY_AI_DAILY_TOKENS = 50_000;
export const ORDERLY_AI_MONTHLY_TOKENS = 1_000_000;

export interface AssistantBillingPeriod { start: string; end: string }

/** Complimentary owner/local accounts use UTC calendar months. Paid accounts
 * must use their server-verified Stripe billing period instead. */
export function complimentaryBillingPeriod(now = new Date()): AssistantBillingPeriod {
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
}
export const ORDERLY_AI_MONTHLY_PRICE_LABEL = `$${(ORDERLY_AI_MONTHLY_PRICE_CENTS / 100).toFixed(2)}`;
