import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const scanner = resolve('scripts/security-secret-scan.mjs');
const syntheticKey = 'sk_test_' + 'x'.repeat(30);

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'orderly-secret-scan-'));
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: directory, stdio: 'pipe' });
    writeFileSync(join(directory, '.gitignore'), '.env*\n.next/\n');
    return run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function scan(directory, arguments_ = []) {
  const result = spawnSync(process.execPath, [scanner, ...arguments_], { cwd: directory, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(syntheticKey), 'Scanner must never print credential values.');
  return result;
}

test('credential scan catches a new untracked application file without requiring a commit', () => fixture(directory => {
  mkdirSync(join(directory, 'lib'));
  writeFileSync(join(directory, 'lib', 'new-security-code.ts'), `export const accidental = '${syntheticKey}';`);
  const result = scan(directory);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /lib\/new-security-code\.ts: stripe-secret-key/);
}));

test('credential scan preserves ignored environment worksheets and unrelated local experiments', () => fixture(directory => {
  for (const folder of ['design-lab', 'research']) {
    mkdirSync(join(directory, folder));
    writeFileSync(join(directory, folder, 'unrelated.ts'), syntheticKey);
  }
  writeFileSync(join(directory, '.env.local'), syntheticKey);
  writeFileSync(join(directory, 'safe.ts'), 'export const ready = true;');
  const result = scan(directory);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Potential credential locations: 0/);
}));

test('credential scan can inspect the exact isolated production bundle instead of stale root output', () => fixture(directory => {
  const buildDirectory = join(directory, '.next', 'static', 'chunks');
  mkdirSync(buildDirectory, { recursive: true });
  writeFileSync(join(buildDirectory, 'example.js'), `window.accidental = '${syntheticKey}';`);
  const result = scan(directory, ['--build', `--build-dir=${buildDirectory}`]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /example\.js: stripe-secret-key/);
}));

test('missing build output fails closed instead of implying a client-bundle scan succeeded', () => fixture(directory => {
  const result = scan(directory, ['--build', `--build-dir=${join(directory, 'missing')}`]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Build output missing/);
}));
