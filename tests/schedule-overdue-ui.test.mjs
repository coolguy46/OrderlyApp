import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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
const userId = 'calendar-ui-owner';
const date = '2026-09-06';
const tasks = [
  { id: 'late-red', title: 'Late chemistry', subject_id: 'red', due_date: '2026-09-05' },
  { id: 'late-short', title: 'Late short task', due_date: '2026-09-05' },
  { id: 'current-red', title: 'Current chemistry', subject_id: 'red', due_time: '16:00' },
  { id: 'date-only', title: 'Due tonight' },
  { id: 'completed', title: 'Finished chemistry', subject_id: 'red', due_date: '2026-09-05', status: 'completed' },
  { id: 'no-deadline', title: 'Undated work', due_date: null },
  { id: 'late-untimed', title: 'Late reading', due_date: '2026-09-05' },
  { id: 'soon-timed', title: 'Becomes late timed', due_time: '13:01' },
  { id: 'soon-untimed', title: 'Becomes late untimed', due_time: '13:01' },
].map(task => ({ user_id: userId, subject_id: 'blue', description: null, priority: 'medium', status: 'pending',
  due_date: date, due_time: null, source: 'manual', recurrence: 'none', recurrence_days: null,
  created_at: '2026-09-01T20:00:00Z', updated_at: '2026-09-01T20:00:00Z', ...task }));
const entries = Object.fromEntries(tasks.map((task, i) => [task.id, {
  id: `entry-${task.id}`, userId, taskId: task.id, scheduledDate: date,
  startAt: task.id.includes('untimed') ? null : `${date}T${String(15 + i).padStart(2, '0')}:00:00Z`,
  durationSeconds: task.id === 'late-short' ? 900 : 2700,
  recurrence: 'none', recurrenceDays: null, recurrenceEndDate: null, occurrenceOverrides: {},
  createdAt: '2026-09-01T20:00:00Z', updatedAt: '2026-09-01T20:00:00Z',
}]));
const seed = { tasks, entries, subjects: [
  { id: 'red', user_id: userId, name: 'Chemistry', color: '#ef4444' },
  { id: 'blue', user_id: userId, name: 'English', color: '#3b82f6' },
], events: [{ id: 'red-class', title: 'Red class', kind: 'class', color: '#ef4444', daysOfWeek: [0],
  startDate: date, endDate: date, startTime: '07:00', endTime: '07:45', timeZone: 'America/Los_Angeles', enabled: true }] };

test('scheduler overdue states preserve course colors, fit compact/mobile blocks, and update without reload', { timeout: 120000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-overdue-ui-'));
  let browser, server;
  try {
    const stub = join(root, 'tests/fixtures/calendar-ui-stores.ts');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/calendar-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/store$': stub, '@/lib/planner/store$': stub, '@/lib/schedule/store$': stub, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((res, rej) => compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) rej(error || new Error(stats.toString({ all: false, errors: true })));
      else res();
    }));
    const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer((req, res) => {
      if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
      else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
      else res.end('<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles' });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.route('**/api/billing/preview', route => route.fulfill({ status: 403, json: { allowed: false } }));
    await page.route('**/api/billing/status', route => route.fulfill({ json: {
      enabled: true, sandbox: true, subscriptionRequired: true, checkoutEnabled: true, aiAccess: true, ownerAccess: false,
      hasSubscription: true, canManage: true, status: 'active', trialEligible: false, trialEndsAt: null, accessEndsAt: null,
    } }));
    await page.clock.install({ time: new Date('2026-09-06T20:00:00Z') });
    await page.addInitScript(seed => {
      if (!localStorage.getItem('calendar-ui-fixture')) localStorage.setItem('calendar-ui-fixture', JSON.stringify(seed));
    }, seed);
    await page.goto(origin);
    const button = title => page.getByRole('button', { name: new RegExp(`^${title},`) }).first();
    const isOverdue = title => button(title).evaluate(element => Boolean(element.closest('[data-overdue="true"]')));
    const assertInitial = async () => {
      await button('Late chemistry').waitFor();
      for (const title of ['Late chemistry', 'Late short task', 'Late reading']) {
        assert.equal(await isOverdue(title), true, `${title} has a red overdue outline`);
        assert.match(await button(title).getAttribute('aria-label'), /overdue/);
        assert.equal(await button(title).getByText('Overdue', { exact: true }).count(), 1);
      }
      for (const title of ['Current chemistry', 'Due tonight', 'Undated work', 'Red class', 'Becomes late timed', 'Becomes late untimed']) {
        assert.equal(await isOverdue(title), false, `${title} is not marked late`);
      }
      assert.equal(await page.locator('[data-overdue="true"]').filter({ hasText: 'Finished chemistry' }).count(), 0);
      const colors = await Promise.all(['Late chemistry', 'Current chemistry'].map(title => button(title).evaluate(el => ({
        background: getComputedStyle(el.parentElement).backgroundColor,
        courseStripe: getComputedStyle(el.parentElement).borderLeftColor,
      }))));
      assert.deepEqual(colors[0], colors[1], 'overdue treatment preserves the same muted course background and stripe');
      assert.equal(colors[0].courseStripe, 'rgb(239, 68, 68)');
    };
    await page.getByRole('button', { name: 'Fixture schedule', exact: true }).click();
    await assertInitial();
    for (const dark of [true, false]) {
      await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), dark);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        await button('Late short task').scrollIntoViewIfNeeded();
        const block = await button('Late short task').boundingBox();
        const badge = await button('Late short task').getByText('Overdue', { exact: true }).locator('..').boundingBox();
        assert.ok((await button('Late short task').locator('p').first().boundingBox()).width >= 32, 'warning must leave the task title readable');
        if (process.env.ORDERLY_UI_SCREENSHOT_DIR) {
          await mkdir(process.env.ORDERLY_UI_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: join(process.env.ORDERLY_UI_SCREENSHOT_DIR, `overdue-${dark ? 'dark' : 'light'}-${width}.png`) });
        }
        assert.ok(badge.x >= block.x && badge.x + badge.width <= block.x + block.width + 1, 'label fits narrow columns');
        assert.ok(badge.y >= block.y && badge.y + badge.height <= block.y + block.height + 1, `label fits 15-minute blocks: ${JSON.stringify({ block, badge })}`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'grid does not overflow the page');
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // The Assistant's embedded scheduler must use the same deadline mapping.
    await page.getByRole('button', { name: 'Fixture assistant', exact: true }).click();
    const calendarToggle = page.getByRole('button', { name: 'Your calendar', exact: true });
    if (await calendarToggle.getAttribute('aria-expanded') === 'false') await calendarToggle.click();
    await page.getByRole('tab', { name: 'Schedule', exact: true }).click();
    await assertInitial();
    await page.getByRole('button', { name: 'Fixture schedule', exact: true }).click();
    await page.clock.fastForward(120000);
    await page.waitForFunction(() => ['Becomes late timed', 'Becomes late untimed'].every(title =>
      [...document.querySelectorAll('[data-overdue="true"]')].some(el => el.textContent.includes(title))));
    await page.evaluate(() => window.calendarFixture.completeTask('late-red'));
    await page.waitForFunction(() => ![...document.querySelectorAll('[data-overdue="true"]')].some(el => el.textContent.includes('Late chemistry')));
    // Overdue indicators must not block opening, resizing, or unscheduling tasks.
    await button('Late short task').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: /^Resize Current chemistry\./ }).press('ArrowDown');
    assert.equal((await page.evaluate(() => window.calendarFixture.state())).entries['current-red'].durationSeconds, 3600);
    await page.getByRole('button', { name: 'Move Late short task to untimed', exact: true }).press('Enter');
    await page.getByRole('button', { name: /^Late short task,.*untimed/ }).waitFor();
    assert.equal(await isOverdue('Late short task'), true);
    await page.reload();
    await page.getByRole('button', { name: 'Fixture schedule', exact: true }).click();
    assert.equal(await isOverdue('Late short task'), true, 'saved unscheduled tasks retain overdue status');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(res => server.close(res));
    await rm(output, { recursive: true, force: true });
  }
});
