# Orderly security review — September 6, 2026

September 7 update: the owner approved the remaining database rollout. See the
[follow-up evidence](security-followup-2026-09-07.md) for installed protections,
the deletion compatibility correction, and the remaining MFA/backup owner steps.
The missing-migration observations below describe the earlier snapshot.

## Release status

Security repairs are implemented in this checkout. This is **not a certificate that production is secure**.
The two new database migrations were approved by the owner and **applied successfully to production**, followed by read-only ACL/RLS/trigger verification:

- `lib/supabase/security-boundaries-migration.sql`
- `lib/supabase/assistant-abuse-guard-migration.sql`

Dashboard access recovered after repeated connection failures. The exact tested migration files were read from disk, pasted through the SQL editor, copied back and hash-checked before execution. A reconstructed batch was initially rejected by the safety check and cancelled without execution. Exact-file hashes: boundaries `197c6deac5bb605ae8be62705128c88b90525aabe681bbac59343e153a4b9283`; abuse guard `c555f393740f22e30740bbc939df585762fafe7ae06945120dc5a99699d0c858`. Both transactions returned success. No records were rewritten or deleted.

The Vercel project serving `www.myorderlyapp.com` is **orderlyappp**, not the other similarly named projects. Production secret-variable entries for the Supabase service role, DeepSeek key and Canvas cron secret were verified present without revealing values. Code release `289ab6dc59cf7ff0daf7c77e277534c52dc224f4` was pushed to `main` and verified **Ready / Production / Current** with the public domain assigned in [Vercel deployment FGejDQvxR](https://vercel.com/coolguy46s-projects/orderlyappp/FGejDQvxR5X5w3b9DNmKAEtGUetK). All three connected Vercel commit statuses succeeded. **The audit also found older missing production migrations and owner-security configuration gaps; the whole security rollout is not yet complete.**

Baseline: `36bdf3a830775b0f3ff52da73ab337e6b1e79039`. Local rollback reference: `codex/pre-security-audit-2026-09-06`. GitHub's baseline commit statuses reported three successful Vercel projects. A successful Git push does not install SQL.

## What was inspected

Repository routes, browser stores, Supabase services and SQL migrations, installed authentication SDK behavior, Canvas loading/parsing, paid Assistant routes, settings/export/deletion, privacy text, configuration, dependencies, tracked files and Git history. Testing used synthetic accounts in an isolated PostgreSQL-compatible database, mocked provider requests, actual route modules with controlled dependencies, cookie-backed SDK fixtures, and local browser fixtures. No paid model requests, real-user record reads, live attack traffic, credential rotation or destructive cleanup were performed. Production inspection returned schema/permission metadata and invalid-reference counts only; the two explicitly approved additive migrations were applied.

## Sensitive-data inventory

| Data | Location / flow | Exposure boundary |
| --- | --- | --- |
| Email, name, avatar, profile and school preferences | Supabase Auth/profile; browser state | Own account; admin infrastructure remains privileged |
| Password and authentication sessions | Auth provider; SSR cookies; isolated recovery cookie; legacy browser storage | Passwords are not application database fields. Session/refresh tokens and PKCE material are credentials |
| Tasks, assignment descriptions, deadlines, subjects, completion | Account-owned SQL tables and local account-scoped caches | Private academic/workload data, including imported content |
| Events, recurring commitments, task schedules, planner blocks and preferences | SQL plus account-scoped browser persistence | Reveals routines, location/time availability and commitments |
| Goals, exams, study sessions, timer state and activity totals | SQL and browser stores | Private academic and behavioral data |
| Canvas calendar-feed URL | Owner-scoped integration record; server fetch; integration hook memory | Bearer credential: possessing it may grant access to the private school calendar. Settings shows a hostname rather than the full secret |
| Assistant messages and account planning context | Browser session storage; server builds provider DTOs; sent to DeepSeek when Assistant is used | Messages/descriptions may contain personal data. Saved action receipts can contain planning details and undo operations |
| Assistant usage and request metadata | Usage ledger and new service-only abuse lease table | User/request IDs, timing, model/token usage; lease table does not store prompts |
| Legacy study sets, flashcards, questions, uploaded study files | Legacy tables and private study storage paths | Sensitive contents remain relevant even when the UI is dormant |
| Legacy college/application, essay/resume, test-score and recommendation/contact data | Legacy models/tables where installed | Review retained dormant records as private data, not harmless unused schema |
| Friendship/competition records | Legacy tables; prior lockdown/owner policies | Relationships and identities; dormant social UI is not an authorization control |
| Deletion requests and worker state | Service-role-only durable queue and storage cleanup | User IDs, workflow status; queued is not the same as completed |
| Server/provider credentials | Environment configuration and Supabase Vault | DeepSeek key, service-role key and worker secret must never be public variables or browser payloads |

The publishable Supabase key is designed to be public; it is not a substitute for RLS. RLS/TLS do not establish that every field has application-level encryption. Feed URLs remain retrievable by their owner and the service. No new encryption key, recovery policy or rotation scheme was introduced without an operational design.

## Findings and repairs

Severity below is a prioritization of the affected boundary, not a claim that production was exploited.

| Finding | Evidence and impact | Repair / verification |
| --- | --- | --- |
| High: AI burst protection was per server process | A process-local map cannot coordinate multiple Vercel instances. Account quotas were not an authoritative server-only abuse gate | Service-role-only PostgreSQL leases across all three paid routes; existing configurable burst allowance defaults to 6/min, at most 2 concurrent. Browser RPC access denied. Failed attempts remain counted; no new daily/monthly product quota |
| High, confirmed live: privileged dispatcher retained direct client grants | Both live `anon` and `authenticated` had execute access to the privileged Canvas dispatcher. A fixture reproduced this allowing account-ID disclosure/job dispatch; no live invocation was attempted | Applied explicit revocation and verified both browser roles now denied, service role retained. Migration does not start/reconfigure cron jobs |
| Medium: incomplete ownership checks on parent references | Isolated authenticated users could create certain own rows referencing another user's planner commitment or legacy study parent. No cross-user content-read exploit was demonstrated | Transactional preflight plus ownership triggers for planner commitment, study-set exam, nested study records, linked task IDs and storage paths. Invalid existing references abort without rewriting/deleting rows |
| Medium: logout could finish visually before credentials were cleared | Cookie-backed installed SDK fixture reproduced a hanging remote sign-out leaving authentication cookies while the old UI timeout elapsed | Bound actual logout transport; SDK cleanup first, project-specific SSR cookie/chunk/PKCE and legacy-storage fallback, clear app state and fully replace document on fallback. Cleanup failure is explicit; remote revocation is not falsely promised |
| Medium: deletion reauthentication used an account-wide timestamp | A fresh sign-in on another device could refresh `user.last_sign_in_at` while the requesting session was old | Check verified JWT subject and recent authentication-method timestamp for this session; recovery/refresh-only evidence cannot authorize deletion |
| Medium: cookie mutation routes lacked a consistent origin/body gate | Source review found differing/unbounded JSON handling. No production CSRF exploit was attempted | Shared exact-origin and Fetch Metadata checks reject sibling/cross-site requests; stream-enforced UTF-8 JSON limits, body deadline, controlled status/errors. Actual route tests deny anonymous/expired/cross-origin callers before paid/privileged operations |
| Medium, conditional network risk: Canvas validation and connection were separate DNS decisions | Previous fetch re-resolved after address validation. The old provider-domain restriction limited practical exploitability; no arbitrary live SSRF was demonstrated | Pin the validated public address on the socket while preserving hostname/TLS validation. Revalidate every redirect/DNS answer; reject mixed/private/reserved results. Cap redirects, body and time; never forward browser authorization/cookies or a secret Referer |
| Medium: imported HTML could exhaust parsing | A synthetic roughly 42 KB input containing 6,000 nested anchors reproduced a stack overflow | Bounded nesting and shared parsing-work budget; inert text and safe links retained. Tests cover malformed/deep input, script markup, encoded content and credential-bearing links |
| Medium: raw errors could contain private values | Database/provider errors were logged as raw objects/messages in multiple application paths | Replace those diagnostics with narrowly recognized error codes/names; raw SQL details, feed URLs and tokens are not emitted by those log sites |
| Defense in depth: imported/pasted data mixed with model instructions | Untrusted titles/descriptions and client history can contain instructions; LLM interpretation alone is not an authorization boundary | Separate immutable system instructions from labeled untrusted data. Strip sensitive DTO fields and recognizable credentials/feed URLs. Keep owner/schema/atomic-save checks authoritative |
| Defense in depth: oversized paid/provider payloads and redirects | Request limits must apply to actual bytes, not a client-provided Content-Length. Redirects must not forward a provider key | Bounded incoming JSON, 512 KiB provider context and 128 KiB reply cap, no redirect following, cancellation/time budgets. Oversized context errors explicitly; it does not silently omit assignments |
| Privacy correctness: chat caches and deletion/AI wording | Chat session storage was not included in account cleanup. Privacy text said approval previews were always mandatory; Settings labeled queued deletion as done | Clear account-scoped session storage on logout/switch; approved factual AI payload/direct-save disclosure; distinguish queued cleanup from confirmed completion |

AI redaction is a defense in depth, **not a promise to recognize every secret or prevent all prompt injection**. An authenticated user can still submit deceptive text. Server authorization, ownership validation and atomic database writes remain the real boundary. A per-account burst limit cannot prevent every multi-account abuse campaign or guarantee a spending ceiling.

## Verification

- Final `npm test`: passed, including **49 security tests** (real SQL, actual API route modules, Canvas network mocks, cookie-backed logout and request guards), after the interrupted-request recovery refinement.
- Assistant regression suite: **140 tests passed**, including legacy DeepSeek coverage. Interrupted requests can retry their stable action ID after the 90-second attempt expiry, with a new lease/accounting ID; previous attempts remain recorded and existing receipts prevent duplicate paid calls/saves.
- Database security suite: **16 isolated tests passed**, including 25 account-owned tables, cross-account CRUD/references, anonymous denial, service-only jobs, migration rerun/preflight rollback, stored functions, task completion, retry recovery and synthetic-account deletion cascade.
- Logout: 7 cookie-backed SDK tests passed; no claim of immediate revocation of already-issued JWTs on every device.
- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm run build -- --webpack`: full optimized production build passed. Default `npm run build` was attempted twice, including elevated execution, and failed at Turbopack's local subprocess/port binding with `Operation not permitted`. No production build setting was changed to hide that environmental limitation.
- `npm run test:calendar-ui`: actual calendar/editor browser fixture passed (navigation, recurrence, click/drag/resize, persistence and refresh). External requests blocked.
- `npm run test:tutorial-ui`: passed; full tour/replay, isolated progress, Canvas guide, keyboard and responsive layouts, with external requests blocked.
- `npm audit --json`: **0 known dependency vulnerabilities** at the time of the network-backed check. This is not proof that dependencies have no undisclosed vulnerabilities.
- Local secret-pattern scan of staged/tracked source, Git history and production client bundles: **0 matches** at the final staged check (94,515 scan units; the scanner mixes files and history-line units). The scanner only prints categories/locations, never the matching secret. Pattern scans can miss unfamiliar credentials; no secret was rotated.
- Read-only live HTTPS check of `https://www.myorderlyapp.com/landing`: HTTP 200 with existing HSTS, frame denial, nosniff and permissions/referrer headers. Baseline Vercel commit statuses were successful. These checks **do not verify the new code, live RLS, service-key scope, storage ACLs or scheduler health**.
- Post-release live smoke (no credentials or paid calls): landing/privacy/login returned 200; the approved new privacy wording was visible; auth pages returned `no-referrer` and private/no-store caching. `/tasks` returned its public app shell with CSP, not an authenticated data response. Anonymous conversation POST, Canvas summary GET and account DELETE all returned **401**; cross-origin conversation POST returned **403**. These checks verify deployed denial paths, not a live authenticated paid-model/import/deletion workflow.

## Rollout runbook

1. Confirm the intended Supabase project and the Vercel project actually serving the public domain. Do not paste keys or feed URLs into chat, terminal output or commits.
2. Review a restorable backup and `docs/security-preflight.sql` metadata/count-only results. Investigate invalid-reference counts privately; do not print rows or automatically repair them.
3. Apply the approved `security-boundaries-migration.sql` in its own transaction. It aborts on inconsistent references; do not remove the guards to force completion. Re-run the read-only preflight and confirm client job execution/schema creation is denied while the configured worker role still works.
4. Apply the approved `assistant-abuse-guard-migration.sql`; confirm RLS/service-only grants and functions using the metadata preflight. It adds operational metadata, not a user-visible token quota. Do not run `schema.sql` against an existing installation.
5. Verify `SUPABASE_SERVICE_ROLE_KEY` exists **server-side** in the correct Production Vercel environment (already required for Canvas/deletion). Do not create a `NEXT_PUBLIC_` version. Existing DeepSeek key/model settings are preserved. Confirm `AI_ASSISTANT_ENABLED` and the existing per-minute configuration intentionally match the desired deployment.
6. Only then merge/push the tested release to the production branch and wait for the corresponding deployment to become ready. Confirm the public alias resolves to that deployment, not merely a preview URL. A preview connected to production Supabase is not an isolated security sandbox.
7. Run anonymous live route/header checks, then a controlled test-account login/logout/calendar/Canvas/deletion smoke. Do not delete any real user's account. Paid AI smoke needs explicit authorization; the local suite uses provider mocks.
8. Check redacted server diagnostics, lease/RPC errors and worker status without printing secrets/content. Confirm unauthorized job/RPC access is denied, normal scheduling/import works and security unavailability is not being silently bypassed.

The pre-security Git reference can restore code, but restoring it would also restore the weaknesses repaired here. The additive migrations do not delete existing records; they should not need reversal for a code rollback. Any production rollback that changes security ACLs or data requires deliberate review, not automatic table/trigger deletion.

## Remaining risks / unverified areas

- **Confirmed older deployment gaps:** `account_deletion_requests` and its dispatcher are absent; `canvas_provider_request_limits` is absent; dormant competition/participant tables still have unconditional SELECT policies; profiles retain an unconditional INSERT policy. Their existing repository hardening migrations were not part of the two approvals and were not applied. Review/approve the missing rollout separately, including the profile migration's existing-counter recalculation and any worker activation. An RLS-enabled flag alone does not make an unconditional policy safe.
- All observed application tables had RLS enabled. Seven new ownership triggers are enabled, all seven ownership preflight counts were zero, the AI lease table denies client CRUD, and both lease RPCs/Canvas dispatcher deny anonymous and authenticated execution while allowing the service role. Full production two-account behavior was not exercised. The named `study-materials` bucket was absent, not proven public or private. Other Storage buckets/policies and cron/Vault health remain unverified.
- **Owner steps:** Vercel displayed a single-factor-login warning (no MFA was disabled or configured); Supabase showed no backups on its project overview (no external backup was ruled out). Verify/enable administrator 2FA and a restorable backup strategy. Vercel also flags `GOOGLE_CLIENT_SECRET` as a Config variable; review secret classification and rotation privately. No value was revealed or rotated, and classification alone is not proof of a browser leak.
- The export button exports a fenced/reset **core browser snapshot**, not a complete server-side account export. It can omit events, planner settings, receipts, integration metadata or data not yet loaded. No cross-account leak was demonstrated. A complete export endpoint is a separate functional/privacy-access improvement.
- Account deletion is a durable queue; production worker progress must be verified. This audit does not promise instant erasure of provider backups/logs or data already sent to a third party.
- Exceptional logout fallback was tested in one browser context, not a concurrent-tab/device refresh race. Normal SDK sign-out broadcasts; already-issued access tokens and remote sessions retain provider-defined semantics.
- Existing application and provider retention policies, receipt/usage metadata growth, logging retention, DeepSeek processing terms/regions, age/consent requirements and the support mailbox need an owner review. No retention period, no-training guarantee or legal-compliance certification was invented.
- Canvas school custom domains are supported through address-pinned HTTPS validation. This was fixture tested, not tested against every school deployment/proxy/network.
- No new CAPTCHA, paid WAF, global spending cap, field-encryption service, forced MFA or artificial restrictions on normal planning were added.

## Reference basis

Installed Next.js data-security/CLI guides and installed Supabase Auth/SSR source were checked for current behavior. External primary guidance used:

- [Supabase server-side client guidance](https://supabase.com/docs/guides/auth/server-side/creating-a-client) and [advanced session/caching guidance](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
- [Supabase JWT authentication method fields](https://supabase.com/docs/guides/auth/jwt-fields) and [user fields](https://supabase.com/docs/guides/auth/users).
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [API security](https://supabase.com/docs/guides/api/securing-your-api).
- [OWASP CSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html) and [SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).
