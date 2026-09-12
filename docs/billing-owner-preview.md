# Owner-only AI billing preview

## Scope

This is a visual inspection tool, independent of the real billing rollout. The button appears on Assistant (`/planner`) and Settings → Billing only after server verification. It does not activate sales, grant AI access, change a trial, or write to Orderly billing records.

The owner approved their Google sign-in email. The server stores its SHA-256 fingerprint, requires a confirmed primary email and a matching verified Google identity returned by Supabase `auth.getUser()`. Client store values, editable user metadata, URL flags, and request bodies cannot authorize access. The raw owner email is not embedded in application source. Changing the owner's sign-in email requires reviewing this allowlist. This is an email/verified-provider restriction, not an immutable Supabase UUID pin or an administrator role.

`GET /api/billing/preview` returns minimal, private/no-store eligibility. Both it and the separate checkout route deny other accounts. The preview is removed on logout/account switch and rechecked on focus. Checkout authorization is repeated on every click.

## What can be inspected

Twelve synthetic states cover first-time paywall, active/canceled trial, paid/canceled renewal, expired trial eligibility, payment trouble, checkout confirmation/cancellation, disabled setup, loading, and billing failure. The preview reuses `AssistantAccessView` and `BillingDetails`, so it shows actual Orderly presentation rather than a separate mockup. The real assistant remains mounted outside the dialog; draft state is preserved.

“Manage subscription” opens a simulated billing panel. “Simulate cancellation” changes only the selected preview state. Sample conversations are fictional, the composer is disabled, and no model provider or real billing mutation is called.

## Sandbox checkout

The trial/subscribe buttons in the dialog open dedicated, fixed Stripe **test-mode Payment Links**. The UI and hosted checkout explicitly say test mode. No sandbox secret is installed in production. The server returns only the approved test URL after owner and same-origin verification, and the client independently rejects non-test/foreign URLs.

Verified September 12, 2026:

- Sandbox account: `acct_1UE0rgCjmnlmrlsX`.
- Existing price: `price_1UE1DQCjmnlmrlsXHxHfcpa4` ($4.99 USD/month).
- Trial link: `plink_1UEwGSCjmnlmrlsXtsHivAd3`, seven-day trial.
- No-trial link: `plink_1UEwGTCjmnlmrlsX79DHGqQy`.
- Both active/test-mode, quantity one, payment method collected, no automatic tax, exact return URL `/planner?billingPreviewReturn=1` on the canonical site.
- Stripe-hosted trial page visibly showed Sandbox, 7 days free, then $4.99/month, and the owner-preview warning. No payment details entered or transaction submitted.

These test links have no Orderly user/customer mapping. A completed sandbox checkout does not unlock AI. Return-query presence is never payment evidence. Test links are reusable bearer URLs if copied elsewhere, but cannot charge real money; the private control itself is server-authorized. This does **not** replace or verify the production Checkout Sessions, webhooks, or portal integration.

Setup is reproducible with `node scripts/setup-billing-preview-links.mjs --run`. It requires the already-saved sandbox key in ignored `.env.local`, verifies the exact account and price before writes, reuses tagged links, and sanitizes errors. It never reads the live key. To retire these previews, deactivate only these exact sandbox links and remove the preview entry points.

Reference: [Stripe Payment Links API](https://docs.stripe.com/api/payment-link/create). The implementation planner was called but misclassified this narrow preview request as an invoicing integration; no irrelevant invoicing flow was added.

## Validation

- 553 unit/integration tests passed, including eight new preview authorization/route/state tests.
- Browser regression passed: ordinary-account exclusion; modal focus/Escape; mobile/desktop layouts; scenario switching; simulated cancellation; actual draft preservation; rejected checkout/error handling; test-only redirect; no AI unlock on return; logout and account-switch isolation.
- Targeted ESLint, isolated TypeScript check, and clean-source Next production build passed. Existing untracked design-lab and research work was excluded and preserved.
- Browser verification of the owner button used a synthetic authenticated fixture; the real owner's signed-in production session was not used.

Real payment activation remains a separate task. See [production rollout](stripe-production.md) for outstanding database, environment, webhook, verification, and policy gates. Do not infer completion of those gates from this preview release.
