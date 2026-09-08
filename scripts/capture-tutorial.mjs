// Real component screenshots, isolated fictional data, and no production API access.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.ORDERLY_PLAYWRIGHT_MODULE || 'playwright');
const sharp = require(process.env.ORDERLY_SHARP_MODULE || 'sharp');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const root = resolve('.');
const output = await mkdtemp(join(tmpdir(), 'orderly-tutorial-capture-'));
let browser, server;
try {
  const stores = join(root, 'tests/fixtures/tutorial-demo-stores.ts');
  const boundaries = join(root, 'tests/fixtures/tutorial-demo-boundaries.tsx');
  const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/tutorial-demo.tsx', devtool: false,
    output: { path: output, filename: 'bundle.js' },
    resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
      '@/lib/store$': stores, '@/lib/planner/store$': stores, '@/lib/schedule/store$': stores,
      '@/components/layout$': boundaries, 'next/navigation$': boundaries,
      '@/lib/supabase/client$': boundaries, '@/lib/supabase/services$': boundaries,
      '@/lib/integrations/useCanvasSyncSupabase$': boundaries, '@': root,
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
  server = createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); }
    else if (req.url === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
    else if (req.url.startsWith('/api/')) { res.writeHead(403); res.end('Screenshot fixture: API disabled'); }
    else res.end('<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{font-family:Arial,sans-serif}*{caret-color:transparent!important}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  const target = join(root, 'public/tutorial');
  await mkdir(target, { recursive: true });
  const views = process.env.ORDERLY_TUTORIAL_VIEWS?.split(',') || ['dashboard', 'tasks', 'task-editor', 'event-editor', 'calendar', 'schedule', 'assistant', 'goals', 'study', 'exams', 'settings', 'canvas-integration'];
  for (const view of views) {
    console.log(`Capturing ${view}`);
    // A fresh browser context keeps storage and animation clocks isolated per
    // image; every view begins with the same dataset, not the last view's state.
    // The dashboard's desktop calendar sits beside the task list at the xl
    // breakpoint. Keep the capture area at 1160px, but select the desktop
    // layout so the guide includes the actual calendar rather than its top edge.
    const page = await browser.newPage({ viewport: { width: view === 'dashboard' ? 1440 : 1160, height: view === 'assistant' ? 1000 : 850 }, timezoneId: 'America/Los_Angeles', reducedMotion: 'reduce' });
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(origin) && !url.includes('/api/') ? route.continue() : route.abort();
    });
    await page.clock.setSystemTime(new Date('2026-09-07T21:00:00Z'));
    await page.goto(`${origin}/?view=${view}`);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    assert.deepEqual(errors, [], `No render errors in ${view}`);
    if (view === 'task-editor') {
      await page.locator('#description').waitFor();
      await page.getByRole('button', { name: 'Description Optional', exact: true }).click();
      await page.locator('#scheduleDate').scrollIntoViewIfNeeded();
    }
    if (view === 'event-editor') await page.locator('#event-date').waitFor();
    if (view.endsWith('-editor')) await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    if (view === 'schedule') await page.locator('.scroll-touch').evaluate(element => { element.scrollTop = 15 * 60; });
    if (view === 'assistant') await page.locator('.overflow-y-auto').first().evaluate(element => { element.scrollTop = 0; });
    const element = view.endsWith('-editor') ? page.getByRole('dialog') : page.locator('[data-demo-capture]');
    const bounds = await element.boundingBox();
    assert.ok(bounds && bounds.width > 300 && bounds.height > 100, `Rendered ${view}`);
    // Keep Framer Motion's settled presentation; cancelling its animation here
    // would restore the initial opacity on browsers using native animations.
    const captureHeight = view === 'settings' ? 495 : Math.min(view.endsWith('-editor') ? 850 : bounds.height, 850);
    const png = await page.screenshot({ clip: { x: Math.max(0, bounds.x), y: 0, width: Math.min(bounds.width,1160), height: captureHeight }, animations: 'allow' });
    assert.ok((await sharp(png).stats()).entropy > 0.1, `Screenshot is not blank: ${view}`);
    await sharp(png).webp({ quality: 88 }).toFile(join(target, `${view}.webp`));
    await page.close();
  }
  console.log(`Captured ${views.length} demo screenshots with no external or production API requests.`);
} finally {
  await browser?.close();
  if (server) await new Promise(res => server.close(res));
  await rm(output, { recursive: true, force: true });
}
