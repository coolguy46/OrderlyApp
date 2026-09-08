import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = resolve('.');

function fixture({ user = { id: 'owner-fixture' }, records = {}, failedTable, ignoreCursor = false, injectForeign = false } = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from(table) {
      const call = { table }; calls.push(call);
      const query = {
        select(fields) { call.fields = fields; return query; },
        eq(field, value) { call.owner = [field, value]; return query; },
        order(field, options) { call.order = [field, options]; return query; },
        limit(value) { call.limit = value; return query; },
        gt(field, value) { call.cursor = value; return query; },
        async abortSignal(signal) {
          signal.throwIfAborted();
          if (table === failedTable) return { data: null, error: { message: 'PRIVATE DATABASE ERROR' } };
          const rows = (records[table] ?? []).filter(row => (injectForeign || row[call.owner[0]] === call.owner[1])
            && (ignoreCursor || !call.cursor || row.id > call.cursor)).sort((a, b) => a.id.localeCompare(b.id));
          // Simulate a database cap SMALLER than the requested page size.
          return { data: rows.slice(0, 2), error: null };
        },
      };
      return query;
    },
  };
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path).exports;
    const mod = { exports: {} }; cache.set(path, mod);
    const output = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', output)((specifier) => {
      if (specifier === '@/lib/supabase/server') return { createSupabaseServerClient: async () => client };
      if (specifier.startsWith('@/')) return load(resolve(root, specifier.slice(2) + '.ts'));
      if (specifier.startsWith('.')) return load(resolve(dirname(path), specifier + '.ts'));
      return require(specifier);
    }, mod, mod.exports);
    return mod.exports;
  }
  return { route: load(resolve(root, 'app/api/account/export/route.ts')), helper: load(resolve(root, 'lib/account-export.ts')), client, calls };
}

const request = () => new Request('https://orderly.example/api/account/export?user_id=other-fixture');
const rows = Array.from({ length: 7 }, (_, index) => ({ id: `task-${index}`, user_id: 'owner-fixture', title: `Saved task ${index}` }));

test('export rejects signed-out users without querying account data', async () => {
  const { route, calls } = fixture({ user: null });
  const response = await route.GET(request());
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(calls, []);
});

test('export reads every page from the server for the verified owner, including events and saved chats', async () => {
  const records = {
    tasks: [...rows, { id: 'foreign', user_id: 'other-fixture', title: 'Private foreign task' }],
    recurring_commitments: [{ id: 'event-1', user_id: 'owner-fixture', title: 'Team practice' }],
    planner_plans: [{ id: 'plan-1', user_id: 'owner-fixture', messages: [{ role: 'user', content: 'Plan my week' }] }],
  };
  const { route, calls } = fixture({ records });
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.version, 2);
  assert.deepEqual(result.tasks.map(row => row.id), rows.map(row => row.id));
  assert.equal(result.events[0].title, 'Team practice');
  assert.equal(result.plans[0].messages[0].content, 'Plan my week');
  assert.equal(result.accountId, 'owner-fixture');
  assert.ok(calls.every(call => call.owner[1] === 'owner-fixture'));
  assert.equal(calls.filter(call => call.table === 'tasks').length, 5);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  records.tasks.push({ id: 'task-9', user_id: 'owner-fixture', title: 'New saved task' });
  assert.equal((await (await route.GET(request())).json()).tasks.length, 8);
});

test('feed URLs, auth tokens and unexpected future credential columns never enter the export', async () => {
  const records = { canvas_settings: [{ id: 'canvas-1', user_id: 'owner-fixture', sync_enabled: true,
    ical_url: 'https://private.example/secret-feed', access_token: 'PRIVATE TOKEN', future_secret: 'PRIVATE SECRET' }] };
  const { route, calls } = fixture({ records });
  const response = await route.GET(request());
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /secret-feed|PRIVATE TOKEN|PRIVATE SECRET/);
  assert.ok(calls.every(call => !call.fields.includes('*') && !call.fields.includes('ical_url')));
});

test('one failed collection fails the whole export, never a successful empty or partial download', async () => {
  const { route } = fixture({ records: { tasks: rows }, failedTable: 'planner_blocks' });
  const response = await route.GET(request());
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.match(body, /No partial file/);
  assert.doesNotMatch(body, /PRIVATE DATABASE ERROR|Saved task/);
  assert.equal(response.headers.get('content-disposition'), null);
});

test('export detects non-advancing pagination and unexpected foreign rows', async () => {
  for (const options of [
    { records: { tasks: rows }, ignoreCursor: true },
    { records: { tasks: [{ id: 'foreign', user_id: 'other-fixture' }] }, injectForeign: true },
  ]) {
    const { route } = fixture(options);
    assert.equal((await route.GET(request())).status, 503);
  }
});

test('aborted or oversized exports fail explicitly without silently dropping records', async () => {
  const { helper, client } = fixture({ records: { tasks: rows } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(helper.readAccountExport(client, 'owner-fixture', controller.signal), { name: 'AbortError' });
  const { route } = fixture({ records: { tasks: [{ ...rows[0], description: 'x'.repeat(3_500_001) }] } });
  const response = await route.GET(request());
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /No partial export/);
});

test('every export field exists in the real schema and planner migrations', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create role authenticated; create role anon; create role service_role;
      create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
      create function uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;`);
    for (const path of ['lib/supabase/schema.sql', 'lib/supabase/task-scheduling-migration.sql', 'lib/supabase/planner-migration.sql', 'lib/supabase/assistant-conversation-migration.sql']) {
      await db.exec(readFileSync(resolve(root, path), 'utf8').replace(/^CREATE EXTENSION[^;]+;/gmi, ''));
    }
    const { helper } = fixture();
    for (const [table, fields] of Object.entries(helper.ACCOUNT_EXPORT_FIELDS)) {
      await db.query(`select ${fields} from ${table} limit 0`);
    }
  } finally { await db.close(); }
});
