# Orderly AI production rollout — not activated

## Verified September 11, 2026

- Production Stripe account: `acct_1UE0rYCchZxGFzZ8` (Orderly, live).
- Existing live product: `prod_VEUB0jmCeXN7lx` (Orderly AI).
- Existing live price: `price_1UEeraCchZxGFzZ81FrIVc1K`, USD 499 cents, recurring monthly, active. Reuse it; do not duplicate the sandbox price.
- Created and read back dedicated live portal `bpc_1UEgAACchZxGFzZ8bjDYvxvm`: cancellation at period end, payment-method updates and invoice history enabled. Owner approved keeping trial/paid access through its end. No customers were charged.
- Latest live account read still reported `charges_enabled=false` and `payouts_enabled=false`; do not enable new sales while Stripe review is pending.
- Price tax behavior is unspecified; product tax code is unset. No tax registration or collection was changed.
- Live public application uses Supabase project `xsisgvqsvsbpvvvzucqx`. Do not restore the unrelated paused project into it.
- Local `.env.local` contains a sandbox secret. The owner saved a live secret into Git-ignored, mode-600 `.env.stripe-live.local`; it was verified against the exact live account without printing it. The worksheet now includes the live portal ID. It is not automatically loaded by Next.js. A live webhook signing secret and production environment installation remain outstanding.
- No authenticated Vercel CLI, linked Vercel checkout, or Supabase management credential was found in the checked standard locations. Both Chrome dashboard connections timed out. No production SQL or production secret installation was performed; source deployment succeeded through the existing GitHub integration, as recorded below.

## Implemented locally

- Explicit `STRIPE_MODE=test|live`, matching secret-key prefix, strict mode checks on customers, prices, subscriptions, Checkout Sessions and events.
- Live mode restricted to `https://www.myorderlyapp.com`; test mode rejected in Vercel production, live mode rejected in Vercel preview.
- `STRIPE_BILLING_ENABLED` enables billing services; `STRIPE_CHECKOUT_ENABLED` separately enables new purchases. Live purchases default off. Stripe `charges_enabled` must also be true.
- Turning off new purchases does not disable existing users' portal/status/webhooks. Keep billing services configured for all existing subscribers.
- Live checkout requires an active live portal configuration with period-end cancellation and payment-method updates enabled.
- Eligible accounts receive seven days free with a payment method collected upfront, then $4.99 USD/month. Full server-owned customer subscription history determines eligibility. Checkout attempts persist 0/7-day terms before Stripe calls so retries use identical parameters. Changed eligibility expires stale open links. This is one trial per Orderly account/customer, not proof against a person recreating an account.
- Verified, unexpired trials grant AI access without a paid invoice. Paid subscriptions require a paid latest invoice and current matching-price period. Canceled-at-period-end trials/subscriptions keep access until their effective end. Expired, canceled, past-due, paused and unpaid state cannot unlock AI.
- Assistant chat alone is gated by a dim/blurred fictional backdrop and a direct trial/subscribe button. Private chat is not rendered under the blur. Manual calendar/scheduling, tasks, goals, exams, study and integrations remain free; request recovery and undo controls stay available. Paid enforcement is server-side on all active provider routes.
- Billing UI refreshes on return, focus and access expiry. Checkout return query strings never grant access. Terms/privacy disclose the approved trial and renewal flow and actual billing data handling, without promising unlimited usage or inventing refund/retention rules.
- Billing page distinguishes real subscriptions from sandbox checkout; no misleading sandbox banner in live mode, and no purchase button while checkout is disabled.

## Required deployment environment

Install the following **server-only** values in the existing Vercel production project. Do not copy the Stripe sandbox secret into production or set any secret with `NEXT_PUBLIC_`. The private `.env.stripe-live.local` worksheet is ignored by Git and not automatically loaded by Next.js.

```dotenv
STRIPE_MODE=live
STRIPE_SECRET_KEY=<live secret from the verified live account>
STRIPE_ACCOUNT_ID=acct_1UE0rYCchZxGFzZ8
STRIPE_AI_PRICE_ID=price_1UEeraCchZxGFzZ81FrIVc1K
STRIPE_APP_ORIGIN=https://www.myorderlyapp.com
STRIPE_WEBHOOK_SECRET=<signing secret of the live website webhook endpoint>
STRIPE_PORTAL_CONFIGURATION_ID=bpc_1UEgAACchZxGFzZ8bjDYvxvm
STRIPE_BILLING_ENABLED=false
STRIPE_CHECKOUT_ENABLED=false
AI_SUBSCRIPTION_REQUIRED=false
```

Reuse the site's existing production Supabase URL, publishable key and service-role key after verifying the target. Do not overwrite unrelated environment values.

## Remaining sequence

1. Decide and disclose included AI usage, refund handling and applicable tax handling before sales. Do not promise unlimited AI or invent tax registrations. The approved seven-day trial and period-end cancellation are implemented. Existing optional message quotas remain unchanged and default off; per-minute abuse protection remains active.
2. Finish integration verification with fictional data in the separate Stripe sandbox. No real charges or test subscriptions in production user records. Automated fixture tests do not substitute for a real sandbox Checkout/webhook/portal flow.
3. Review and hash the exact `lib/supabase/billing-migration.sql`. Verify target project and its existing schema, including `account_deletion_requests`. Apply only that reviewed migration to the approved database; verify RLS/revokes, lease exclusivity and deletion behavior. Never reconstruct SQL from notes. Never run fixture cleanup against production.
4. Portal creation/read-back is complete in both modes. Before activation, verify the live dedicated configuration still uses period-end cancellation. Enable and verify Stripe-hosted trial/renewal notifications and the cancellation link under Subscriptions and emails. Receiving `trial_will_end` in Orderly's event ledger does not itself send an email. Stripe does not send trial-reminder emails in sandbox mode. See https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance.
5. Deploy validated source with all switches off, using the established Vercel production project. Preserve unrelated untracked `design-lab/` and research; neither is part of this billing release. The local design lab has unrelated JSX errors, so use a clean release snapshot for build validation.
6. Register a live webhook at `https://www.myorderlyapp.com/api/billing/webhook`, for the events in `BILLING_EVENTS`; put its signing secret into production. This is not the sandbox CLI listener secret. Never log a webhook signing secret or full payment payload.
7. Enable billing services, keeping new purchases and AI enforcement off. Verify signed events, authenticated status, portal configuration, unauthenticated denials and cross-origin protection. Do not disable webhook processing while customers have subscriptions.
8. Recheck Stripe account payment/payout readiness. Only after all checks and policies pass enable checkout and AI enforcement as a coordinated release. Confirm unpaid users cannot call AI directly and unrelated tasks/calendar stay free. Use a separately authorized payment flow for any real-money acceptance test; never create a real customer charge silently.

## Validation record

September 11 local validation: 545 unit/integration tests passed, including 43 billing/database/route/real-guard checks. Isolated billing browser regression passed: direct trial CTA, private-chat absence while locked, unpaid/trial/paid/cancellation states, expiry, free manual task/Undo controls, outage recovery, malicious return URL, owner-switch race, mobile/light/dark layouts. Targeted ESLint, isolated TypeScript and a clean-source Next webpack production build passed. Unrelated untracked design-lab source was excluded from the build snapshot, not changed or deleted.

Reviewed migration SHA-256: `8be3cc17c52ebf5bc6fe1127a0c809eb2e64a949b2a4c351a6616904d49942a1`. Recalculate and compare immediately before any authorized production execution.

The database tests use PGlite and fictional users; UI tests block external requests. `scripts/verify-stripe-sandbox.mjs` also passed against the actual verified sandbox: real Checkout accepted the service's seven-day/card-required parameters, double clicks reused the session, no access was granted before checkout completed, and portal settings read back correctly. Its synthetic checkout was expired and synthetic customer deleted. This was API-only, not a completed hosted payment, delivered webhook, or renewal test.

Production migration, production secret configuration, trial reminders, completed sandbox Checkout/webhook/portal verification, and activation remain outstanding. Do not represent this document or the staged code as a launched paywall.

## Source deployment proof

- Implementation commit `a1a742cba152378e5c5362b26b70cefbf4a6c41b` was pushed to `coolguy46/OrderlyApp` `main`.
- GitHub reported Vercel deployment success, including the established `orderlyappp` project deployment `F2USCU9LtLUT4n3bRnxnr3FrbP3v`. Existing additional `orderly` and `orderlyapp` project checks also succeeded; no new projects were created.
- Direct canonical-site verification returned HTTP 200 for `https://www.myorderlyapp.com/api/billing/status`, with exactly `{"enabled":false,"subscriptionRequired":false}`. The updated trial terms and Stripe privacy disclosure were also confirmed on that same site.
- Therefore the code is deployed, but subscriptions cannot yet be purchased and the AI is not locked. Do not mistake GitHub/Vercel success for billing activation or a successful payment test.
- Next external step: open the correct Orderly Vercel and Supabase dashboards in the Codex in-app browser and sign in. Never request secrets in chat. Follow the remaining activation sequence above after access and approvals are available.
