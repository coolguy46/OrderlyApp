# 21st-inspired UI redesign

Branch: `codex/21st-ui-redesign`

Starting point: `83e8d5009cfa4cc9dc5cbea50b072aba08548b46` on `main`.

## Design direction

Used the connected 21st MCP to search design references and retrieve the
[Dashboard Sidebar by arunjdass](https://21st.dev/@arunjdass/components/dashboard-sidebar).
Adapted its grouped-navigation and restrained dual-theme workspace approach
to Orderly's existing components. No demo account menus, billing cards, mock
actions, or external component-runtime dependencies were added.

The new system uses charcoal/alabaster surfaces, one restrained indigo accent,
semantic colors for task status, consistent page headings, solid panels,
quieter toolbars, and clearer forms. It replaces broad decorative gradients,
glows, glass panels, and oversized repeated visual treatments. Existing subject
and event colors remain meaningful.

## Page coverage

| Route / surface | Changes |
| --- | --- |
| Dashboard `/` | Overview heading, compact status summary, task-first layout, dedicated mini calendar, goals/exams panels and compact quick actions. |
| Tasks `/tasks` | Neutral stats, grouped search/filter toolbar, quieter task rows and retained status/schedule metadata/actions. |
| Calendar `/calendar` | Shared page hierarchy, view tabs, framed navigation, clearer month/week/schedule grid and untimed shelf. |
| Assistant `/planner` | Separate chat and calendar panels, calmer conversation bubbles/composer, clear expandable calendar controls and empty-state prompts. |
| Goals `/goals` | Consistent heading, goal cards, progress summaries and creation/editing surfaces. |
| Study `/study` | Focus timer + daily progress workspace, quieter timer controls, separate pending-task list. Both game visuals remain. |
| Exams `/exams` | Neutral overview and cards with readable urgency, preparation controls and editor. |
| Settings `/settings` | Section jump links and clearer label/content grouping; all existing account, availability, notification and privacy actions remain. |
| Integrations `/settings/integrations` | Framed Canvas configuration, connection state, help and sync controls. |
| Profile `/profile` | Cleaner identity, counters, editing and settings link. |
| Landing `/landing` | Concise editorial hero and explicitly fictional code-native day-plan illustration. |
| Login, registration, forgotten/reset password | Shared responsive auth frame, quieter forms, preserved error/loading/recovery states. |
| Setup `/setup` | Desktop step rail and mobile step presentation, preserving all five setup steps. |
| Privacy and Terms | Readable editorial layout and navigation; legal text is unchanged. |
| Tutorial / Canvas guide | Refreshed help hub, steps and controls; all 12 synthetic screenshots regenerated from the redesigned real components. |
| Shared navigation / dialogs | Grouped collapsible sidebar, breadcrumb header/search/profile, mobile navigation, theme-aware primitives and viewport-bounded scrollable editors. |

`/social` remains its existing redirect; no removed feature was reintroduced.
API and callback routes have no page UI to redesign.

## Feature boundaries

No changes to `lib/`, API routes, SQL, authentication policies, CSP, dependency
versions, provider configuration, AI requests, or persistence logic.

Preserved task completion/edit/delete, imported Canvas descriptions/deadlines,
separate work scheduling, repeat rules and occurrence editing, empty-calendar
creation, drag/resize, event editing, Assistant conversation/save/undo, calendar
navigation, goal progress, exams, timers, account export/deletion, integrations,
and tutorial replay. Cosmetic changes do not require a database migration.

## Verification

- All 499 unit/integration tests passed.
- Final TypeScript, ESLint, production webpack build, and whitespace checks passed.
- Final complete browser run passed all seven suites (274 seconds), including
  all 76 full-page viewport/theme combinations and the shared navigation checks.
- Existing calendar, feature, authentication, Canvas-settings, and tutorial
  browser regressions are retained.
- Added `tests/public-ui.test.mjs`: real public/auth/setup pages at 320/1440px
  in both themes, plus synthetic authentication and complete setup interactions.
- Added `tests/ui-redesign.test.mjs`: actual shared shell and 19 route/view
  trees at 390/1440px in both themes, with rendering, overflow and data-isolation
  assertions. Also checks shell interactions with synthetic state.
- Updated a dialog layout test to assert containment, bounded width and fixed
  actions rather than require the old exact decorative class string.

Browser fixtures replace account/network boundaries with fictional data. They
do not change production accounts, call DeepSeek, or send real Canvas feed URLs.
They supplement, rather than replace, the existing behavior regression suites.
The test runtime can be supplied through `ORDERLY_PLAYWRIGHT_MODULE`.

The full-page visual captures must let Framer Motion settle. Cancelling its
native animations can restore the initial opacity and produce misleading blank
screenshots; capture code accounts for this.

## Review and rollback

The redesign is isolated on its branch; `main` and the live production site are
not intentionally changed by this work. Review the branch/preview before any
merge. Returning to the original UI is simply returning to the unchanged main
branch; preserve any later uncommitted work before switching branches. No data
rollback is required because this branch adds no schema or data migration.

An existing Terms paragraph still describes preview approval whereas the
current Assistant can save directly. This factual wording mismatch was noted,
not silently changed as part of a visual redesign.
