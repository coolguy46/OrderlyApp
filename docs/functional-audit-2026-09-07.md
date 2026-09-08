# Orderly functional audit — September 7, 2026

Status: all six audit steps completed; repairs pushed and verified live on September 7, 2026 (Pacific time).

Baseline: `1478c7defc16d21f7c3ed710fbd1f525b2ffbff4`, clean `main`.
Code recovery checkpoint: `codex/pre-functional-audit-2026-09-07`.
Verified production: `coolguy46s-projects/orderlyappp`, `www.myorderlyapp.com`.
Do not treat a local edit, commit status, or existing report as live verification.

## Plan

1. Establish baseline, recovery point, and feature inventory.
2. Inspect workflows and reproduce broken/incomplete behavior.
3. Implement focused repairs with regression tests.
4. Exercise synthetic browser workflows, mobile layouts, and failure recovery.
5. Run comprehensive checks and review the integrated changes.
6. Push, verify the correct live deployment, and record remaining limitations.

## Feature checklist

| Area | Status | Evidence / gaps |
| --- | --- | --- |
| Auth, sessions, account switching, onboarding | Reviewed; synthetic workflows verified | Real StrictMode guard with deferred signed-out/signed-in/incomplete-setup/error outcomes; session, logout, password-reset and account-fence suites. Real Google consent/email delivery not exercised. |
| Dashboard, tasks, completion and statistics | Reviewed; regression verified | Today/missing/preparation-day rules, completion/recurring successor transactions, midnight/timezone indicators, owner-scoped loading; collection reads tested with 1,007 records. |
| Calendars, events, scheduling and recurrence | Repaired; browser and persistence verified | Real components with synthetic saved-state boundaries: empty-slot creation, click/keyboard editors, month/week navigation, recurrence exceptions, drag/resize, deadline preservation, reload, overnight/DST and failed saves. |
| AI conversation, planning and saved actions | Repaired; mocked-provider and isolated-DB verified | Actual compiler, authenticated route, atomic PostgreSQL actions, receipt/Undo recovery, multiple operations, corrections, dates beyond a week, ownership, overnight conflicts. Paid provider language quality not live-evaluated. |
| Canvas setup and foreground/background sync | Repaired; synthetic provider/hook verified | Feed validation, lease/throttle/concurrency, incomplete-feed cleanup protection, user scheduling/completion preservation; real hook with database transport errors, timeout/abort, recovery and account switches. No real private feed or forced sync used. |
| Goals, exams and study timer | Reviewed; browser/unit verified | Goal creation/progress/completion/failure/reload, exam edit/preparation/reload, timer clock/recovery/duplicate-session protections, global sound preference. |
| Settings, preferences, export and deletion | Repaired; browser/route/DB verified | Name edits, availability save failures, effective reminder switches, fresh export/download/account fencing; actual deletion route/job logic exercised only with isolated fixtures. No account deletion performed. |
| Landing, tutorial/replay and integration guide | Reviewed; browser and public smoke verified | All 12 tutorial sections, replay/header help, images, Canvas guide, phone/desktop and keyboard checks; factual manual-exam instruction corrected. |
| Shared navigation, dialogs, mobile and keyboard access | Reviewed; representative browser verified | Phone overflow assertions, reachable editor controls, continuation keyboard activation, modal/source contracts, error states. Not an exhaustive browser/device certification. |

## Issue ledger

Confirmed issues only; no speculative bug counts.

| ID | Severity | Finding / evidence | Repair | Verification |
| --- | --- | --- | --- | --- |
| F01 | High | AuthGuard's one-shot effect ref cancelled its only auth-completion observer under StrictMode; reproduced infinite loading. | Observe the store-deduplicated promise for each effect lifecycle. | Pre-fix browser failure; four after-fix auth/setup outcomes pass. |
| F02 | High | Five core collection services requested only the first database page, silently omitting older account records. | Owned, abortable ID-keyset pagination; preserve display ordering; later-page failure rejects strict hydration. | Actual service tests load 1,007 records with a lower simulated provider cap; foreign rows/error paths rejected. |
| F03 | High | Overnight task/event occurrences were missing from next-day/week displays and AI busy facts; dashboard geometry overflowed the day. | Expand source dates in the appropriate event/view timezone, intersect visible intervals, clip day geometry. | Interval tests, real calendar browser navigation, isolated DB planning around overnight events and cross-timezone examples. |
| F04 | Medium | Event form allowed nonexistent DST end times, saving an event that could not render. | Validate both interval endpoints before saving. | Invalid DST end rejected, corrected end saves in browser. |
| F05 | Medium | Disabled drag attributes marked non-draggable but editable continuation blocks disabled to keyboard tools. | Attach drag attributes only to actual draggable blocks. | Overnight continuation keyboard opens original task/event editor. |
| F06 | High | Stale Undo's terminal 409 permanently locked chat; uncertain Undo could be reported as a definite rejection. | Distinguish terminal rejection from retryable uncertainty and keep exactly-once IDs until receipt recovery. | Real route with lost-response/receipt tests and UI state contracts. |
| F07 | High | AI event-series edits overwrote cancelled/moved occurrences, location/color/enabled state; metadata edits could change timezone. | Preserve existing metadata and exceptions when applying edits. | Reproduced override loss in isolated PostgreSQL; saved-state regressions pass. |
| F08 | High | Canvas settings read errors appeared disconnected; initial settings reads could hang without a deadline. | Strict, abortable bounded reads; single-flight polling; preserve known connection; account/mutation fences and specific recovery. | Real React hook/service with synthetic transport tests covers hang, failure, retry, error isolation and account switch. |
| F09 | Medium | Notification switches had no consumers and global sound preference did not mute the timer. | App-open reminder engine, explicit desktop-permission button, account-local deduplication/preferences, global timer mute. Coalesce scans and bound toast content. | Nine helper tests and real browser delivery/preferences/reload/owner tests. |
| F10 | Medium | Settings initialized an already-loaded profile name to blank, risking accidental erasure. | Initialize and refresh draft from the account-bound profile. | Browser opens Settings with existing name and switches accounts. |
| F11 | Medium | Availability Save announced success before remote persistence. | Await existing persistence queue; report pending/failed save truthfully. | Browser failure produces no success; retry succeeds. |
| F12 | High | Profile dialog discarded failed name edits and could expose/reuse an old-account draft after switching accounts. | Preserve failed drafts, bind editor/save to its owner, clear/hide on switch, ignore obsolete responses. | Browser failure/retry/reload and switch-while-editing regressions. |
| F13 | Medium | Export downloaded potentially stale/partial browser cache and omitted saved events/plans. | Verified-session, allowlisted, paginated server export; all-or-error, no secret feed/auth fields, no caching; client discards old-account responses. | Route/security/page-cap/schema tests plus real browser downloads, failure and account-switch tests. |
| F14 | Medium | Scheduler drag/resize/untimed actions announced success before durable save. | Preserve optimistic display; confirm existing persistence queues before success; show pending errors and suppress stale-account feedback. | Five helper regressions and actual browser failed/successful task/event saves with reload checks. |
| F15 | Medium | Browser-only legacy event adapter swallowed storage failures, allowing false saved messages. | Check explicit write results at every caller; preserve failed Undo retries/original copies; warn when durable-save cleanup fails and prefer saved events over retained legacy duplicates. | Storage-denied/backup-retention/deduplication regressions and browser legacy-edit checks. |

Additional maintenance (not inflated into functional bug counts): corrected the tutorial's nonexistent manual-exam time-field claim; changed `npm test` to discover all non-browser suites and `npm run test:browser` to discover browser fixtures. Fixed three obsolete assertions/loader failures exposed by previously omitted suites without weakening expected behavior.

## Safety and test boundaries

Synthetic local fixtures and mocked providers only for mutating workflow tests.
No paid model calls, real-account deletion tests, private feed reads, credential
rotation, or production database mutations without the required approval.
Existing security protections must remain intact. Provider/MFA/backup owner
steps from the earlier security report are not implicitly resolved by this audit.

## Final verification and release

- Original baseline `npm test`, lint and TypeScript passed, but the old aggregate omitted existing suites.
- Final expanded integrated run: **499 tests passed, zero failed/skipped**, including isolated PostgreSQL security and save/rollback tests. `npm test` discovers 71 non-browser test files.
- Final production webpack build, lint and TypeScript passed. The secret pattern scan reported **zero potential credential locations**; it does not prove the absence of every possible secret.
- All **five grouped browser journeys passed**: calendar/grid/editor, AuthGuard, Canvas settings, Settings/goals/exams/profile/reminders/export, tutorial/header. Browser fixtures require loopback-server permissions; their initial sandbox-only run was denied, then the authorized run passed. They block outside requests and use only synthetic accounts/data.
- Synthetic screenshots captured for desktop/laptop/phone, dark/light, task/event editors, Assistant, calendar and tutorial. Manually inspected imported-task editor, phone Assistant, phone event form and narrow Canvas tutorial: controls remain reachable, descriptions are readable, and no new horizontal clipping was observed.
- Revalidated baseline Vercel deployment `3xbmu7ob5QNX2FBEEfCwrny2bNGw`: Ready, Production Current, source `1478c7d`, domain `www.myorderlyapp.com`.
- Baseline public landing/auth-login/privacy/terms returned 200 and the expected Orderly title. This alone is not functional verification.
- No production database migration is needed for these repairs.
- Pushed repair commit: `5143f1fcd15c92d44d51ebf038832e845f8a79ef` on `main`.
- Verified release: [Vercel deployment 6mfwCSGfHdhypAiHwzHZRr9Lp9Yv](https://vercel.com/coolguy46s-projects/orderlyappp/6mfwCSGfHdhypAiHwzHZRr9Lp9Yv). Dashboard showed **Ready / Production / Current**, source `5143f1f`, and assigned domain `www.myorderlyapp.com`; the correct `Vercel – orderlyappp` commit check succeeded. Verification time: September 8, 2026, approximately 00:37 UTC.
- Signed-out post-release checks: `/landing`, `/auth/login`, `/auth/register`, `/privacy`, `/terms`, and the `/tasks` guard shell returned 200 with the expected Orderly title and private/no-store cache directives. The protected task shell includes CSP; its HTTP 200 does not establish authenticated access or render private data. `/api/account/export` returned **401** and `Cache-Control: private, no-store`, demonstrating the new route is deployed and denies anonymous export. A check of `/login` returned 404 because the existing login route is `/auth/login`; no alias is advertised or required.
- This report-only follow-up does not change the tested application code. It records the verified repair release above; any subsequent deployment of this documentation has identical application code.

Confirmed functional issues repaired: **15**, grouped by root cause in the ledger (not by every affected screen). No known reproduced functional issue from this ledger is being deferred. The limitations below remain; these checks do not establish that every possible bug is gone.

## Limitations and recovery

- Reminders run while Orderly is open/visible; there is no closed-app delivery service. Preferences/deduplication are device-local and cross-tab delivery deduplication is best effort.
- Export represents saved data read over a time interval, not one atomic database snapshot or an importable backup. Unsaved/browser-only data, credentials/private feeds and internal security/job records are excluded. Oversized exports fail explicitly rather than truncating (3.5 MB data budget).
- Real Google sign-in/email delivery, real user mutations, paid DeepSeek responses and forced production Canvas/account-deletion jobs were deliberately not tested. Automated provider responses are mocked; database invariants also run against isolated PostgreSQL.
- Existing preparation-day policy remains unchanged. Deliberately overlapping blocks can still overlap visually; keyboard access is verified, but a collision-layout redesign is outside this repair pass.
- Earlier owner-controlled MFA/backup/provider settings are not implicitly resolved by this audit. No credentials were rotated or retention policies changed.
- Code recovery checkpoint: `codex/pre-functional-audit-2026-09-07` at `1478c7defc16d21f7c3ed710fbd1f525b2ffbff4`. Revert the audit release commit(s) or restore the prior Vercel production deployment, then verify the domain. Do not reset over unrelated work. A code rollback does not restore user records; this audit makes no production database schema/data migration requiring reversal.
