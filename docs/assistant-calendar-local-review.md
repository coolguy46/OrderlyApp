# Assistant calendar changes — local review

Pre-push review snapshot: implemented and tested locally. At the time of this review, the changes had not been committed, pushed, or deployed. No production assignments were changed and no paid AI requests were used for these checks.

## Already working

- Both schedulers already used the same week grid and supported week arrows. Recurrences were already stored as series definitions and expanded for the visible dates.
- The shared grid already separated clicks from drag/resize gestures. Tests now exercise that behavior in a real browser.
- Authenticated, owner-scoped database writes, atomic saves, duplicate-request receipts, completion, and original assignment deadlines remain in place.

## Confirmed fixes

- Assistant arrows now move the selected day with the visible week. Both schedulers share this navigation calculation. Creation defaults follow the viewed/selected date.
- Month/week Calendar events and Dashboard schedule events now open the existing Task/Event editor, as do the shared schedulers. Generated school blocks explain that their hours are managed in Settings.
- Repeating item editors use the clicked occurrence's actual date and time, including occurrences previously moved to another week. A small scope selector distinguishes one occurrence from the whole series.
- One-occurrence title/description/time edits no longer rename or move the entire series. Event location edits and occurrence removal are also scoped. Type/color and repeat-rule controls belong to the event series. Task status/deadline/repeat controls belong to the task series; existing completion behavior is unchanged.
- Task and event forms expose an optional repeat end date. Untimed tasks retain their repeat days and end condition. The deadline calendar uses shared recurrence expansion rather than hiding future repeats behind an overdue original date; it also shows scheduled tasks that have no deadline.
- The active conversational code path no longer clamps plans to 14 days or rejects exact dates beyond the next year. Three-week requests remain 21 days throughout planning and persistence.
- The AI can request one read-only lookup of the relevant calendar range before answering. Browser-only legacy event definitions are supplied as constraints instead of dropping their occurrences after 60 days.
- Conflict validation checks actual target ranges, including moved occurrences and overnight neighbors, instead of expanding every day between today and a far-future date. Recurring series can be extended without moving their original start date. Confirmations include recurrence details and navigate to the actual saved occurrence date.

## Verification

- `npm test`: 324 tests passed, including new PostgreSQL/PGlite integration cases that run the actual compiler, planner, save transaction, and reloaded calendar data.
- `npm run test:calendar-ui`: real Chromium interaction test passed with controlled fixture stores and local-only requests. Covers month/week navigation, future-slot creation, event and task occurrence editing, whole-series edits, removal, drag/resize suppression, reload, and mobile editor sizing.
- `npm run lint`, `npx tsc --noEmit`, `npm run build -- --webpack`, and `git diff --check` passed.
- Data regression cases cover 21-day plans, far-future conflicts, selected weekdays, month-end recurrence, daylight-saving offsets, end dates, moved occurrences beyond series bounds, ambiguous edit scope, authentication/ownership, transaction rollback, completion/deadline preservation, and retry deduplication.

The browser test requires Playwright and Chrome. If Playwright is supplied by a bundled runtime instead of this repository, set `ORDERLY_PLAYWRIGHT_MODULE` to its module path before running `npm run test:calendar-ui`. The fixture replaces storage/network boundaries, not calendar/editor components. Optional `ORDERLY_CALENDAR_SCREENSHOT` saves a local fixture screenshot.

## Explicit limits and unverified areas

- One plan or calendar lookup can span **1–366 days**. An exact date may be farther in the future. Longer planning windows are rejected clearly, not silently shortened.
- An unbounded/longer recurring series continues beyond the conflict-check window. The saved confirmation states the date through which conflicts were checked (up to 366 days from the relevant series start/current date). Later occurrences are generated when their dates are viewed; this is not a promise that an infinite future is conflict-free.
- Existing 60-write transaction, 12 explicit-operation, and account-context capacity guards remain. Dense expansions over 10,000 occurrences request a shorter range.
- Supported patterns remain daily/weekly/monthly for tasks and selected weekdays for events (all seven days means daily). Monthly event recurrence and converting repeating series between task/event types were not added.
- DeepSeek responses were mocked for deterministic regression testing; no new paid-provider smoke test was run. Production authentication and deployment were not exercised. Review locally before explicitly approving a push/deployment.
