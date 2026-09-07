import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { createServer } from 'node:http';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORDERLY_PLAYWRIGHT_MODULE || 'playwright');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const root = resolve('.');
const sectionIds = ['dashboard', 'tasks', 'task-editor', 'event-editor', 'calendar', 'schedule', 'assistant', 'goals', 'study', 'exams', 'settings', 'canvas'];

test('real tutorial/header UI: full tour, replay, isolated progress, Canvas guide, keyboard and responsive layouts', { timeout: 180000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-tutorial-ui-'));
  let browser, server;
  try {
    const boundary = join(root, 'tests/fixtures/tutorial-ui-runtime.tsx');
    const compiler = webpack({
      mode: 'development', context: root, entry: './tests/fixtures/tutorial-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        '@/lib/store$': boundary, 'next/navigation$': boundary, 'next/link$': boundary, 'next/image$': boundary, '@': root,
      } },
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
    const html = '<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    server = createServer(async (req, res) => {
      const pathname = new URL(req.url, 'http://fixture.invalid').pathname;
      if (pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
      else if (pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
      else if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); }
      else {
        const path = resolve(root, 'public', `.${decodeURIComponent(pathname)}`);
        if (!path.startsWith(join(root, 'public') + sep)) { res.writeHead(403); res.end(); return; }
        try {
          const bytes = await readFile(path);
          const types = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
          res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
          res.end(bytes);
        } catch { res.writeHead(404); res.end(); }
      }
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
    const errors = [], externalRequests = [], mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const request = route.request();
      if (!request.url().startsWith(origin)) { externalRequests.push(request.url()); return route.abort(); }
      if (request.method() !== 'GET') { mutations.push(`${request.method()} ${request.url()}`); return route.abort(); }
      return route.continue();
    });
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    const before = await page.evaluate(() => window.tutorialFixture.accountState());
    const help = page.getByRole('button', { name: 'Help and tutorial', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Your guide to Orderly', exact: true });
    const currentSection = () => page.getByTestId('tutorial-content').getAttribute('data-tutorial-section');
    const capture = async name => {
      if (!process.env.ORDERLY_TUTORIAL_SCREENSHOT_DIR) return;
      await mkdir(process.env.ORDERLY_TUTORIAL_SCREENSHOT_DIR, { recursive: true });
      if (await page.locator('[data-testid="tutorial-content"] img').count()) {
        await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="tutorial-content"] img')].every(element => {
          const imageBounds = element.getBoundingClientRect();
          const contentBounds = element.closest('[data-testid="tutorial-content"]').getBoundingClientRect();
          const inView = imageBounds.top < contentBounds.bottom && imageBounds.bottom > contentBounds.top;
          return !inView || (element.complete && element.naturalWidth > 0);
        }));
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.screenshot({ path: join(process.env.ORDERLY_TUTORIAL_SCREENSHOT_DIR, `${name}.png`), animations: 'disabled' });
    };
    const checkBounds = async (locator, width, height, description) => {
      const bounds = await locator.boundingBox();
      assert.ok(bounds, `${description} is visible`);
      assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${description} fits horizontally: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= height + 1, `${description} fits vertically: ${JSON.stringify(bounds)}`);
    };

    // The invitation must not open a blocking dialog or prevent normal page use.
    await page.getByRole('button', { name: 'Ordinary page action: 0', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Ordinary page action: 1', exact: true }).count(), 1);
    assert.equal(await page.getByRole('dialog').count(), 0);
    const helpBounds = await help.boundingBox();
    const profile = page.locator('header [data-slot="dropdown-menu-trigger"]');
    const profileBounds = await profile.boundingBox();
    assert.ok(helpBounds.x + helpBounds.width <= profileBounds.x + 1, 'help is immediately left of the existing profile');
    assert.equal(await help.evaluate(element => {
      const buttons = [...element.closest('header').querySelectorAll('button')];
      return buttons[buttons.indexOf(element) + 1]?.getAttribute('data-slot');
    }), 'dropdown-menu-trigger');
    await capture('tutorial-entry-desktop');

    await help.focus();
    await help.press('Enter');
    await dialog.waitFor();
    await capture('tutorial-hub-desktop');
    assert.equal(await dialog.getByTestId('tutorial-section-menu').locator('[data-section-id]').count(), sectionIds.length);
    await dialog.getByRole('button', { name: 'Start tour', exact: true }).click();
    assert.equal(await currentSection(), 'dashboard');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await currentSection(), 'overview', 'Back on the first section returns to the section menu');
    await dialog.getByRole('button', { name: 'Continue tour', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await currentSection(), 'tasks');
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await currentSection(), 'dashboard');

    // Walk all sections in sequence and ensure each screenshot is a loaded,
    // described local image, not a broken decorative stand-in.
    for (let index = 0; index < sectionIds.length; index++) {
      assert.equal(await currentSection(), sectionIds[index]);
      const images = dialog.getByTestId('tutorial-content').locator('img');
      assert.ok(await images.count() > 0, `${sectionIds[index]} includes a screenshot`);
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="tutorial-content"] img')]
          .every(element => element.complete && element.naturalWidth > 0));
        assert.ok((await image.getAttribute('alt'))?.trim().length > 10, 'screenshot has a useful description');
        assert.ok(await image.evaluate(element => element.naturalWidth > 0), 'screenshot loads');
      }
      if (index < sectionIds.length - 1) await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    }
    const tourCanvasGuide = await dialog.locator('[data-canvas-guide]').innerText();
    for (const instruction of ['Log into Canvas', 'Open Calendar', 'Calendar Feed', 'Copy the feed link', 'Paste and connect', 'Calendar feed URL', 'Connect Canvas']) {
      assert.ok(tourCanvasGuide.includes(instruction), `Canvas guide includes ${instruction}`);
    }
    await dialog.getByText('Having trouble connecting?', { exact: true }).click();
    assert.ok((await dialog.locator('[data-canvas-guide]').innerText()).includes('Sync failed or timed out?'));
    await capture('tutorial-canvas-desktop');
    await dialog.getByRole('button', { name: 'Finish tutorial', exact: true }).click();
    assert.equal(await currentSection(), 'overview', 'finishing returns to the replayable help hub');
    assert.ok((await dialog.getByRole('status').innerText()).includes('Tour finished'));
    await dialog.getByRole('button', { name: 'Close tutorial', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Help and tutorial');

    // The independent integration help is the same actual component and copy.
    await page.getByRole('button', { name: 'Fixture Canvas instructions', exact: true }).click();
    assert.equal(await page.getByRole('region', { name: 'Canvas connection instructions', exact: true }).locator('[data-canvas-guide]').innerText(), tourCanvasGuide);
    await page.getByRole('button', { name: 'Fixture Canvas instructions', exact: true }).click();
    await help.click();
    await dialog.getByRole('button', { name: 'Restart tour', exact: true }).click();
    assert.equal(await currentSection(), 'dashboard');
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    assert.equal(await currentSection(), 'task-editor');
    await dialog.getByRole('button', { name: 'Close tutorial', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.reload();
    await help.click();
    await dialog.getByRole('button', { name: 'Continue tour', exact: true }).click();
    assert.equal(await currentSection(), 'task-editor', 'progress survives reopening and page reload');
    await dialog.getByRole('button', { name: 'Skip tutorial', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await help.click();
    await dialog.getByRole('button', { name: 'Continue tour', exact: true }).click();
    assert.equal(await currentSection(), 'task-editor', 'skipping does not erase progress or disable replay');
    for (const id of sectionIds) {
      await dialog.getByTestId('tutorial-section-menu').locator(`[data-section-id="${id}"]`).click();
      assert.equal(await currentSection(), id, `section menu can jump directly to ${id}`);
    }
    await dialog.getByTestId('tutorial-section-menu').locator('[data-section-id="task-editor"]').click();

    // Keyboard focus stays within the tutorial and returns to the opener.
    await dialog.getByRole('button', { name: 'Close tutorial', exact: true }).focus();
    for (let index = 0; index < 45; index++) {
      await page.keyboard.press('Tab');
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'keyboard focus stays inside dialog');
    }
    for (let index = 0; index < 45; index++) {
      await page.keyboard.press('Shift+Tab');
      assert.ok(await dialog.evaluate(element => element.contains(document.activeElement)), 'keyboard focus stays inside dialog');
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Help and tutorial');

    // Progress belongs to the signed-in user, not a shared browser-wide flag.
    await page.evaluate(() => window.tutorialFixture.switchUser('tutorial-test-jamie'));
    await help.click();
    await dialog.getByRole('button', { name: 'Start tour', exact: true }).click();
    assert.equal(await currentSection(), 'dashboard');
    await dialog.getByRole('button', { name: 'Close tutorial', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.tutorialFixture.switchUser('tutorial-test-alex'));
    await help.click();
    await dialog.getByRole('button', { name: 'Continue tour', exact: true }).click();
    assert.equal(await currentSection(), 'task-editor');
    await dialog.getByRole('button', { name: 'Close tutorial', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    // Test compact phones, touch-sized phones, and short laptops in both themes.
    for (const [width, height, theme] of [[320, 568, 'dark'], [390, 844, 'dark'], [390, 844, 'light'], [1280, 720, 'light']]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(mode => document.documentElement.classList.toggle('dark', mode === 'dark'), theme);
      await checkBounds(help, width, height, `help button at ${width}px`);
      await checkBounds(profile, width, height, `profile button at ${width}px`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'header and ordinary page do not overflow');
      await help.click();
      await checkBounds(dialog, width, height, `tutorial hub at ${width}px`);
      await dialog.getByRole('button', { name: 'Continue tour', exact: true }).click();
      await checkBounds(dialog, width, height, `tutorial step at ${width}px`);
      await checkBounds(dialog.getByRole('button', { name: 'Next', exact: true }), width, height, 'Next control');
      await checkBounds(dialog.getByRole('button', { name: 'Back', exact: true }), width, height, 'Back control');
      await checkBounds(dialog.getByRole('button', { name: 'Close tutorial', exact: true }), width, height, 'Close control');
      await capture(`tutorial-step-${width}-${theme}`);
      if (width < 640) {
        await dialog.getByRole('combobox', { name: 'Tutorial section', exact: true }).selectOption('8');
        assert.equal(await currentSection(), 'study', 'mobile section picker supports direct jumps');
        await dialog.getByRole('combobox', { name: 'Tutorial section', exact: true }).selectOption('11');
        assert.equal(await currentSection(), 'canvas');
        await checkBounds(dialog.getByRole('button', { name: 'Finish tutorial', exact: true }), width, height, 'Finish control');
        await checkBounds(dialog.getByRole('button', { name: 'Skip tutorial', exact: true }), width, height, 'Skip control');
        await capture(`tutorial-canvas-${width}-${theme}`);
        await dialog.getByRole('combobox', { name: 'Tutorial section', exact: true }).selectOption('');
        assert.equal(await currentSection(), 'overview', 'mobile section picker returns to the help hub');
        await dialog.getByTestId('tutorial-section-menu').locator('[data-section-id="task-editor"]').click();
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    assert.deepEqual(await page.evaluate(() => window.tutorialFixture.accountState()), before, 'tutorial never changes account data');
    assert.deepEqual(await page.evaluate(() => window.tutorialFixture.mutationCalls), []);
    assert.deepEqual(mutations, [], 'tutorial does not submit mutations over the network');
    assert.deepEqual(externalRequests, [], 'tutorial does not request external/private data');
    assert.deepEqual(errors, []);

    // Browsers with blocked/corrupt storage must still be able to use the tour.
    for (const blocked of [false, true]) {
      const isolated = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
      const isolatedErrors = [];
      isolated.on('pageerror', error => isolatedErrors.push(error.message));
      await isolated.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await isolated.addInitScript(shouldBlock => {
        Storage.prototype.getItem = function () {
          if (shouldBlock) throw new DOMException('Storage unavailable', 'SecurityError');
          return '{malformed tutorial progress';
        };
        if (shouldBlock) Storage.prototype.setItem = function () { throw new DOMException('Storage unavailable', 'QuotaExceededError'); };
      }, blocked);
      await isolated.goto(origin);
      await isolated.getByRole('button', { name: 'Help and tutorial', exact: true }).click();
      const isolatedDialog = isolated.getByRole('dialog', { name: 'Your guide to Orderly', exact: true });
      await isolatedDialog.getByRole('button', { name: 'Start tour', exact: true }).click();
      await isolatedDialog.getByRole('button', { name: 'Next', exact: true }).click();
      await isolatedDialog.getByRole('button', { name: 'Skip tutorial', exact: true }).click();
      await isolatedDialog.waitFor({ state: 'hidden' });
      await isolated.getByRole('button', { name: 'Ordinary page action: 0', exact: true }).click();
      assert.deepEqual(isolatedErrors, [], `tutorial tolerates ${blocked ? 'unavailable' : 'malformed'} storage`);
      assert.deepEqual(await isolated.evaluate(() => window.tutorialFixture.mutationCalls), []);
      await isolated.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise(res => server.close(res));
    await rm(output, { recursive: true, force: true });
  }
});
