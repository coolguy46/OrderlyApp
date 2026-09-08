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
const root = resolve('.');

test('AuthGuard survives StrictMode cleanup while deferred authentication settles', { timeout: 60000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-auth-guard-ui-'));
  let browser, server;
  try {
    const boundary = join(root, 'tests/fixtures/auth-guard-ui-boundaries.ts');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/auth-guard-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/store$': boundary, '@/lib/supabase/services$': boundary, 'next/navigation$': boundary, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }), 'process.browser': 'true' })],
    });
    await new Promise((resolveBuild, reject) => compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true })));
      else resolveBuild();
    }));
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer((request, response) => {
      if (request.url === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); }
      else response.end('<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    for (const outcome of ['signed-out', 'complete', 'incomplete', 'error']) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.goto(origin);
      await page.getByText('Loading...', { exact: true }).waitFor();
      await page.evaluate(value => window.authFixture.resolveAuth(value), outcome);
      if (outcome === 'complete') {
        await page.getByRole('heading', { name: 'Protected application content' }).waitFor({ timeout: 3000 });
      } else if (outcome === 'error') {
        await page.getByRole('heading', { name: 'We could not check your session' }).waitFor({ timeout: 3000 });
      } else {
        await page.waitForFunction(expected => window.authFixture.state().redirects.includes(expected), outcome === 'signed-out' ? '/landing' : '/setup', { timeout: 3000 });
      }
      const state = await page.evaluate(() => window.authFixture.state());
      assert.equal(state.initializationRequests, 1, 'one underlying initialization request despite StrictMode replay');
      assert.equal(state.authObservers, 2, 'each effect setup observes the shared initialization promise');
      assert.equal(state.setupChecks, outcome === 'complete' || outcome === 'incomplete' ? 1 : 0);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally {
    await browser?.close();
    if (server) await new Promise(resolveServer => server.close(resolveServer));
    await rm(output, { recursive: true, force: true });
  }
});
