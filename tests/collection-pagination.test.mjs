import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');
function fixture({ failPage = false, foreign = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: 1007 }, (_, index) => ({
    id: String(index).padStart(5, '0'), user_id: 'owner',
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    started_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    exam_date: new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10),
  }));
  const client = { from(table) {
    const call = { table }; calls.push(call);
    const query = {
      select() { return query; }, eq(field, value) { call.owner = [field, value]; return query; },
      order(field) { call.order = field; return query; }, limit(size) { call.limit = size; return query; },
      gt(field, value) { call.cursor = value; return query; },
      async abortSignal(signal) {
        signal.throwIfAborted();
        if (failPage && call.cursor) return { data: null, error: new Error('database unavailable') };
        return { data: rows.filter(row => !call.cursor || row.id > call.cursor).slice(0, 150)
          .map(row => ({ ...row, user_id: foreign ? 'another-user' : row.user_id })), error: null };
      },
      then(resolve) { return Promise.resolve({ data: rows.slice(0, 150), error: null }).then(resolve); },
    };
    return query;
  } };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const mod = { exports: {} }; cache.set(path, mod);
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', output)((specifier) => {
      if (specifier === './client') return { supabase: client };
      if (specifier.startsWith('@/')) return load(resolve(root, specifier.slice(2) + '.ts'));
      if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier + '.ts'));
      return require(specifier);
    }, mod, mod.exports);
    return mod.exports;
  }
  return { services: load(resolve(root, 'lib/supabase/services.ts')), calls, rows };
}

test('all five real collection services load beyond the database row cap and keep their display ordering', async () => {
  const { services, calls, rows } = fixture();
  for (const [method, descending] of [['getTasks', true], ['getGoals', true], ['getStudySessions', true], ['getSubjects', false], ['getExams', false]]) {
    const result = await services[method]('owner', { throwOnError: true });
    assert.equal(result.length, 1007, method);
    assert.equal(result[0].id, descending ? rows.at(-1).id : rows[0].id, method);
    assert.equal(new Set(result.map(row => row.id)).size, 1007);
  }
  assert.ok(calls.every(call => call.owner[0] === 'user_id' && call.owner[1] === 'owner' && call.order === 'id'));
});

test('a later-page failure cannot replace the account snapshot with a silently partial collection', async () => {
  const { services } = fixture({ failPage: true });
  await assert.rejects(services.getTasks('owner', { throwOnError: true }), /database unavailable/);
});

test('unexpected foreign rows are rejected even before they reach the store', async () => {
  const { services } = fixture({ foreign: true });
  await assert.rejects(services.getTasks('owner', { throwOnError: true }), /ownership/);
});
