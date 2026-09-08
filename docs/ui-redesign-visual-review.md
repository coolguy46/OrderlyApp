# UI redesign visual verification

## Scope and safety

The new `tests/ui-redesign.test.mjs` is an additive presentation smoke test. It mounts the actual page components and actual MainLayout, Sidebar, Header, BottomNav, tutorial, and page content. The isolated `ui-redesign` fixtures reuse Alex Morgan's existing fictional tutorial records. They do not load private account data.

Only framework routing/image, store, Supabase, and integration boundaries are substituted. External network requests and non-GET requests are blocked and asserted absent. Task/account mutations are recorded as failures. This verifies rendered presentation and shell behavior, not production authentication or API persistence; existing feature and server tests remain necessary.

## Coverage

The catalog renders 19 views at 1440×1000 and 390×844, in both light and dark mode (76 combinations):

- Dashboard, Tasks, task Calendar, Schedule, and Assistant.
- Goals, Study, Exams, Settings, Canvas integration, and Profile.
- Landing, login, register, forgot password, reset password, setup, privacy, and terms.

Each combination asserts rendered content, no page exception/error boundary, no horizontal document overflow, no external requests, and no network/fixture mutations. Optional screenshots use the real stylesheet and preserve settled animations. The calendar's inner horizontal scroll on narrow screens is intentional and distinct from document overflow.

The appended real-shell interaction guard verifies:

- Sidebar collapse and expansion, retaining all eight navigation destinations while collapsed.
- Ctrl+K focus, task search result, and task navigation intent.
- Profile/Settings/Sign out menu availability without invoking account mutations.
- Help opening the replayable tutorial and restoring focus after closing.
- Mobile More opening navigation and reaching the actual Settings page.

## Visual review findings

- Desktop/light/mobile Calendar, Schedule, Assistant conversation, expanded and collapsed Assistant calendar, imported task details/editor, and event editor were inspected. Controls and time labels remain legible, calendar overflow is confined to its scroll region, and editor actions remain reachable using the dialog's intentional inner scroll.
- Full-shell desktop Dashboard and Tasks, mobile light Dashboard, mobile Schedule/Assistant, light Canvas integration, and dark Study were inspected. The page hierarchy, toolbar separation, cards, and small-screen navigation remain readable.
- An initial screenshot-only defect left staggered animated cards blank when Playwright cancelled animations. The harness was corrected to wait 1.5 seconds and capture with `animations: 'allow'`, matching the existing tutorial capture approach. Corrected Dashboard and Tasks captures show all summary cards. No production workaround was added for this capture artifact.
- The synthetic theme state is synchronized with the document theme so Settings' selected theme agrees with the captured appearance.

## Validation recorded during implementation

- Existing `tests/calendar-ui.test.mjs`: passed twice; final scoped run 32.2 seconds. Two additive captures cover expanded/collapsed Assistant calendar. No feature assertions were removed.
- New all-page catalog: all 76 readonly combinations passed (95 seconds) before the screenshot-settling adjustment.
- New final filtered Dashboard/Tasks catalog: eight settled screenshots plus all shell interaction checks passed (26 seconds).
- Final root verification: all seven browser suites passed (274 seconds),
  including the full 76-view catalog and shell interactions (166 seconds).
  All 499 unit/integration tests, whole-project TypeScript, ESLint, production
  webpack build, and diff whitespace checks also passed.

## Reproduce

Set `ORDERLY_PLAYWRIGHT_MODULE` to an installed Playwright module if it is not available through normal module resolution. Then run:

```sh
ORDERLY_REDESIGN_SCREENSHOT_DIR=/private/tmp/orderly-ui-review node --test tests/ui-redesign.test.mjs
```

Optional `ORDERLY_REDESIGN_ROUTES=/,/tasks` restricts the catalog while still running the shell guard. The harness serves only an isolated localhost bundle; it does not start the production app or contact its backend.

Implementation review screenshots were written to `/private/tmp/orderly-21st-full-ui` and `/private/tmp/orderly-21st-calendar-ui`. These are local review artifacts, not deployed assets or private-account screenshots.
