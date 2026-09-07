# Tutorial screenshot source

The images in `public/tutorial/` are screenshots of the real current Orderly
components mounted in a local, isolated test harness. They are not invented app
mockups, and no real account was opened or seeded to produce them.

## Consistent demo

The fictional student is **Alex Morgan**, `alex@example.invalid`. The demo starts
on **Monday, September 7, 2026 at 2 PM, America/Los_Angeles**. Subjects are Biology,
English, and Math. All views start with the same data; no form is submitted.

| Item | Deadline/status | Scheduled work or event |
| --- | --- | --- |
| Biology Worksheet | Canvas example; pending; Sep 7, 9 PM | Sep 7, 6–6:30 PM |
| English Essay Draft | Manual; pending; Sep 6, 9 PM; missing | Sep 7, 7–8 PM |
| Math Practice | Completed Sep 7 | Sep 7, 11:30 AM–noon |
| Soccer Practice | Event, no completion status | Mondays/Wednesdays, 4:30–5:30 PM; Sep 7–Oct 2 |
| Counselor Meeting | One-time event | Sep 8, 4–4:30 PM |
| Finish the Essay Outline | Goal, 1 of 4 steps | Deadline Sep 9 |
| Biology Quiz | Exam, 25% prepared | Sep 11, 9 AM, Room 204 |

The Assistant conversation is explicitly seeded demonstration text, not a live
AI response. It accurately describes the same stored fictional schedule. The
Canvas connection screenshot depicts the connection form before connecting;
there is no actual feed URL. Previously imported example assignments can exist
without an active connection. The editable event screenshot shows the real
repeat controls and the task screenshot shows the real imported deadline and
separate work schedule fields. Settings is cropped to appearance/integration
navigation rather than exposing account or destructive controls.

## Reproduce

Use Node, installed app dependencies, Chrome, Playwright, and Sharp. Playwright
can be supplied from the desktop's bundled runtime without adding a dependency:

```sh
ORDERLY_PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright node scripts/capture-tutorial.mjs
```

Sharp defaults to the app's installed transitive dependency. If necessary set
`ORDERLY_SHARP_MODULE` to an absolute module path. To recapture selected images,
set `ORDERLY_TUTORIAL_VIEWS=assistant,settings` (comma separated).

The script creates a temporary bundle with the existing TypeScript fixture
loader and app CSS, starts a loopback-only server, and renders each view in a
fresh browser context. Store, Supabase, timer, routing, and Canvas-hook boundaries
are replaced with screenshot-only fixtures. Browser routing rejects every
external request and every API request. The loopback API route also returns 403.
Temporary build artifacts and the browser are cleaned up afterward.

This fixture is not an app route and cannot seed production. Do not replace its
synthetic store with the real store or add secrets/environment files to the
bundle. All output is optimized WebP. Review every image after recapturing;
automatic nonblank checks do not replace visual inspection.

## Files

- `tests/fixtures/tutorial-demo-stores.ts`: canonical fictional dataset.
- `tests/fixtures/tutorial-demo-boundaries.tsx`: isolated routing/network hooks.
- `tests/fixtures/tutorial-demo.tsx`: real component mounts.
- `scripts/capture-tutorial.mjs`: reproducible capture and WebP optimization.
- `public/tutorial/{dashboard,tasks,task-editor,event-editor,calendar,schedule,assistant,goals,study,exams,settings,canvas-integration}.webp`.
