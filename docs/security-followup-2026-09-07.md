# Security deployment follow-up — September 7, 2026

Scope: the owner approved the previously reported profile/competition protections,
profile-counter recalculation, Canvas request controls, and account-deletion
processing. No paid plan, secret rotation, real-user deletion test, or retention
policy change was authorized or performed.

Baseline: `cb4d2fa2b7700e1f32452ec879cc77cfab5efb47`.
Local code rollback reference: `codex/pre-security-followup-2026-09-07`.
Target: Supabase project `xsisgvqsvsbpvvvzucqx`, main Production;
Vercel project `coolguy46s-projects/orderlyappp`, `www.myorderlyapp.com`.

## Confirmed gaps and repairs

- Production still allowed browser profile INSERTs through an unconditional
  policy, and lacked server-managed profile counters. The tested incremental
  migration removed direct INSERT permission, protected identity/stat fields,
  installed task/study counter triggers, and recalculated totals. Invalid
  historic study-session count was zero. Aggregate counter mismatches went
  from **4 to 0**. No source task/study records were changed by this repair.
- Dormant competition and participant tables allowed unconditional reads.
  There are no active application consumers (only type declarations).
  Their policies and browser grants were removed without deleting records.
- Production lacked the Canvas import lease functions **and** provider-request
  controls, although the current application requires them. Installed both
  incremental migrations. Per-account validation/manual-sync cooldowns and
  crash-recoverable import locks now exist; other accounts cannot consume a
  user's allowance. The provider table has RLS and no browser CRUD grants.
- The durable deletion queue and worker scheduler were absent. Installed the
  private queue and five-minute dispatcher, reusing the existing worker secret.
  Queue/claim/dispatcher access is denied to anonymous and authenticated browser
  roles. No account was enqueued or deleted as a test.
- The two worker endpoint settings were missing. Installed the exact direct
  HTTPS endpoints under the verified public domain. The script creates only
  missing non-credential settings and aborts on a different existing origin;
  it does not reveal, copy, or rotate the worker secret.
- Live verification found the deletion claim function assumed `uuid-ossp` lived
  in `public`, but that function was absent there. A revised production-shaped
  local fixture reproduced `42883` before the fix. The incremental migration
  and fresh bootstrap now use built-in `pg_catalog.gen_random_uuid()`.
  The corrected migration was tested and reapplied successfully to production.
- Older incremental profile/trigger grants and search paths were tightened so
  applying them after the earlier security migration cannot reopen those RPCs.
  Worker installers now abort before scheduling if required settings are absent.
- The hardened native HTTPS transport omitted the User-Agent that the previous
  fetch transport supplied automatically. The 21:40 UTC live cycle identified
  HTTP 403 for all nine connections. A two-request comparison against a
  deliberately nonexistent public feed path reproduced Canvas's explicit
  missing-User-Agent rejection; identifying Orderly reached the application's
  invalid-feed response instead. Added a static, honest Orderly User-Agent on
  every hop without including user or feed information. DNS pinning, redirect
  validation, TLS verification, timeout and byte caps remain unchanged.
  This matches [Instructure's documented client-identification requirement](https://community.instructure.com/en/discussion/664378/2026-api-and-cli-change-log).

## Applied-file evidence

Each file was read from disk, hashed, pasted into the production SQL editor,
copied back, and compared exactly before execution. Each transaction returned
success. The Canvas cron job was briefly paused for the upgrade, then replaced
by one enabled five-minute job; manual sync was already failing closed because
its required database functions were absent. No obsolete application build was
deployed to bypass that gate.

| File | Final applied SHA-256 |
| --- | --- |
| `profile-integrity-migration.sql` | `1b5eb05d608834dfb3eb6bd79eb67606b192f2323f1ac5db9a593806ea6ebc55` |
| `competition-lockdown-migration.sql` | `5825642b5518739374d7dd0f18e2d338a9d481e439f66c26974ff088af243825` |
| `account-deletion-migration.sql` | `07a3930473a7ea7db3fcbd7234637ce80d7862e7150bde3e131e53cbaad8e4f8` |
| `canvas-sync-concurrency-migration.sql` | `5febaf41d7841205aea56e8c4967354c823c3ddb1efcbdbab0ec6833ff05de75` |
| `canvas-provider-throttle-migration.sql` | `095cc426cc026f0f5156ec014feab3db096b1e123027ff93edc8e86d4f4551d9` |
| `canvas-background-dispatch-migration.sql` | `8eeee2840e72a8076aa5a40d6c0e7803995dafd24402b6b8c8177e8047cc1107` |
| `account-deletion-dispatch-migration.sql` | `051eca52489cc6c9194b669a94591b48fd329c80e85c44509a8ab4455c1f18d8` |
| `docs/security-worker-endpoints-2026-09-07.sql` | `2ebe3b8f4e48916254e7270e4af5e8e06c196474401e5c18fcaeb802962e968b` |
| `docs/security-canvas-pause-2026-09-07.sql` | `d019eec2bae69590cf61096582d861d1b31be01545e1a15dc5a87b6d513c627a` |

The first queue installation used hash
`2722bb0b6edb7b7372d4a46f64608293d1af464398e49019b7a6e463b31cf0cf`;
the final hash above includes the verified UUID-location correction. No
destructive rollback was used. `schema.sql` was **not** run on production.

## Verification

- Eight new PostgreSQL-compatible isolated tests execute the actual incremental
  SQL against a production-shaped older schema, including explicit Supabase
  default grants. They cover atomic preflight rollback, recalculated counters,
  signup/task/study writes, competition denial, Canvas cooldown/token fencing,
  deletion claim recovery, dispatcher configuration, and exact-job pause/resume.
  No real credentials, network requests, or live jobs are used by these tests.
- Full `npm test` passed after the final User-Agent correction, including 59
  security tests (the prior 49 plus eight migration tests, one diagnostic test,
  and one provider-identification regression). All 11 feed-transport tests pass,
  including a fixture that rejects unidentified clients. After the UUID compatibility correction, the targeted
  database, migration-contract and follow-up tests passed again (33 tests).
- Lint, TypeScript checking, and optimized `next build --webpack` passed.
  Webpack is the installed framework's supported local-build alternative to the
  already documented Turbopack sandbox issue; no production build setting changed.
- Both public worker endpoints returned **401 without redirects** to anonymous
  POST requests. No paid provider test was made.
- Live metadata verified zero profile-total mismatches, no profile client INSERT,
  no competition/participant client SELECT, no remaining competition policies,
  and private queue/provider/AI-lease tables with RLS and no browser CRUD.
  Worker/claim functions deny browser invocation. Only the intentional
  account-scoped provider claim/release functions remain available to signed-in
  users; they derive the owner from the verified database identity.
- Exactly one enabled five-minute Canvas job and one enabled five-minute
  deletion job were observed. No pending deletion requests existed at inspection.
- The 21:30 UTC worker cycle returned HTTP 200 with `claimed:0, failed:0` for
  the corrected deletion worker, with no pending requests. This verifies the
  real worker/secret/queue connection without deleting an account.
- Initially Canvas acquired its database locks for all nine enabled connections,
  but those invocations returned `synced:0, failed:1` despite HTTP 200.
  Added fixed-stage feed diagnostics so logs distinguish DNS,
  connection, response-status, encoding and parsing failures without recording
  a private feed URL, response body, or arbitrary provider error. Those diagnostics
  confirmed the client-identification defect described above.
- The corrected code, commit `7be76b5f718063740a1db3847415f4fdac4d04be`, was
  verified **Ready / Production** with `www.myorderlyapp.com` assigned at
  21:46:44 UTC: [Vercel deployment](https://vercel.com/coolguy46s-projects/orderlyappp/E9wDGukMzr67jW2KjmoKNxkWJDW1).
  At the normal **21:50 UTC** worker cycle, aggregate-only production checks
  showed **all 9 enabled connections successfully synced since release**.
  The nine Canvas responses were HTTP 200, each `synced:1, failed:0`.
  The deletion worker also returned HTTP 200, `claimed:0, failed:0`.
  This confirms actual persisted sync completion, not merely successful cron
  dispatch or an HTTP 200 response. No extra manual feed run was triggered.

## Owner actions still required

1. **Administrator MFA:** Vercel Authentication shows 2FA **Inactive**;
   Supabase Account Security shows **No authenticator apps yet**. The pages are
   open for the owner. Complete Vercel's Authenticator App **Set Up** and
   Supabase's **Add app** personally; save recovery material privately. No new
   authentication secret, QR code, recovery code or credential was handled.
2. **Restorable backups:** the live Supabase Backups page explicitly says the
   Free Plan does not include project backups. No external backup was verified.
   [Supabase recommends regular off-site CLI exports on Free, or scheduled
   backups on a paid plan](https://supabase.com/docs/guides/platform/backups).
   Choose a protected off-site destination and provide authenticated database
   access for the free export route, or approve/complete a paid upgrade yourself.
   A database backup must be restore-tested separately; Storage objects require
   separate backup if that feature becomes active (no buckets currently exist).
   No private database dump was exported to an unapproved destination.
3. The earlier Google client-secret classification warning still requires an
   owner-coordinated review/rotation decision. No evidence of client exposure was
   established. The existing secret was not revealed or rotated.

These owner items should be resolved before broad promotion. The earlier
[audit](security-audit-2026-09-06.md) still records limits around complete account
export, retention/provider policy review, and untested live two-account behavior.
This follow-up does not claim that every possible vulnerability is eliminated.

## Recovery

The rollback branch restores code, not the database. Do not reinstall the old
permissive policies or old worker functions merely to roll back application code.
All source tasks, sessions, and competition rows were retained. Profile totals
are derived from those source rows and can be recalculated; they are not backups.
The migrations are transactional and rerunnable. If a worker must be stopped
during an incident, pause its **exact named cron job**, retain queued deletion
requests, and restore the verified dispatcher after remediation. Never delete
the queue to stop retries, and never run `schema.sql` against this installation.
