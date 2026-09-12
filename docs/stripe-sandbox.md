# Stripe sandbox checkout

## Current scope

Hosted subscription Checkout and Customer Portal for Orderly AI, seven days free for eligible accounts, then $4.99 USD/month. The rest of Orderly remains free. The implementation supports explicit test/live modes, with separate checkout and AI-enforcement switches. It has not been connected to the production application database. See `docs/stripe-production.md` for the production rollout; the following instructions remain sandbox-only.

The Stripe account connection used by Codex is not an API credential for the running website. No secret keys were copied from that connection into the app.

Verified existing sandbox resources (no new product or price created by this change):

- Account: `acct_1UE0rgCjmnlmrlsX` (Orderly sandbox)
- Product: `prod_VEUB0jmCeXN7lx` (Orderly AI)
- Price: `price_1UE1DQCjmnlmrlsXHxHfcpa4` (499 USD cents per month)
- Dedicated sandbox portal: `bpc_1UEgA9CjmnlmrlsXkvvWYvcF`, period-end cancellation, payment updates and invoice history enabled.
- Installed official `stripe` SDK 22.6.2; its default API version is `2026-08-26.dahlia`.

## Setup still required

1. Use a development/local Supabase database containing Orderly's existing schema, including `account_deletion_requests`. Review and apply **the exact** `lib/supabase/billing-migration.sql` there. Tests execute that file against a fictional PostgreSQL database; no hosted migration has been applied. Do not point sandbox checkout at production data without a separate review.
2. Put development Supabase variables and the following values into untracked `.env.local`. Do not paste secrets into chat or commit them. The chosen `STRIPE_APP_ORIGIN` must exactly match the browser address (localhost and 127.0.0.1 are different origins). Existing development auth callbacks must also allow that address; this change does not alter authentication.

```dotenv
STRIPE_BILLING_ENABLED=true
STRIPE_MODE=test
STRIPE_CHECKOUT_ENABLED=true
AI_SUBSCRIPTION_REQUIRED=false
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_ACCOUNT_ID=acct_1UE0rgCjmnlmrlsX
STRIPE_AI_PRICE_ID=price_1UE1DQCjmnlmrlsXHxHfcpa4
STRIPE_APP_ORIGIN=http://localhost:3000
STRIPE_PORTAL_CONFIGURATION_ID=bpc_1UEgA9CjmnlmrlsXkvvWYvcF
```

The secret key must be the **test** secret from that exact sandbox. The webhook secret is separate and starts with `whsec_`. Hosted Checkout does not require Stripe.js or a browser publishable key.

3. With the Stripe CLI authenticated to that same sandbox, forward local events:

```sh
stripe listen --events checkout.session.completed,checkout.session.expired,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,customer.subscription.trial_will_end,invoice.paid,invoice.payment_failed --forward-to localhost:3000/api/billing/webhook
```

Copy the listener's signing secret directly into `.env.local`, then restart Next.js. A Dashboard webhook signing secret and a CLI listener's signing secret are not interchangeable.

4. The dedicated sandbox Customer Portal above has been created and read back with the approved period-end cancellation policy. Use its explicit ID; do not change unrelated portal settings.
5. Run `npm run dev`, sign into a fictional development account, and open `/planner` or `/settings/billing`. Use Stripe's documented test cards, never real payment details. Test the seven-day trial, card collection, exact first charge, trial-to-paid transition, declined/3DS payment, abandoned checkout/resume, double-click, renewal failure, cancellation, and resubscription without another trial.
6. Only after billing setup works, enable `AI_SUBSCRIPTION_REQUIRED=true` in this sandbox to test server-side AI access. Keep it false elsewhere. Final usage allowances, refunds, tax collection, trial reminder emails and live activation still need release review. Stripe sandbox does not send trial-reminder emails.

## How it works

- `/api/billing/checkout`: authenticated, same-origin POST. Server chooses the price, quantity, customer, and return URLs; browser-supplied IDs are ignored. Database leases and stable Stripe idempotency keys protect creation retries. An open checkout is reused. Existing non-terminal subscriptions go to the portal rather than another purchase. An uncertain attempt older than 22 hours fails closed for manual reconciliation instead of risking another charge.
- `/api/billing/portal`: authenticated, same-origin POST, using only the caller's server-owned customer mapping.
- `/api/billing/status`: private, uncached status for the authenticated user. A return URL or session ID never grants access.
- `/api/billing/webhook`: bounded raw-body signature verification and private, idempotent event receipt storage. No full webhook/card payload is stored.
- Entitlement is checked against **current Stripe subscription/invoice state**, not event arrival order or a cached local boolean. A matching, unpaused, unexpired trial grants access before payment; paid access requires an active subscription, paid latest invoice and current item period. Canceled-at-period-end access continues only through its effective end. Past-due, expired, canceled and paused subscriptions do not grant access. Stripe outages fail closed; this adds API calls and should be revisited with measured usage before scaling.
- Trial eligibility comes from server-owned customer history and is persisted per checkout attempt for stable retries. Returning subscribers do not receive another trial. This prevents repeat trials for an existing Orderly account, not identity/account cycling after deletion.
- The three active provider routes use the shared subscription check when the flag is enabled. The old interpret route remains retired (410). Existing receipt replay and undo stay available without another paid provider call.
- Account deletion first checks subscription state, expires abandoned sessions, and closes billing to new checkouts. Active/non-terminal subscriptions must end first. A database trigger also prevents background identity deletion from orphaning unclosed billing. Keep billing credentials available for billing users even if checkout is disabled; disabling billing is not subscription cancellation.

Tax is not silently enabled: the existing sandbox price has unspecified tax behavior and no product tax code. Business location, registrations, pricing tax behavior, and customer address collection need explicit configuration before any live Tax rollout.

## Validation

```sh
node --test --experimental-strip-types tests/billing.test.mjs tests/billing-routes-security.test.mjs tests/billing-database-security.test.mjs
npm test
node --experimental-strip-types scripts/verify-stripe-sandbox.mjs --run
```

`tests/billing-ui.test.mjs` uses real billing components with fictional account data and blocked external requests; it requires the existing `ORDERLY_PLAYWRIGHT_MODULE` runtime convention. It is not a real Stripe Checkout browser test. The separate sandbox script hard-checks the exact test account and tests real Checkout creation with a disposable synthetic customer/session, then cleans up only those created objects. It passed; it does not complete hosted payment or verify delivered webhooks/renewal.

The unrelated untracked `design-lab/pages.tsx` is incomplete and breaks the root TypeScript/build scan. Billing validation excludes that folder using an external temporary config/build snapshot, without changing or deleting the design demo.

Before live activation: complete a real sandbox payment/webhook/portal test, confirm usage policy and cost bounds, review cancellation/refund/dunning and Tax policies, configure separate live resources/secrets, and review privacy disclosures. The mode guard must remain in place: test keys cannot run in Vercel production, live keys cannot run in previews, and live returns must use the main Orderly origin. Nothing here should be represented as production-ready billing until rollout validation passes.

References: https://docs.stripe.com/billing/quickstart · https://docs.stripe.com/webhooks · https://docs.stripe.com/customer-management/integrate-customer-portal
