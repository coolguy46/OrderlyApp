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

test('billing UI: trial checkout in AI-only gate, cancellation, failure recovery, free tools, responsive states and owner isolation', { timeout: 120000 }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'orderly-billing-ui-'));
  let server, browser;
  try {
    const boundary = join(root, 'tests/fixtures/billing-ui-runtime.tsx');
    const compiler = webpack({ mode: 'development', context: root, entry: './tests/fixtures/billing-ui.tsx', devtool: false,
      output: { path: output, filename: 'bundle.js' },
      resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/store$': boundary, 'next/link$': boundary, '@': root } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: join(root, 'tests/fixtures/calendar-ui-loader.cjs') }] },
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
    });
    await new Promise((resolve, reject) => compiler.run((error, stats) => { compiler.close(() => {}); if (error || stats.hasErrors()) reject(error || new Error(stats.toString({ all: false, errors: true }))); else resolve(); }));
    const css = (await postcss([tailwind({ base: root })]).process(await readFile(join(root, 'app/globals.css'), 'utf8'), { from: join(root, 'app/globals.css') })).css;
    const bundle = await readFile(join(output, 'bundle.js'));
    server = createServer((req, res) => {
      res.setHeader('Content-Type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
      res.end(req.url === '/bundle.js' ? bundle : req.url === '/style.css' ? css : '<html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ headless: true, channel: 'chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], outside = [], mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    const locked = { enabled: true, sandbox: true, checkoutEnabled: true, subscriptionRequired: true, aiAccess: false, hasSubscription: false, canManage: false, status: 'none', trialEligible: true, trialEndsAt: null, accessEndsAt: null };
    let status = { ...locked }, failStatus = false, checkoutResult = { error: 'Synthetic billing outage. Try again.' };
    let delayStatus = null, previewAllowed = false, previewFailure = false;
    let previewUrl = 'https://buy.stripe.com/test_fixture';
    await page.route('**/*', async route => {
      const req = route.request();
      if (req.url() === 'https://buy.stripe.com/test_fixture') return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic sandbox checkout</p>' });
      if (req.url() === 'https://checkout.stripe.com/c/pay/synthetic') return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic secure checkout</p>' });
      if (!req.url().startsWith(origin + '/')) { outside.push(req.url()); return route.abort(); }
      if (req.url().endsWith('/api/billing/preview')) return route.fulfill({ status: previewAllowed ? 200 : 403, json: { allowed: previewAllowed, userId: 'billing-test-alex' } });
      if (req.url().includes('/api/billing/preview/checkout')) {
        mutations.push({ url: req.url(), body: req.postData() });
        return route.fulfill({ status: previewFailure ? 403 : 200, json: { sandbox: true, url: previewUrl } });
      }
      if (req.url().endsWith('/api/billing/status')) {
        const current = structuredClone(status), failed = failStatus, pause = delayStatus;
        if (pause) await pause;
        return route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Cannot verify AI access. Try again.' } : current }).catch(() => {});
      }
      if (req.method() === 'POST') { mutations.push({ url: req.url(), body: req.postData() }); return route.fulfill({ status: checkoutResult.url ? 200 : 503, json: checkoutResult }); }
      return route.continue();
    });

    await page.goto(origin + '/planner?gate&checkout=success');
    const trialButton = () => page.getByRole('button', { name: 'Start 7-day free trial', exact: true });
    await trialButton().waitFor();
    await page.getByText(/AI unlocks only when your subscription is confirmed/).waitFor();
    assert.equal(await page.getByText('AI chat available', { exact: true }).count(), 0, 'success address never grants access');
    assert.equal(await page.getByRole('textbox', { name: 'Private AI message' }).count(), 0, 'private chat is not mounted under blur');
    assert.equal(await page.getByRole('button', { name: 'Send AI message' }).count(), 0);
    await page.getByText('Then $4.99 USD / month', { exact: true }).waitFor();
    await page.getByText(/Payment method required/).waitFor();
    await page.getByRole('button', { name: 'Create manual task' }).click();
    await page.getByText('Manual task saved', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Undo previous change' }).click();
    await page.getByText('Previous change undone', { exact: true }).waitFor();
    await trialButton().focus();
    assert.equal(await trialButton().evaluate(element => document.activeElement === element), true);
    await page.keyboard.press('Enter');
    await page.getByRole('alert').filter({ hasText: 'Synthetic billing outage' }).waitFor();
    assert.equal(mutations.length, 1); assert.equal(mutations[0].body, null);
    assert.ok(mutations[0].url.endsWith('/api/billing/checkout'), 'trial starts directly on Assistant tab');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no mobile overflow');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    checkoutResult = { url: 'https://checkout.stripe.com/c/pay/synthetic' };
    await trialButton().click();
    await page.getByText('Synthetic secure checkout', { exact: true }).waitFor();
    status = { ...locked, aiAccess: true, hasSubscription: true, canManage: true, status: 'trialing', trialEligible: false, trialEndsAt: new Date(Date.now() + 7 * 86400000).toISOString(), accessEndsAt: new Date(Date.now() + 7 * 86400000).toISOString() };
    await page.goto(origin + '/planner?gate&checkout=success');
    await page.getByText('AI chat available', { exact: true }).waitFor();
    await page.getByText(/Your free trial is active.*First charge: \$4.99 USD on/).waitFor();
    assert.equal(await trialButton().count(), 0);
    status = { ...status, cancelAtPeriodEnd: true };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText(/Trial canceled.*You will not be charged/).waitFor();
    await page.getByRole('textbox', { name: 'Private AI message' }).waitFor();
    status = { ...status, status: 'active', trialEndsAt: null };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByText(/Renewal canceled.*You will not be charged again/).waitFor();
    checkoutResult = { error: 'Synthetic billing outage. Try again.' };
    await page.getByRole('button', { name: 'Manage subscription', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Synthetic billing outage' }).waitFor();
    assert.ok(mutations.at(-1).url.endsWith('/api/billing/portal'));
    assert.equal(mutations.at(-1).body, null);

    // The effective access end can precede trial_end; recheck at the earlier deadline.
    status = { ...status, status: 'trialing', trialEndsAt: new Date(Date.now() + 60000).toISOString(), accessEndsAt: new Date(Date.now() + 1000).toISOString() };
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin + '/planner?gate');
    await page.getByText('AI chat available', { exact: true }).waitFor();
    status = { ...locked, trialEligible: false };
    await page.getByRole('button', { name: 'Subscribe for $4.99/month', exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await page.getByRole('textbox', { name: 'Private AI message' }).count(), 0, 'effective trial expiry relocks only AI');
    await page.getByRole('button', { name: 'Create manual task' }).click();
    await page.getByText('Manual task saved', { exact: true }).waitFor();

    status = { ...locked, sandbox: false, trialEligible: false };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('button', { name: 'Subscribe for $4.99/month', exact: true }).waitFor();
    assert.equal(await trialButton().count(), 0, 'returning accounts never get a promised second trial');
    await page.getByText(/free trial is available only once per account/).waitFor();
    status = { ...status, checkoutEnabled: false };
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByText(/New subscriptions are not available yet/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Subscribe for $4.99/month', exact: true }).count(), 0);
    status = { ...locked, aiAccess: false, hasSubscription: true, canManage: true, status: 'past_due', trialEligible: false };
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByText(/Your subscription needs attention/).waitFor();
    assert.equal(await trialButton().count(), 0);

    failStatus = true;
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Cannot verify AI access' }).waitFor();
    assert.equal(await page.getByText('AI chat available', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Create manual task' }).click();
    await page.getByText('Manual task saved', { exact: true }).waitFor();
    failStatus = false;
    status = { enabled: false, subscriptionRequired: false };
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByText('AI chat available', { exact: true }).waitFor();
    status = {};
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Could not check AI access' }).waitFor();
    assert.equal(await page.getByText('AI chat available', { exact: true }).count(), 0);

    status = { ...locked, aiAccess: true, hasSubscription: true, canManage: true, status: 'active', trialEligible: false };
    let release;
    delayStatus = new Promise(resolve => { release = resolve; });
    await page.reload();
    await page.getByText('Checking AI access…', { exact: true }).waitFor();
    status = { ...locked };
    delayStatus = null;
    await page.evaluate(() => window.billingFixture.signIn('billing-test-another-user'));
    await trialButton().waitFor();
    release();
    await page.getByText('Your first 7 days are free', { exact: true }).waitFor();
    assert.equal(await page.getByText('AI chat available', { exact: true }).count(), 0, 'old owner response cannot unlock new owner');

    await page.goto(origin + '/settings/billing');
    await trialButton().waitFor();
    status = { ...locked, hasSubscription: true, aiAccess: true, canManage: true, status: 'trialing', trialEligible: false, cancelAtPeriodEnd: true, trialEndsAt: new Date(Date.now() + 86400000).toISOString() };
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await page.getByText(/Trial canceled.*You will not be charged/).waitFor();
    await page.getByRole('button', { name: 'Manage subscription', exact: true }).waitFor();
    await page.evaluate(() => window.billingFixture.signOut());
    await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Manage subscription', exact: true }).count(), 0);

    status = { ...locked, sandbox: false };
    await page.goto(origin + '/planner?gate');
    await trialButton().waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.ORDERLY_BILLING_SCREENSHOT) await page.screenshot({ path: process.env.ORDERLY_BILLING_SCREENSHOT, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (process.env.ORDERLY_BILLING_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.ORDERLY_BILLING_DESKTOP_SCREENSHOT, fullPage: true });
    assert.equal(await page.getByRole('button', { name: 'Preview AI screens' }).count(), 0, 'ordinary accounts have no preview');
    previewAllowed = true;
    status = { enabled: false, subscriptionRequired: false };
    await page.goto(origin + '/planner?gate');
    const previewButton = page.getByRole('button', { name: 'Preview AI screens' });
    await previewButton.click();
    const dialog = page.getByRole('dialog', { name: 'AI screen preview' });
    const select = dialog.getByRole('combobox', { name: 'Screen to preview' });
    await dialog.getByText('Test mode · no real charges', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Start 7-day free trial' }).waitFor();
    const baselineMutations = mutations.length;
    await select.selectOption('trial');
    await dialog.getByText(/Your free trial is active/).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: 'Sample assistant composer' }).isDisabled(), true);
    await dialog.getByRole('button', { name: 'Manage subscription' }).click();
    await dialog.getByText('Billing settings · simulated', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Simulate cancellation' }).click();
    await dialog.getByText(/Trial canceled.*You will not be charged/).waitFor();
    await select.selectOption('paid');
    await dialog.getByText(/Subscription active/).waitFor();
    await dialog.getByRole('button', { name: 'Manage subscription' }).click();
    await dialog.getByRole('button', { name: 'Simulate cancellation' }).click();
    await dialog.getByRole('status').filter({ hasText: /Renewal canceled/ }).waitFor();
    for (const value of ['expired', 'pastDue', 'pending', 'abandoned', 'setup', 'loading', 'error', 'locked']) await select.selectOption(value);
    assert.equal(mutations.length, baselineMutations, 'simulations never call billing mutations');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), 'preview fits mobile width');
    if (process.env.ORDERLY_PREVIEW_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.ORDERLY_PREVIEW_MOBILE_SCREENSHOT });
    await page.setViewportSize({ width: 1280, height: 900 });
    if (process.env.ORDERLY_PREVIEW_DESKTOP_SCREENSHOT) await page.screenshot({ path: process.env.ORDERLY_PREVIEW_DESKTOP_SCREENSHOT });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await previewButton.evaluate(el => document.activeElement === el), true, 'focus returns to preview trigger');
    await page.getByRole('textbox', { name: 'Private AI message' }).fill('Keep my draft');
    await previewButton.click();
    previewFailure = true;
    await dialog.getByRole('button', { name: 'Start 7-day free trial' }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Could not open test checkout' }).waitFor();
    assert.ok(mutations.at(-1).url.endsWith('/api/billing/preview/checkout?kind=trial'));
    previewFailure = false; previewUrl = 'https://buy.stripe.com/live_not_allowed';
    await dialog.getByRole('button', { name: 'Start 7-day free trial' }).click();
    await dialog.getByRole('alert').filter({ hasText: 'Test checkout address could not be verified' }).waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('textbox', { name: 'Private AI message' }).inputValue(), 'Keep my draft', 'real assistant remains mounted and unchanged');
    await previewButton.click();
    previewUrl = 'https://buy.stripe.com/test_fixture';
    await select.selectOption('expired');
    await dialog.getByRole('button', { name: 'Subscribe for $4.99/month' }).click();
    await page.getByText('Synthetic sandbox checkout', { exact: true }).waitFor();
    assert.ok(mutations.at(-1).url.endsWith('/api/billing/preview/checkout?kind=subscription'));
    status = { ...locked };
    await page.goto(origin + '/planner?gate&billingPreviewReturn=1');
    await previewButton.click();
    await dialog.getByText(/This return link does not confirm payment/).waitFor();
    await select.selectOption('paid');
    assert.equal(await page.getByRole('textbox', { name: 'Private AI message', includeHidden: true }).count(), 0, 'simulated paid state never unlocks real chat');
    await page.evaluate(() => window.billingFixture.signIn('billing-test-other'));
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await previewButton.count(), 0, 'account switch removes preview');
    await page.evaluate(() => window.billingFixture.signOut());
    assert.equal(await previewButton.count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(output, { recursive: true, force: true });
  }
});
