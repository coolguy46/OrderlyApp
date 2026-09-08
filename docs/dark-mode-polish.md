# Dark-mode polish after the UI redesign

Baseline / rollback point: `ea0cfe98f9e985ab4d2c9976754ce893dcd83808`.
The baseline redesign is now on main and production, approved by the user.

## Actual 21st usage

- Retrieved [Stats Card by ravikatiyar162](https://21st.dev/@ravikatiyar162/components/stats-card-1), demo 8321, using the connected 21st MCP.
- Adapted its title/icon, prominent value, and supporting-description structure into `components/ui/stat-card.tsx`, used by Dashboard, Tasks, and Exams. Kept real counts, labels, and the Missing link. No demo trend percentages, fake data, or new runtime dependencies.
- Retrieved [Violet Dusk by serafimcloud](https://21st.dev/community/themes/violet-dusk). Used its violet-tinted dark surface/accent direction for shell/navigation and selected controls, not a wholesale token replacement.

## Boundaries

- Added stationary blue/violet atmosphere to the app shell, landing and auth frames; accented the sidebar's current page, primary buttons, selected tabs, and summary cards.
- Dark-only rules preserve the light palette. The shared summary-card layout applies in both themes.
- No changes to global dark card/background/primary tokens or task/event fill formulas. Calendar, WeekTimeGrid, DashboardSchedule, and UntimedTaskShelf implementations remain unchanged. No animated glows, pointer-following effects, or decorative elements covering controls.
- No auth, API, database, AI, task state, date, recurrence, scheduling, or persistence changes.
- Tutorial images use the existing consistent fictional dataset, never account data.

## Verification

- All 502 unit/integration tests, lint, TypeScript, production webpack build, and calendar interaction regression passed.
- All 76 isolated real-page/theme/viewport combinations and shell interactions passed (178 seconds); no external API or account mutations.
- Added regression coverage for muted calendar fills and scoped accent styling, plus browser contrast/presentation assertions.
- Visually reviewed Dashboard, task Schedule, and Tasks in desktop dark/mobile dark/desktop light using synthetic screenshots.

To undo only this polish, revert its release commit. No data rollback is needed.
