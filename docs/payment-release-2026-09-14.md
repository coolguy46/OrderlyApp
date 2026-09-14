# Payment release: immediate billing and token protection

New purchases are USD 8.99/month with no new trial. Existing granted trials and
subscriptions keep their terms. Only AI is paid; manual tools remain free.
The approved owner remains complimentary with the same token safeguards.

Server/database limits: 50,000 combined input/output tokens per UTC day and
1,000,000 per verified Stripe billing period. Every actual provider attempt
reserves before dispatch, including repair calls. Unknown outcomes keep their
reservation; only validated usage refunds the unused portion. No overage billing.

Production migrations explicitly approved in the conversation on September 14
after their permission changes, unused security-log cleanup function, and possible
temporary AI interruption were explained. Apply these exact files in order:

- assistant-accounting-security-migration.sql SHA-256
  d1a5e29eb888040b34479a79a94ec4b01f6229f97fa7e852fb8a80c06aae37a3
- assistant-paid-token-limits-migration.sql SHA-256
  6d10de1029a3b0a261cb142841061690a6b181a4d434fa5f867ec0a783199021

The database migrations do not run the cleanup function, delete tasks, or alter
subscriptions. Matching application routes are required after migration.

Release verification: 640 unit/integration tests passed, isolated billing UI test
passed, changed runtime-code lint passed, Next.js Webpack production build passed,
source/history/static-output credential-pattern scans found zero matches. Local
Turbopack could not bind its worker port; the Vercel preview and production builds
for commit 77426cd93093238c5933a050be797c1f80c27325 subsequently succeeded.
Installed locked dependencies reported zero known vulnerabilities at installation.
This is not a claim that the application has no security vulnerabilities.

Provider pricing checked September 14 at
https://api-docs.deepseek.com/quick_start/pricing/ : the deployed legacy name
deepseek-v4-flash is accepted and routes to Flash. Conservative uncached peak
rates are USD 0.30/M input and 1.20/M output. Review again if provider changes rates.
Initial global emergency circuit breakers: USD 5/day and USD 50/calendar month;
5M tokens/day and 50M/calendar month. These are ceilings, not purchases or top-ups.

## Production activation checkpoint

Both approved database updates were run by the user on September 14. Update 1
existence checks returned true for both provider budget tables and its secure
accounting function. Update 2 returned success, and a subsequent permissions
query confirmed both paid-budget RPCs deny authenticated-browser execution and
allow service-role execution. The production project was independently observed
as xsisgvqsvsbpvvvzucqx, main/PRODUCTION, in organization Orderly1.

Release 77426cd was fast-forwarded to main. Vercel production build
F14nvgc3dWWAZNW4UNXoDYJNw7yQ succeeded on the verified orderlyappp project.
Canonical unsigned webhook requests returned 400, while anonymous billing status
and checkout returned 401. This verifies rejection paths, not a completed purchase.

Live Stripe recheck confirmed charges/payouts enabled, active live monthly price
price_1UFfrPCchZxGFzZ8vEXAr9du at USD 8.99, and enabled canonical webhook
we_1UFfMFCchZxGFzZ8f9a2w4zf. An existing price.updated event was resent through
Stripe's official CLI to test signing/delivery without modifying subscription
access; the resend was accepted, but successful delivery still needs confirmation.

The user reports saving STRIPE_CHECKOUT_ENABLED=true for Production. This
documentation-only deployment loads the saved setting; verify it on the live
website before reporting checkout as operational. The local live environment
file has no webhook signing-secret value; do not claim a local signed test ran.

No actual customer purchase or transfer of real funds has been performed by the agent.
