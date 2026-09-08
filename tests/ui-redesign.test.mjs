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
const routes = ['/', '/tasks', '/calendar', '/calendar?view=schedule', '/planner', '/goals', '/study', '/exams', '/settings', '/settings/integrations', '/profile', '/landing', '/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password', '/setup', '/privacy', '/terms'];

test('redesigned real pages and shell render in desktop/mobile light/dark without overflow or external data', { timeout: 240000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-ui-redesign-'));
  let browser, server;
  try {
    const runtime = join(root, 'tests/fixtures/ui-redesign-runtime.tsx');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/ui-redesign.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
        '@/lib/store$': runtime, '@/lib/planner/store$': runtime, '@/lib/schedule/store$': runtime,
        'next/navigation$': runtime, 'next/link$': runtime, 'next/image$': runtime,
        '@/lib/supabase/client$': runtime, '@/lib/supabase/services$': runtime,
        '@/lib/integrations/useCanvasSyncSupabase$': runtime, '@': root,
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
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    server = createServer(async (req, res) => {
      const path = new URL(req.url, 'http://fixture.invalid').pathname;
      if (path === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
      else if (path === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
      else if (path.startsWith('/api/')) { res.writeHead(403); res.end('Synthetic fixture: API disabled'); }
      else if (routes.some(route => route.split('?')[0] === path)) { res.setHeader('Content-Type', 'text/html'); res.end(html); }
      else {
        const asset = resolve(root, 'public', `.${decodeURIComponent(path)}`);
        if (!asset.startsWith(join(root, 'public') + sep)) { res.writeHead(403); res.end(); return; }
        try {
          const bytes = await readFile(asset);
          const types = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
          res.setHeader('Content-Type', types[extname(asset)] || 'application/octet-stream'); res.end(bytes);
        } catch { res.writeHead(404); res.end(); }
      }
    });
    await new Promise(res => server.listen(0, '127.0.0.1', res));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const selectedRoutes = process.env.ORDERLY_REDESIGN_ROUTES?.split(',') || routes;
    for (const [width, height, theme] of [[1440, 1000, 'dark'], [1440, 1000, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
      for (const route of selectedRoutes) {
        const name = `${route === '/' ? 'dashboard' : route.slice(1).replaceAll('/', '-').replace('?view=', '-')}-${width}-${theme}`;
        const page = await browser.newPage({ viewport: { width, height }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
        const errors = [], externalRequests = [], mutations = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(mode => { document.addEventListener('DOMContentLoaded', () => document.documentElement.classList.toggle('dark', mode === 'dark')); }, theme);
        await page.route('**/*', requestRoute => {
          const request = requestRoute.request(), url = request.url();
          if (!url.startsWith(origin)) { externalRequests.push(url); return requestRoute.abort(); }
          if (request.method() !== 'GET') { mutations.push(`${request.method()} ${new URL(url).pathname}`); return requestRoute.abort(); }
          if (url.includes('/api/auth/password-recovery')) return requestRoute.fulfill({ json: { valid: true } });
          if (url.includes('/api/')) return requestRoute.fulfill({ status: 403, json: { error: 'Synthetic visual fixture: API disabled' } });
          return requestRoute.continue();
        });
        await page.clock.setSystemTime(new Date('2026-09-07T21:00:00Z'));
        await page.goto(`${origin}${route}`);
        // Let staggered Framer Motion entry animations settle before checking presentation.
        await page.waitForTimeout(1500);
        await page.evaluate(mode => { window.uiRedesignFixture.setTheme(mode); window.scrollTo(0, 0); }, theme);
        assert.deepEqual(errors, [], `${name}: no page errors`);
        assert.equal(await page.getByText('Something went wrong', { exact: true }).count(), 0, `${name}: no error boundary`);
        assert.ok((await page.locator('body').innerText()).length > 100, `${name}: actual page content renders`);
        const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
          offenders: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth + 2 && getComputedStyle(el).position !== 'fixed').slice(0, 5).map(el => ({ tag: el.tagName, class: el.className })) }));
        assert.ok(overflow.document <= width + 1, `${name}: no horizontal page overflow ${JSON.stringify(overflow)}`);
        assert.deepEqual(externalRequests, [], `${name}: no external requests`);
        assert.deepEqual(mutations, [], `${name}: no network mutations`);
        assert.deepEqual(await page.evaluate(() => window.uiRedesignFixture.mutationCalls), [], `${name}: no fixture mutations`);
        if (process.env.ORDERLY_REDESIGN_SCREENSHOT_DIR) {
          await mkdir(process.env.ORDERLY_REDESIGN_SCREENSHOT_DIR, { recursive: true });
          // Cancelling native animations can restore Framer's initial opacity instead of its settled state.
          await page.screenshot({ path: join(process.env.ORDERLY_REDESIGN_SCREENSHOT_DIR, `${name}.png`), animations: 'allow' });
        }
        console.log(`Verified ${name}`);
        await page.close();
      }
    }
    // Exercise the real shell after the readonly catalog. Only isolated UI state
    // and recorded router intent may change; no account/task/calendar writes.
    const shell = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const shellErrors = [], shellNetworkWrites = [], shellExternal = [];
    shell.on('pageerror', error => shellErrors.push(error.message));
    await shell.route('**/*', requestRoute => {
      const request = requestRoute.request();
      if (!request.url().startsWith(origin)) { shellExternal.push(request.url()); return requestRoute.abort(); }
      if (request.method() !== 'GET') { shellNetworkWrites.push(request.method()); return requestRoute.abort(); }
      if (request.url().includes('/api/')) return requestRoute.fulfill({ status: 403, json: { error: 'Synthetic visual fixture: API disabled' } });
      return requestRoute.continue();
    });
    await shell.clock.setSystemTime(new Date('2026-09-07T21:00:00Z'));
    await shell.goto(origin);
    await shell.getByRole('button', { name: 'Collapse sidebar', exact: true }).click();
    await shell.getByRole('button', { name: 'Expand sidebar', exact: true }).waitFor();
    const mainNav = shell.getByRole('navigation', { name: 'Main navigation', exact: true });
    for (const [name, href] of [['Dashboard', '/'], ['Tasks', '/tasks'], ['Calendar', '/calendar'], ['Assistant', '/planner'], ['Goals', '/goals'], ['Study', '/study'], ['Exams', '/exams'], ['Settings', '/settings']]) {
      assert.equal(await mainNav.getByRole('link', { name, exact: true }).getAttribute('href'), href, `collapsed sidebar retains ${name}`);
    }
    await shell.getByRole('button', { name: 'Expand sidebar', exact: true }).click();
    await shell.getByRole('button', { name: 'Collapse sidebar', exact: true }).waitFor();
    await shell.keyboard.press('Control+k');
    const search = shell.getByRole('textbox', { name: 'Search tasks, goals, and exams', exact: true });
    await search.waitFor();
    await shell.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search tasks, goals, and exams');
    await search.fill('Biology');
    await shell.getByRole('button', { name: 'Biology Worksheet medium priority', exact: true }).click();
    assert.deepEqual(await shell.evaluate(() => window.uiRedesignFixture.navigationCalls), ['/tasks'], 'global search preserves task navigation intent');
    await shell.getByRole('button', { name: 'Profile menu', exact: true }).click();
    const menu = shell.getByRole('menu');
    await menu.waitFor();
    assert.equal(await menu.getByRole('menuitem', { name: 'Profile', exact: true }).getAttribute('href'), '/profile');
    assert.equal(await menu.getByRole('menuitem', { name: 'Settings', exact: true }).getAttribute('href'), '/settings');
    await menu.getByRole('menuitem', { name: 'Sign out', exact: true }).waitFor();
    await shell.keyboard.press('Escape');
    await shell.getByRole('button', { name: 'Help and tutorial', exact: true }).click();
    await shell.getByRole('dialog', { name: 'Your guide to Orderly', exact: true }).waitFor();
    await shell.getByRole('button', { name: 'Start tour', exact: true }).waitFor();
    await shell.getByRole('button', { name: 'Close tutorial', exact: true }).click();
    await shell.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Help and tutorial');
    assert.deepEqual(await shell.evaluate(() => window.uiRedesignFixture.mutationCalls), [], 'desktop shell does not mutate account data');
    await shell.setViewportSize({ width: 390, height: 844 });
    await shell.getByRole('navigation', { name: 'Mobile navigation', exact: true }).getByRole('button', { name: 'More', exact: true }).click();
    await mainNav.getByRole('link', { name: 'Settings', exact: true }).click();
    await shell.waitForURL(`${origin}/settings`);
    await shell.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.deepEqual(shellErrors, [], 'shell interactions produce no page errors');
    assert.deepEqual(shellExternal, [], 'shell interactions make no external requests');
    assert.deepEqual(shellNetworkWrites, [], 'shell interactions make no network writes');
    assert.deepEqual(await shell.evaluate(() => window.uiRedesignFixture.mutationCalls), [], 'mobile shell does not mutate account data');
    await shell.close();
    console.log('Verified real shell collapse/expand, route access, keyboard search, profile menu, help/focus return, and mobile Settings navigation');
  } finally {
    await browser?.close();
    if (server) await new Promise(res => server.close(res));
    await rm(output, { recursive: true, force: true });
  }
});
