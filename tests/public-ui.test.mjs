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

test('public redesign: real pages fit mobile and desktop; auth and setup actions are preserved', { timeout: 180000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-public-ui-'));
  let browser, server;
  try {
    const boundary = join(root, 'tests/fixtures/public-ui-boundaries.tsx');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/public-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/store$': boundary, '@/lib/supabase/client$': boundary,
        '@/lib/supabase/services$': boundary, 'next/navigation$': boundary, 'next/link$': boundary, 'next/image$': boundary, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((res, rej) => compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) rej(error || new Error(stats.toString({ all: false, errors: true }))); else res(); }));
    const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      if (url.pathname === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
      else if (url.pathname === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
      else if (url.pathname === '/logo.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end(await readFile(join(root, 'public/logo.svg'))); }
      else if (url.pathname === '/api/auth/password-recovery') { res.setHeader('Content-Type', 'application/json'); res.end('{}'); }
      else res.end('<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [], unexpectedRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) { unexpectedRequests.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    const capture = async name => {
      if (!process.env.ORDERLY_UI_SCREENSHOT_DIR) return;
      await mkdir(process.env.ORDERLY_UI_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: join(process.env.ORDERLY_UI_SCREENSHOT_DIR, `public-${name}.png`), fullPage: true, animations: 'disabled' });
    };
    for (const theme of ['dark', 'light']) {
      for (const width of [320, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const view of ['landing', 'login', 'register', 'forgot', 'reset', 'setup', 'privacy', 'terms']) {
          await page.goto(`${origin}/?view=${view}`);
          await page.evaluate(theme => document.documentElement.className = theme, theme);
          await page.locator('h1:visible,h2:visible,h3:visible,[data-slot="card-title"]:visible').first().waitFor();
          await page.waitForTimeout(550);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${view} ${theme} ${width} has no horizontal overflow`);
          if (view === 'landing') {
            const brand = await page.getByRole('link', { name: 'Orderly home', exact: true }).boundingBox();
            const signIn = await page.getByRole('link', { name: 'Sign in', exact: true }).boundingBox();
            assert.ok(brand.x + brand.width <= signIn.x, 'landing brand and sign-in action do not overlap');
          }
          if (theme === 'dark' || width === 320) await capture(`${view}-${theme}-${width}`);
        }
      }
    }
    await page.goto(`${origin}/?view=login`);
    await page.getByLabel('Email', { exact: true }).fill('alex@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fictional-passphrase');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.waitForFunction(() => window.publicUiFixture.calls.includes('navigate:/'));
    await page.goto(`${origin}/?view=register`);
    await page.getByLabel('Full name', { exact: true }).fill('Alex Morgan');
    await page.getByLabel('Email', { exact: true }).fill('alex@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('fictional-passphrase');
    await page.getByLabel('Confirm', { exact: true }).fill('fictional-passphrase');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Check your email' }).waitFor();
    await page.goto(`${origin}/?view=forgot`);
    await page.getByLabel('Email', { exact: true }).fill('alex@example.invalid');
    await page.getByRole('button', { name: 'Reset password', exact: true }).click();
    await page.getByText('Check your email', { exact: true }).waitFor();
    await page.goto(`${origin}/?view=setup`);
    await page.getByLabel('Display Name', { exact: true }).fill('Alex Morgan');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Subject name', { exact: true }).fill('Biology');
    await page.getByRole('button', { name: 'Add subject', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Biology', exact: true }).waitFor();
    await capture('setup-subjects');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByLabel('Canvas iCal Feed URL', { exact: true }).waitFor();
    await capture('setup-canvas');
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await capture('setup-preferences');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Go to Dashboard', exact: true }).click();
    await page.waitForFunction(() => window.publicUiFixture.calls.includes('setup-complete') && window.publicUiFixture.calls.includes('navigate:/'));
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpectedRequests, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(res => server.close(res));
    await rm(output, { recursive: true, force: true });
  }
});
