import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORDERLY_PLAYWRIGHT_MODULE || 'playwright');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const root = resolve('.');

test('real settings/goals/exams/reminder UI works with isolated saved-data boundaries', { timeout: 180000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-features-ui-'));
  let server, browser;
  try {
    const boundary = join(root, 'tests/fixtures/features-ui-runtime.tsx');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/features-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        '@/lib/store$': boundary, '@/lib/planner/store$': boundary, '@/lib/schedule/store$': boundary,
        '@/components/layout$': boundary, '@/lib/supabase/client$': boundary, '@/lib/use-current-time$': boundary,
        'next/navigation$': boundary, 'next/link$': boundary, '@': root,
      } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => { compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true }))); else resolve();
    }));
    const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
    const bundle = await readFile(join(output, 'bundle.js'));
    const html = '<!doctype html><html class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    server = createServer((req, res) => { res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html'); res.end(req.url === '/bundle.js' ? bundle : req.url === '/style.css' ? css : html); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    const errors = [], outside = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin) || route.request().method() !== 'GET') { outside.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const exportPayload = { version: 2, accountId: 'feature-test-alex', tasks: [{ title: 'Server-saved assignment' }], recurring_commitments: [{ title: 'Synthetic practice' }] };
    let exportMode = 'success', finishExport, exportRequested;
    await page.route(`${origin}/api/account/export`, async route => {
      assert.equal(route.request().method(), 'GET');
      if (exportMode === 'failure') return route.fulfill({ status: 503, json: { error: 'Synthetic export failure' } });
      if (exportMode === 'deferred') {
        return new Promise(resolve => {
          finishExport = async () => { await route.fulfill({ json: exportPayload }); resolve(); };
          exportRequested();
        });
      }
      return route.fulfill({ json: exportPayload });
    });
    const downloads = [];
    page.on('download', download => downloads.push(download));
    await page.goto(origin);
    const name = page.getByPlaceholder('Enter your full name');
    assert.equal(await name.inputValue(), 'Alex Morgan', 'already-loaded profile is prefilled on Settings navigation');
    await page.evaluate(() => { window.featuresFixture.controls.failPlanner = true; });
    await page.getByRole('button', { name: 'Save availability', exact: true }).click();
    await page.getByText('Availability is saved on this device, but has not synced to your account. Check your connection and save again.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Schedule availability saved', { exact: true }).count(), 0);
    await page.evaluate(() => { window.featuresFixture.controls.failPlanner = false; });
    await page.getByRole('button', { name: 'Save availability', exact: true }).click();
    await page.getByText('Schedule availability saved', { exact: true }).waitFor();

    const sound = page.getByRole('switch', { name: 'Sound Effects', exact: true });
    await sound.click();
    await page.reload();
    assert.equal(await sound.getAttribute('aria-checked'), 'false', 'notification preference persists');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export Data', exact: true }).click();
    const download = await downloaded;
    assert.deepEqual(JSON.parse(await readFile(await download.path(), 'utf8')), exportPayload, 'export downloads fresh server data, not stale fixture store rows');
    exportMode = 'failure';
    await page.getByRole('button', { name: 'Export Data', exact: true }).click();
    await page.getByText('Synthetic export failure', { exact: true }).waitFor();
    assert.equal(downloads.length, 1, 'failed export does not download a partial file');
    exportMode = 'deferred';
    const requested = new Promise(resolve => { exportRequested = resolve; });
    await page.getByRole('button', { name: 'Export Data', exact: true }).click();
    await requested;
    await page.evaluate(() => window.featuresFixture.switchUser());
    await finishExport();
    await page.getByRole('button', { name: 'Export Data', exact: true }).waitFor();
    assert.equal(downloads.length, 1, 'old-account response cannot download after switching accounts');
    await page.waitForFunction(() => document.querySelector('input[placeholder="Enter your full name"]').value === 'Jamie Lee');
    assert.equal(await sound.getAttribute('aria-checked'), 'true', 'other account does not inherit preferences');
    await page.reload();

    await page.evaluate(() => window.featuresFixture.show('goals'));
    await page.getByRole('button', { name: 'Add 1', exact: true }).click();
    await page.getByText('2 / 3 steps', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add 1', exact: true }).click();
    await page.getByText('3 / 3 steps', { exact: true }).waitFor();
    await page.reload(); await page.evaluate(() => window.featuresFixture.show('goals'));
    await page.getByText('3 / 3 steps', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add Goal', exact: true }).click();
    await page.getByLabel('Goal Title', { exact: true }).fill('Read two chapters');
    await page.evaluate(() => { window.featuresFixture.controls.failSave = true; });
    await page.getByRole('button', { name: 'Create Goal', exact: true }).click();
    await page.getByRole('alert').getByText(/could not save this goal/).waitFor();
    assert.equal(await page.getByLabel('Goal Title', { exact: true }).inputValue(), 'Read two chapters');
    await page.evaluate(() => { window.featuresFixture.controls.failSave = false; });
    await page.getByRole('button', { name: 'Create Goal', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'Read two chapters', exact: true }).waitFor();

    await page.evaluate(() => window.featuresFixture.show('exams'));
    await page.getByRole('button', { name: 'Increase Biology Quiz preparation by 10 percent', exact: true }).click();
    await page.getByText('30%', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Edit Biology Quiz', exact: true }).click();
    assert.equal(await page.getByLabel('Description', { exact: true }).inputValue(), 'Cells & tissues');
    await page.getByLabel('Location', { exact: true }).fill('Room 204');
    await page.getByRole('button', { name: 'Update Exam', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload(); await page.evaluate(() => window.featuresFixture.show('exams'));
    await page.getByText('Room 204', { exact: true }).waitFor();
    await page.getByText('30%', { exact: true }).waitFor();
    await page.evaluate(() => window.featuresFixture.show('profile'));
    await page.getByRole('button', { name: 'Edit profile name', exact: true }).click();
    await page.getByLabel('Full Name', { exact: true }).fill('Alex Updated');
    await page.evaluate(() => { window.featuresFixture.controls.failSave = true; });
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('alert').getByText(/Your name was not saved/).waitFor();
    assert.equal(await page.getByLabel('Full Name', { exact: true }).inputValue(), 'Alex Updated');
    await page.evaluate(() => { window.featuresFixture.controls.failSave = false; });
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.reload();
    assert.equal(await page.getByPlaceholder('Enter your full name').inputValue(), 'Alex Updated');
    await page.evaluate(() => window.featuresFixture.show('profile'));
    await page.getByRole('button', { name: 'Edit profile name', exact: true }).click();
    await page.getByLabel('Full Name', { exact: true }).fill('Old account unsaved name');
    await page.evaluate(() => window.featuresFixture.switchUser());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Edit profile name', exact: true }).click();
    assert.equal(await page.getByLabel('Full Name', { exact: true }).inputValue(), 'Jamie Lee', 'new account never inherits the previous editor draft');
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.featuresFixture.state().user.full_name), 'Jamie Lee');
    await page.reload();
    for (const view of ['settings', 'goals', 'exams', 'profile']) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(view => window.featuresFixture.show(view), view);
      await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits a phone`);
    }

    await page.reload();
    await page.evaluate(() => { window.featuresFixture.show('reminders'); window.featuresFixture.taskDueSoon(); });
    await page.getByText('Task due soon', { exact: true }).waitFor();
    assert.equal(await page.getByText(/Due soon synthetic task is due in/).count(), 1);
    await page.reload();
    await page.evaluate(() => { window.featuresFixture.show('reminders'); });
    await page.waitForTimeout(1200);
    assert.equal(await page.getByText('Task due soon', { exact: true }).count(), 0, 'reminders are not replayed on navigation/reload');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server ? server.close(resolve) : resolve());
    await rm(output, { recursive: true, force: true });
  }
});
