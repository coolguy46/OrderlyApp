# Orderly AI $8.99 price update — September 14, 2026

## Scope and current offer

User requested USD $8.99/month everywhere. The eligible seven-day trial remains.
Only AI is paid; manual tools and the verified owner's complimentary access are unchanged.
One shared public constant supplies UI, terms, renewal copy and server price validation.
Checkout refuses an old-price open session and creates a fresh idempotent attempt only
after the old session is expired. Unverifiable line items fail closed.

## Verified Stripe and hosting changes

- Live account `acct_1UE0rYCchZxGFzZ8`, sandbox `acct_1UE0rgCjmnlmrlsX`.
- Existing product `prod_VEUB0jmCeXN7lx` reused in each environment.
- Live current price `price_1UFfrPCchZxGFzZ8vEXAr9du`; sandbox current price
  `price_1UFft1CjmnlmrlsXPVZuVx2l`. Both active, USD 899 cents, monthly,
  per-unit licensed pricing; set as their product's default.
- No non-ended subscriptions existed on either old price. No subscription was
  repriced, trial restarted, real charge created or customer data migrated.
- Old live/sandbox $4.99 prices archived, not deleted; historical records retained.
- Replaced and deactivated the two old owner-only sandbox Payment Links. Current
  trial `plink_1UFg03CjmnlmrlsXPqqor49F`, no-trial `plink_1UFg03CjmnlmrlsXehXANZPl`.
  Two open old-price sandbox preview sessions were expired. New trial checkout
  visibly showed Sandbox, 7 days free, then $8.99/month. Nothing was submitted.
- Updated only `STRIPE_AI_PRICE_ID` in Production for existing Vercel project
  `orderlyappp` (`prj_At9hK1FqMo370a8yJIYTPpj3o5sz`, team `coolguy46s-projects`).
  Dashboard confirmed save; value takes effect on next deployment. Billing and
  new-checkout switches stay off. Canonical site is `www.myorderlyapp.com`.
- Updated only the descriptive price text on verified live webhook
  `we_1UFfMFCchZxGFzZ8f9a2w4zf`; status, event selection, URL and secret unchanged.
- Updated ignored local price-ID worksheets and current setup examples/scripts.
  Historical audit records retain historical $4.99 observations explicitly.

## Validation and release boundary

Clean price-only release branch `codex/price-899-2026-09-14` starts from current
production `5d47ce4b153ce5ffdb59658cffbc29da80e31b7d`. The original dirty security
branch, migrations, design-lab and research are preserved, not bundled into this release.

- Clean release: 565 unit/integration tests passed, none failed/skipped.
- Isolated billing browser regression passed (mobile/light/dark, trial/renewal,
  ordinary-account gate, owner isolation, failure/return handling, free manual tools).
- Clean Next webpack production build and its TypeScript check passed; targeted
  ESLint and diff whitespace check passed. Build used no private environment files.
- Separate current security-worktree focused billing suite: 54 passed. This does
  not mean the pending broader security changes were released.
- Actual sandbox API test accepted $8.99 with required card and seven-day trial;
  a repeated call reused one session, and open checkout granted no AI entitlement.
  Its one synthetic session was expired and synthetic customer deleted afterward.
  This was not a completed payment, delivered webhook or renewal test.

## Token recommendation — not implemented by this price change

Recommended paid allowance: **1,000,000 total input + output tokens per billing
month**, with a **50,000-token daily ceiling**. Count every provider call, including
resent context, history and repairs, not just words the user types. A trial needs
its own smaller whole-trial allowance before activation; do not promise unlimited AI.

Production model setting was read as `deepseek-v4-flash`. Official current pricing
maps this to Flash; peak uncached input $0.30/M and output $1.20/M. Thus 1M combined
tokens costs at most $1.20 at those rates even if all are output. Pricing may change;
provider-model-specific cost accounting and a global spending ceiling remain necessary.
This is not a guarantee of business profit: hosting, database, Stripe/Tax fees,
refunds, disputes and trial abuse also cost money.

Source: https://api-docs.deepseek.com/quick_start/pricing/

**Token quotas have not been activated. Live payments are not activated by this
price update.** Finish the separately recorded accounting/budget configuration and
isolated end-to-end checkout/webhook/portal verification before enabling sales.
