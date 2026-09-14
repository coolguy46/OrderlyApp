// Public plan information shared by the UI, terms, and server-side price checks.
// Changing this does not change Stripe objects or existing subscriptions.
export const ORDERLY_AI_MONTHLY_PRICE_CENTS = 899;
export const ORDERLY_AI_MONTHLY_PRICE_LABEL = `$${(ORDERLY_AI_MONTHLY_PRICE_CENTS / 100).toFixed(2)}`;
