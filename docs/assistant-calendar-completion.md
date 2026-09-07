# Assistant calendar completion

This is the follow-up to `cfcf1a3`. That commit improved week navigation and recurrence but did not embed the main Task Calendar inside Assistant.

## Delivered

- Assistant now opens with **Task Calendar / Schedule** tabs using the same tab component as the main Calendar page. Task Calendar reuses the real month/week component, including its task/event editor, repeat controls and removal actions. The existing weekly schedule retains drag, resize and empty-slot creation.
- Both Assistant views share the selected date. Month/week arrows and day selection carry through view switches, creation defaults and Today. Switching views preserves the chat draft and the selected month/week mode.
- Chat receives a validated selected date separately from the current time. The model is instructed to use it only for references to the selected day/week. Confirmed saves open Schedule at the affected date after refreshing saved data.
- Recurring changes that actually modify weekdays, recurrence or the repeat end condition are recognized as series edits when the model omitted the redundant scope flag. Explicit occurrence scope is never broadened; copied unchanged repeat settings do not authorize a series-wide rename. Genuine ambiguity still asks a scope question.
- Scope validation feedback tells the model to retain a scope the user already confirmed. User-facing scope errors no longer expose internal field names.

## Verification

- The Chromium fixture mounts the actual `Planner`, `TaskCalendar`, `ScheduleCalendar`, `WeekTimeGrid` and `TaskForm`. Only data/network boundaries are replaced. It exercises cross-month/year navigation, view selection, keyboard tabs, creation, event/occurrence editing, saved data after refresh, drag/resize, mobile sizing, chat draft preservation, selected-date request context and a mocked confirmed-save response.
- PostgreSQL/PGlite tests check the actual saved repeat weekdays, title, times and anchor, plus the ambiguity/single-occurrence safety boundaries.
- Run `npm test`, `npm run test:calendar-ui`, `npx tsc --noEmit`, `npm run lint`, `npm run build -- --webpack`, and `git diff --check`.

## Limits

No production assignments were used for testing. No paid DeepSeek requests were made; the live provider's wording/interpretation is not certified by the deterministic tests. Existing bounded AI planning and recurrence limits described in `assistant-calendar-local-review.md` remain. No model, billing, authentication or database schema changes were made.

This document describes the implementation, not deployment status. Deployment must be verified separately after an approved push.
