# UI cleanup — September 2026

## Scope and checkpoint

Presentation only: Calendar, Schedule, Assistant, task/event forms, and task details.
No AI/provider, quota, tutorial, onboarding, database, deadline, recurrence, or integration changes.
Dashboard and other screens retain their existing layout; shared scheduler/editor polish also appears wherever those components are used.

Pre-cleanup checkpoint: `codex/pre-ui-cleanup-2026-09-07`

Starting commit: `517f04f1b94839af62476fc90e1cc16c25536e7f` (includes the natural calendar-removal fix).

## What changed

- Calendar toolbars have fewer enclosing boxes, consistent view tabs, and more readable labels.
- Schedule instructions are available under **Schedule tips**. Untimed remains visible on mobile. Grid labels start at the top of their blocks; drag/resize controls remain accessible.
- Assistant no longer adds a second layer of page padding. Chat uses a shorter, viewport-aware panel; the composer stays outside the scrolling transcript.
- **Undo last chat change**, request recovery, and **New chat** are together in the chat header. Calendar Undo remains with the calendar. **Today** is in the active calendar's date toolbar.
- The optional Assistant task sidebar is labeled **Day details**. The calendar collapse, expand, view, and date controls remain available.
- Task/event forms are wider on desktop, with quieter labels and sections. **Add description** expands the optional field; existing descriptions open automatically. Collapsing it does not discard text.
- Schedule fields stay available separately from deadlines. On phones, related time inputs share a row, and the footer keeps save/cancel reachable.
- Task details have lighter metadata panels, readable long descriptions, a keyboard-scrollable body, and a clear completion action.

## Verification and feature preservation

The browser fixture renders real UI components with synthetic stores and mocked network responses. It never accesses or edits production user data and makes no paid AI calls.

| Workflow | Coverage |
| --- | --- |
| Month/week navigation, arbitrary future dates, view switching | Existing browser workflow retained |
| Empty-slot creation, recurring task/event editing, save/reload | Existing browser workflow retained |
| Event drag/resize and occurrence removal | Existing browser workflow retained |
| Assistant input/date continuity, saved result calendar navigation | Existing browser workflow retained |
| Calendar collapse/expand and Day details | Browser interaction assertions |
| Description disclosure, value preservation, existing imported text | Browser interaction assertions |
| Imported task editor from the scheduler; task-detail completion action | Browser interaction assertions against synthetic stores |
| Long descriptions, mobile/laptop footers, chat composer, tips | Viewport assertions and screenshots |
| Existing task completion/persistence, deadline, recurrence and AI behavior | Repository regression tests |

Reproduce the rendered checks with `npm run test:calendar-ui` and a Playwright installation supplied through `ORDERLY_PLAYWRIGHT_MODULE` if it is not locally installed. Set `ORDERLY_UI_SCREENSHOT_DIR` to an output directory to capture the review images. TypeScript, lint, and production build are separate checks.

Local review artifacts from this run:

- Before: `/tmp/orderly-ui-before-editor.png`, `/tmp/orderly-ui-before-assistant.png`.
- After: `/tmp/orderly-ui-cleanup/` (desktop, laptop, mobile, light/dark, and long-content views).

These temporary image files are review artifacts, not a production dependency or a durable backup. The Git checkpoint is the rollback source.

## Reverting only the cleanup

The cleanup is committed separately from earlier fixes. If the owner requests rollback, first inspect the current working tree and any later changes, then use a new `git revert` commit for the UI-cleanup commit identified in the handoff. Resolve later overlapping UI changes deliberately. Test, push, and verify production again.

Do not reset shared history or restore the entire old checkout over newer work. No data migration is involved; reverting this UI commit does not remove assignments, events, chat history, or the earlier removal fix. Keep the checkpoint branch available on the remote.

## Deployment

Use the existing Git/Vercel production workflow. Verify the exact cleanup commit's successful production deployment and inspect the real custom domain. A successful push or a local fixture screenshot alone is not evidence of live deployment. The final handoff records the deployed commit and checks actually completed.
