# Orderly tutorial

## Entry points and scope

- Main app header: **Help and tutorial**, the question mark immediately left of the profile menu.
- Dashboard: a dismissible, non-modal invitation for accounts that have not opened or dismissed this version of the guide in this browser.
- Settings → Integrations: **Canvas connection guide**, available before and after connecting.
- The final tour section embeds the same `CanvasGuide` component. Essential `/setup` account setup is unchanged.

The guide has 12 sections covering Dashboard, Tasks, task creation/editing,
events/recurrence, Task Calendar, Schedule, Assistant, Goals, Study, Exams,
Settings/Profile/search/mobile navigation, and Canvas. It provides a section
menu, Back/Next, Skip/Close, resume, restart, completion, and links to actual pages.

This is instructional UI only. It never calls an AI service or mutates a task,
event, integration, schedule, or account setting. There are no quotas, migrations,
provider changes, or business-rule changes in this release.

## Content and assets

`components/tutorial/sections.ts` contains the section copy and destinations.
`components/tutorial/CanvasGuide.tsx` is the shared Canvas source of truth.
Screenshots are real current components with fictional Alex Morgan data, fixed
to September 7, 2026. See [screenshot reproduction](tutorial-screenshots.md).
The walkthrough contains no private data or feed URLs. Images load lazily and
have descriptions and full-size links. The Canvas steps outside Orderly are
text instructions, not a fabricated Canvas screenshot.

## Persistence and accessibility

Only tutorial progress is stored, under the account-scoped
`orderly-tutorial-v1:<encoded-user-id>` localStorage key. Progress is local to this
browser, not synced across devices. Unknown or corrupt sections are discarded.
Blocked browser storage does not prevent use; reopening after a reload may
restart progress. Switching accounts remounts the tutorial session.

The modal uses Radix focus trapping, Escape, focus restoration, an accessible
title/description, a progress bar, and fixed navigation controls. Mobile has a
native section picker; desktop has a scrollable section rail. The tutorial has
no animated transitions and works with reduced-motion preferences.

## Verification

```sh
npm run test:tutorial
ORDERLY_PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright npm run test:tutorial-ui
```

The real-component browser test uses synthetic stores and rejects external or
mutating requests. It verifies actual Header placement, every section and asset,
navigation/replay, account-scoped persistence, focus, blocked/corrupt storage,
unchanged account data, and 320px/390px/1280px layouts in light/dark themes.
Set `ORDERLY_TUTORIAL_SCREENSHOT_DIR` to a temporary directory for UI captures.

Also run the existing `npm test`, `test:calendar-ui`, TypeScript, lint, and a
production build. Deployment verification must check the custom domain’s
delivered tutorial bundle and WebP assets, not only Git push status.

## Rollback

Before tutorial work, branch `codex/pre-tutorial-2026-09-07` was created at
`e77e8dc1a1fc0d9d10d400e7130ebae6f62de78a` (the verified UI cleanup).
To roll back, revert the tutorial delivery commit with a new Git commit, test,
push, and verify the deployment. Do not reset history or erase unrelated work.
The prior cleanup and all earlier functional repairs remain intact.
