import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORDERLY_PLAYWRIGHT_MODULE || 'playwright');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const root = resolve('.');

test('real calendar/grid/editor UI: navigation, recurrence, click/drag/resize, save and refresh', { timeout: 120000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-calendar-ui-'));
  let browser, server;
  try {
    const stub = join(root, 'tests/fixtures/calendar-ui-stores.ts');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/calendar-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@/lib/store$': stub, '@/lib/planner/store$': stub, '@/lib/schedule/store$': stub, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((res, rej) => compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) rej(error || new Error(stats.toString({ all: false, errors: true })));
      else res();
    }));
    const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root,'app/globals.css'),'utf8'), { from: join(root,'app/globals.css') })).css;
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer((req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle); }
      else if (req.url === '/style.css') { res.setHeader('Content-Type','text/css'); res.end(css); }
      else res.end('<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser fixture error:', error.message); });
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.clock.install({ time: new Date('2026-09-06T20:00:00Z') });
    await page.goto(origin);
    assert.deepEqual(errors, []);
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await page.getByRole('button', { name: 'Edit event Weekend practice', exact: true }).first().click();
    await page.locator('#event-date').waitFor();
    assert.equal(await page.locator('#event-date').inputValue(), '2026-10-03');
    if (process.env.ORDERLY_CALENDAR_SCREENSHOT) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: process.env.ORDERLY_CALENDAR_SCREENSHOT, animations: 'disabled' });
    }
    await page.locator('#title').fill('Special practice');
    await page.locator('#event-date').fill('2026-11-07');
    await page.getByRole('button', { name: 'Update Event', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const saved = await page.evaluate(() => window.calendarFixture.state().events[0]);
    assert.equal(saved.title, 'Weekend practice');
    assert.equal(saved.occurrenceOverrides['2026-10-03'].title, 'Special practice');
    assert.equal(saved.occurrenceOverrides['2026-10-03'].scheduledDate, '2026-11-07');
    await page.reload();
    for (let i = 0; i < 2; i++) await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await page.getByRole('button', { name: 'Edit event Special practice', exact: true }).click();
    assert.equal(await page.locator('#event-date').inputValue(), '2026-11-07');
    await page.locator('#event-edit-scope').selectOption('series');
    assert.equal(await page.locator('#event-date').inputValue(), '2026-09-05');
    assert.equal(await page.locator('#event-repeat-until').inputValue(), '2026-10-31');
    await page.locator('#event-repeat-until').fill('2026-11-30');
    await page.getByRole('button', { name: 'Update Event', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await page.evaluate(() => window.calendarFixture.state().events[0])).endDate, '2026-11-30');
    await page.getByRole('button', { name: 'Fixture schedule', exact: true }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next week', exact: true }).click();
    const eventButton = page.getByRole('button', { name: /^Weekend practice,/ }).first();
    await eventButton.scrollIntoViewIfNeeded();
    await eventButton.click();
    assert.equal(await page.locator('#event-date').inputValue(), '2026-10-10');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await eventButton.scrollIntoViewIfNeeded();
    const box = await eventButton.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    assert.equal(await page.getByRole('dialog').count(), 0, 'drag must not open the editor');
    const afterDrag = await page.evaluate(() => window.calendarFixture.state().events[0]);
    assert.notEqual(afterDrag.occurrenceOverrides['2026-10-10'].startTime, '09:00');
    const resize = page.getByRole('button', { name: /^Resize Weekend practice\./ });
    await resize.scrollIntoViewIfNeeded();
    const resizeBox = await resize.boundingBox();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + 35, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(350);
    assert.equal(await page.getByRole('dialog').count(), 0, 'resize must not open the editor');
    const afterResize = await page.evaluate(() => window.calendarFixture.state().events[0]);
    assert.notEqual(afterResize.occurrenceOverrides['2026-10-10'].endTime, afterDrag.occurrenceOverrides['2026-10-10'].endTime);
    // The exact visible date must reach the real empty-slot creation form.
    await page.getByRole('button', { name: 'Create an item on Thursday, October 8', exact: true }).press('Enter');
    await page.locator('#scheduleDate').waitFor();
    assert.equal(await page.locator('#scheduleDate').inputValue(), '2026-10-08');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Fixture month', exact: true }).click();
    await page.getByRole('button', { name: 'Next month', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    assert.equal((await page.locator('#scheduleDate').inputValue()).slice(0,7), '2026-10');
    await page.locator('#title').fill('Future manual task');
    await page.locator('#scheduleStartTime').fill('18:00');
    await page.getByRole('button', { name: 'Create Task', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const state = await page.evaluate(() => window.calendarFixture.state());
    assert.ok(Object.values(state.entries).some(entry => entry.scheduledDate.startsWith('2026-10')));
    await page.evaluate(() => window.calendarFixture.addTask());
    await page.getByRole('button', { name: 'Fixture schedule', exact: true }).click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: 'Next week', exact: true }).click();
    await page.getByRole('button', { name: /^Repeating study,/ }).first().click();
    assert.equal(await page.locator('#scheduleDate').inputValue(), '2026-10-06');
    await page.locator('#title').fill('One special study session');
    await page.locator('#scheduleDate').fill('2026-11-02');
    await page.getByRole('button', { name: 'Update Task', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const studyState = await page.evaluate(() => window.calendarFixture.state());
    const study = studyState.tasks.find(t => t.title === 'Repeating study');
    assert.equal(study.status, 'pending');
    assert.equal(studyState.entries[study.id].scheduledDate, '2026-09-08');
    assert.equal(studyState.entries[study.id].occurrenceOverrides['2026-10-06'].title, 'One special study session');
    await page.getByRole('button', { name: 'Fixture dashboard', exact: true }).click();
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next day', exact: true }).click();
    await page.getByRole('button', { name: /^Weekend practice,/ }).click();
    assert.equal(await page.locator('#event-date').inputValue(), '2026-09-12');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Event', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const removed = await page.evaluate(() => window.calendarFixture.state().events[0]);
    assert.equal(removed.occurrenceOverrides['2026-09-12'].skipped, true);
    assert.equal(removed.id, 'practice', 'deleting one occurrence retains the series');
    await page.getByRole('button', { name: 'Fixture month', exact: true }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('tab', { name: 'Event', exact: true }).click();
    const dialog = page.getByRole('dialog');
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391, 'mobile editor must fit horizontally');
    await page.getByRole('button', { name: 'Create Event', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('button', { name: 'Create Event', exact: true }).isVisible(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(res => server.close(res));
    await rm(output, { recursive: true, force: true });
  }
});
