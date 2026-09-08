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
const root = resolve('.');

test('real Canvas settings service and React hook distinguish failures, recover, time out, and isolate accounts', { timeout: 120000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-canvas-settings-ui-'));
  let server, browser;
  try {
    const boundary = join(root, 'tests/fixtures/canvas-settings-boundary.ts');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/canvas-settings-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/supabase/client$': boundary,
        [join(root, 'lib/supabase/client')]: boundary, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => { compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true }))); else resolve();
    }));
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer((req, res) => {
      if (req.url === '/api/canvas/sync') { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Synthetic sync failure' })); return; }
      res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : 'text/html');
      res.end(req.url === '/bundle.js' ? bundle : '<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ timezoneId: 'UTC' });
    const errors = [], outside = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith(origin)) { outside.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.clock.install();
    await page.goto(origin);
    await page.waitForFunction(() => window.canvasFixture?.state.settings.icalUrl.endsWith('/alex.ics') && !window.canvasFixture.state.isLoading);
    const state = () => page.evaluate(() => ({ loading: window.canvasFixture.state.isLoading, error: window.canvasFixture.state.error, url: window.canvasFixture.state.settings.icalUrl }));
    await page.evaluate(() => { window.canvasFixture.controls.mode = 'error'; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => window.canvasFixture.state.error?.includes('Could not load Canvas settings'));
    assert.equal((await state()).url, 'https://example.invalid/alex.ics', 'a failed refresh must not disconnect a known connection');
    assert.equal(await page.evaluate(async () => {
      try { await window.canvasFixture.getCanvasSettings('alex', { throwOnError: true }); return 'silently empty'; } catch { return 'rejected'; }
    }), 'rejected', 'the real database service distinguishes an error from a missing row');
    await page.evaluate(() => { window.canvasFixture.controls.mode = 'success'; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => window.canvasFixture.state.error === null);
    await page.getByRole('button', { name: 'Sync', exact: true }).click();
    await page.waitForFunction(() => window.canvasFixture.state.error === 'Synthetic sync failure');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => window.canvasFixture.state.isSyncing === false);
    assert.equal((await state()).error, 'Synthetic sync failure', 'settings recovery must not erase a different sync failure');

    await page.evaluate(() => { window.canvasFixture.controls.mode = 'hang'; window.canvasFixture.switchUser('jamie'); });
    await page.waitForFunction(() => window.canvasFixture.state.isLoading && window.canvasFixture.state.settings.icalUrl === '');
    const reads = await page.evaluate(() => window.canvasFixture.controls.reads);
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('focus')); });
    assert.equal(await page.evaluate(() => window.canvasFixture.controls.reads), reads, 'focus events must not start overlapping settings reads');
    await page.clock.fastForward(20_001);
    await page.waitForFunction(() => !window.canvasFixture.state.isLoading && window.canvasFixture.state.error?.includes('Could not load Canvas settings'));
    assert.equal((await state()).url, '', 'timed-out new account must not expose the previous account feed');
    assert.ok(await page.evaluate(() => window.canvasFixture.controls.aborts > 0));
    await page.evaluate(() => { window.canvasFixture.controls.mode = 'success'; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => window.canvasFixture.state.settings.icalUrl.endsWith('/jamie.ics') && window.canvasFixture.state.error === null);
    await page.evaluate(() => { window.canvasFixture.controls.rowExists = false; window.dispatchEvent(new Event('focus')); });
    await page.waitForFunction(() => window.canvasFixture.state.settings.icalUrl === '');
    assert.equal((await state()).error, null, 'a genuinely missing connection is not a database failure');
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, [], 'fixtures never access a real feed or database');
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(output, { recursive: true, force: true });
  }
});
