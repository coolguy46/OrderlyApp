This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

Copy `.env.example` to `.env.local` and fill in the Supabase public values. The
weekly Planner works without an AI key by using deterministic estimates. To add
chat-based interpretation and richer assignment estimates, configure
`DEEPSEEK_API_KEY`; `DEEPSEEK_MODEL` defaults to `deepseek-v4-flash`. Before
enabling AI calls, apply `lib/supabase/assistant-usage-migration.sql`. It stores
durable per-user requests and provider token usage. Daily/monthly message quotas
are temporarily disabled by default; existing installations must reapply that
idempotent migration before deploying this version. The per-user
`DEEPSEEK_REQUESTS_PER_MINUTE` abuse limit remains active. To restore the UTC
day/month quotas later, apply the current migration and set
`AI_ASSISTANT_MESSAGE_LIMITS_ENABLED=true`; the optional
`DEEPSEEK_DAILY_MESSAGE_LIMIT` and `DEEPSEEK_MONTHLY_MESSAGE_LIMIT` variables
then control the allowances. Set `AI_ASSISTANT_ENABLED=false` for an immediate
kill switch without removing the API key.

Planner and task-schedule edits use an account-fenced local cache for immediate
and offline updates, then persist to Supabase for cross-device hydration. Apply
both persistence migrations in the rollout order below before deploying this
application version.

### Production rollout order

`schema.sql` is **fresh-bootstrap-only**. Never use it to upgrade an existing
database. There is no automatic migration ledger in this repository, so record
each successfully applied file and checksum in the release change ticket.

For an existing deployment, take a restorable backup and use this order. Do not
run two Canvas schedulers at once, and do not deploy the new application before
the non-lease columns it queries exist:

1. Inventory tables, columns, constraints, policies, triggers, functions,
   extensions, Vault entries, and cron jobs. Run read-only preflights for
   duplicate Canvas identities, invalid Canvas intervals/session durations,
   inverse/self friendships, and cross-account subject/task/exam references.
2. Disable every legacy/external Canvas scheduler, temporarily stop manual
   Canvas sync, and let in-flight requests drain.
3. Apply the pre-deploy application prerequisites in this order:
   1. `recurrence-migration.sql`
   2. `timer-state-migration.sql` (creates or normalizes the current durable
      timer table, including `pending_session`)
   3. `task-scheduling-migration.sql`
   4. `planner-migration.sql`
   5. `task-completion-atomic-migration.sql` (required for atomic repeating-task
      completion and successor creation; ordinary completion uses a conditional
      row update and does not depend on this RPC)
   6. `friendship-rls-hardening-migration.sql` after its non-destructive
      duplicate/self-row preflight succeeds
   7. `profile-integrity-migration.sql` after reviewing its bounded counter
      repair; this also removes all direct profile INSERT policies
   8. `friend-search-rpc-migration.sql`
   9. `competition-lockdown-migration.sql` (keeps the dormant competition tables
      unavailable to browser roles until the feature has a trusted server model)
   10. `relationship-ownership-migration.sql` (run after the planner tables exist
      so its optional task/exam/subject links receive ownership triggers)
   11. `account-deletion-migration.sql` (installs the service-role-only durable
       deletion queue before the application can enqueue deletion requests)
4. Apply the Canvas non-lease schema before deploying:
   `canvas-migration.sql`, `canvas-background-sync-migration.sql`, then
   `canvas-sync-reliability-migration.sql`. Resolve duplicate
   `(user_id, source, external_id)` rows before the reliability migration.
5. Configure Vercel production `SUPABASE_SERVICE_ROLE_KEY` and
   `CANVAS_SYNC_CRON_SECRET`. In Supabase Vault, create
   `canvas_sync_cron_secret` with the identical secret and
   `canvas_sync_endpoint_url` with the complete redirect-free environment URL,
   for example `https://example.com/api/canvas/background-sync`. The dispatcher
   rejects non-HTTPS URLs, query strings, fragments, trailing slashes, and any
   path other than the exact background-sync route. Also create
   `account_deletion_endpoint_url` with the exact redirect-free URL ending in
   `/api/account/deletion/process`; it reuses `canvas_sync_cron_secret` rather
   than introducing another bearer secret. Redeploy environment settings before
   continuing.
6. Apply `canvas-sync-concurrency-migration.sql`, then
   `canvas-provider-throttle-migration.sql`, while manual and scheduled Canvas
   sync remain paused. The second migration installs atomic per-account
   validation/manual-sync cooldowns and the server-managed persisted course
   count; the application fails closed until both RPC sets are available.
7. Deploy the lease-aware, provider-throttled application only after those
   migrations complete successfully.
8. Smoke-test initial account loading, non-recurring and recurring task
   completion, timer recovery, friendships, profile counters, relationship
   ownership rejection, and manual Canvas sync.
9. Apply `canvas-background-dispatch-migration.sql`, then
   `account-deletion-dispatch-migration.sql`, **last**. They immediately
   install/activate the five-minute Supabase schedulers, so do this only after
   both worker endpoints have been deployed and smoke-tested.
10. Verify exactly one active `orderly-canvas-background-sync` cron job and one
    `orderly-account-deletion-worker` cron job,
    successful `pg_net` responses, a direct (non-redirecting) configured
    endpoint, correct manual/background timestamps, and no legacy scheduler.

`timer-session-recovery-migration.sql` is a narrow compatibility migration for
an already-correct older timer table that lacks only `pending_session`; do not
run it in addition to the current `timer-state-migration.sql` without a reason.
For a brand-new empty Supabase project, run `schema.sql` once; it already
contains recurrence, timer recovery, friendship/profile hardening, relationship
guards, task-completion RPCs, the durable account-deletion queue, and the
non-dispatch Canvas schema (including provider throttling and persisted Canvas
course counts). Then apply
`task-scheduling-migration.sql`, `planner-migration.sql`, and rerun
`relationship-ownership-migration.sql`; these persistence tables/columns are not
part of the fresh bootstrap yet. Do not replay other incremental migrations
already represented in `schema.sql`. Configure Vercel and Vault, deploy,
smoke-test, and install both dispatchers last.

The `current_streak` and `longest_streak` profile columns are retained only for
legacy compatibility. No trustworthy timezone-aware maintenance job exists in
this release, so they must not be presented as live statistics. Never expose
`SUPABASE_SERVICE_ROLE_KEY`, `CANVAS_SYNC_CRON_SECRET`, or any Vault value to
the browser.

## Google sign-in production configuration

The application code uses Supabase's PKCE callback at `/auth/callback`. Complete
all of the following dashboard configuration before treating Google sign-in as
production-ready:

1. In Vercel, set `NEXT_PUBLIC_SITE_URL` to the canonical application origin:
   `https://www.myorderlyapp.com`. Apply it to Production only, then redeploy.
   Leave it unset for previews so the PKCE callback returns to the same preview
   origin that created the verifier cookie.
2. In **Supabase > Authentication > URL Configuration**, set **Site URL** to
   `https://www.myorderlyapp.com` and add the exact production redirect URL
   `https://www.myorderlyapp.com/auth/callback`. Add
   `http://localhost:3000/auth/callback` for local development. Avoid a broad
   production wildcard; add a specific stable Vercel preview pattern only when
   preview OAuth is intentionally supported. See [Supabase redirect URL
   guidance](https://supabase.com/docs/guides/auth/redirect-urls).
3. In **Supabase > Authentication > Sign In / Providers > Google**, enable the
   provider and store the Web OAuth client's ID and secret there. These values
   are server-side Supabase configuration and do not belong in `NEXT_PUBLIC_*`
   variables.
4. In **Google Auth Platform > Clients**, the Web OAuth client's authorized
   redirect URI must be the Supabase provider callback shown in the Supabase
   Google-provider panel, normally
   `https://<project-ref>.supabase.co/auth/v1/callback`. It is not the Orderly
   `/auth/callback` URL. Google requires an exact match, including scheme and
   trailing slash. See [Supabase's Google provider
   guide](https://supabase.com/docs/guides/auth/social-login/auth-google) and
   [Google's redirect URI rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation).
5. In **Google Auth Platform > Branding**, set the app name to `Orderly`, select
   a monitored support email, upload the Orderly logo, and set:
   - Home page: `https://www.myorderlyapp.com/landing`
   - Privacy policy: `https://www.myorderlyapp.com/privacy`
   - Terms: `https://www.myorderlyapp.com/terms`
   - Authorized domain: `myorderlyapp.com`

   Set the audience to External and publish when the app should be available to
   users beyond the test-user list. Google requires brand verification before
   the verified app name and logo appear publicly; see [Google's branding
   configuration](https://support.google.com/cloud/answer/15549049).

Google can still display the Supabase project hostname during the provider
handoff even when the Orderly brand is configured. Replacing that hostname
requires a Supabase custom domain such as `auth.myorderlyapp.com` (a paid
Supabase add-on). After activating it, add both the old and new provider
callbacks to the Google client during the transition, update
`NEXT_PUBLIC_SUPABASE_URL` to the custom origin, and redeploy. Follow
[Supabase's custom-domain OAuth migration steps](https://supabase.com/docs/guides/platform/custom-domains).

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
