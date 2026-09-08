import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Discover all suites so new regressions cannot quietly be omitted from npm
// test. Browser suites use the shared optional Playwright runtime convention.
const browser = process.argv.includes('--browser');
const files = readdirSync(new URL('../tests/', import.meta.url))
  .filter(file => file.endsWith('.test.mjs'))
  .filter(file => readFileSync(new URL(`../tests/${file}`, import.meta.url), 'utf8')
    .includes('ORDERLY_PLAYWRIGHT_MODULE') === browser)
  .sort().map(file => `tests/${file}`);
if (!files.length) throw new Error('No test suites were found');
console.log(`Running ${files.length} ${browser ? 'browser' : 'unit/integration'} test files.`);
const result = spawnSync(process.execPath, ['--test', '--experimental-strip-types',
  `--test-concurrency=${browser ? 1 : 2}`, ...files], {
  stdio: 'inherit', cwd: new URL('../', import.meta.url), env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
