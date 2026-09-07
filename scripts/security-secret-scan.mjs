// Local-only credential scan: report classifications and locations, never values.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const findings = new Set();
let scanned = 0;
function inspect(text, location) {
  scanned += 1;
  const kinds = new Set();
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) kinds.add('private-key');
  if (/\bsk-[a-zA-Z0-9_-]{32,}\b/.test(text)) kinds.add('possible-provider-key');
  if (/\b(?:ghp_|github_pat_)[a-zA-Z0-9_]{30,}\b/.test(text)) kinds.add('possible-github-token');
  if (/\bsb_secret_[a-zA-Z0-9_-]{20,}\b/.test(text)) kinds.add('supabase-secret-key');
  for (const match of text.matchAll(/\beyJ[a-zA-Z0-9_-]+\.([a-zA-Z0-9_-]+)\.[a-zA-Z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[1], 'base64url').toString()).role === 'service_role') kinds.add('service-role-jwt');
    } catch { /* Not a JWT. */ }
  }
  for (const kind of kinds) findings.add(`${location}: ${kind}`);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
for (const path of tracked) {
  if (!/\.(?:[cm]?[jt]sx?|json|md|sql|ya?ml|toml|txt|env|pem|key)$/.test(path) && !path.startsWith('.env')) continue;
  inspect(readFileSync(path, 'utf8'), path);
}

if (process.argv.includes('--build')) {
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.(?:js|map|json)$/.test(file)) inspect(readFileSync(file, 'utf8'), file);
    }
  }
  if (!statSync('.next/static', { throwIfNoEntry: false })) throw new Error('Build output missing; run the production build first.');
  walk('.next/static');
}

if (process.argv.includes('--history')) {
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['log', '--all', '--format=commit:%h', '-p', '--', '.', ':!package-lock.json', ':!public'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let pending = '', commit = 'unknown', path = 'unknown';
    child.stdout.setEncoding('utf8');
    function line(value) {
      if (value.startsWith('commit:')) commit = value.slice(7);
      else if (value.startsWith('+++ b/')) path = value.slice(6);
      else if (value.startsWith('+') && !value.startsWith('+++')) inspect(value.slice(1), `${commit}:${path}`);
    }
    child.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop();
      lines.forEach(line);
    });
    child.on('error', reject);
    child.on('close', code => {
      if (pending) line(pending);
      if (code) reject(new Error('History scan failed; inspect git access without exposing raw diff.'));
      else resolve();
    });
    child.stderr.resume();
  });
}
console.log(`Scanned ${scanned} text files/history lines. Potential credential locations: ${findings.size}.`);
for (const finding of findings) console.log(finding);
console.log('Pattern scan only: no production environment values or provider credentials were inspected. Review fixture/placeholder matches before classifying exposure.');
if (findings.size) process.exitCode = 1;
