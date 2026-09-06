import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = await mkdtemp(join(root, 'node_modules/.conversation-test-'));
const built = new Set();
async function compile(relative) {
  if (built.has(relative)) return;
  built.add(relative);
  const source = await readFile(join(root, relative), 'utf8');
  let output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const dependencies = [];
  output = output.replace(/require\("([^"\n]+)"\)/g, (match, specifier) => {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return match;
    const relativeDependency = specifier.startsWith('@/') ? specifier.slice(2) : resolve(dirname(relative), specifier).slice(process.cwd().length + 1);
    dependencies.push(`${relativeDependency}.ts`);
    return `require(${JSON.stringify(join(temporary, `${relativeDependency}.cjs`))})`;
  });
  const target = join(temporary, relative.replace(/\.ts$/, '.cjs'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output);
  for (const dependency of dependencies) await compile(dependency);
}
await compile('lib/planner/conversation.ts');
await compile('lib/planner/conversation-calendar.ts');
const { parseConversationIntent, conversationSystemPrompt, readConversationRequest } = require(join(temporary, 'lib/planner/conversation.cjs'));
const { calendarFromSnapshot, compileConversation, conversationFacts } = require(join(temporary, 'lib/planner/conversation-calendar.cjs'));
const db = new PGlite();
const owner = randomUUID(), other = randomUUID(), conversationId = randomUUID();
const NOW = '2026-09-06T20:00:00.000Z'; // Sunday, 1 PM Pacific.
const zone = 'America/Los_Angeles';

before(async () => {
  await db.exec(`create schema auth; create role authenticated; create role anon;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function uuid_generate_v4() returns uuid language sql as $$select gen_random_uuid()$$;
    grant usage on schema public,auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  const schema = await readFile(join(root, 'lib/supabase/schema.sql'), 'utf8');
  for (const table of ['profiles', 'subjects', 'tasks', 'exams']) {
    const ddl = schema.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`))?.[0];
    assert.ok(ddl, table);
    await db.exec(ddl);
  }
  const planner = await readFile(join(root, 'lib/supabase/planner-migration.sql'), 'utf8');
  // PGlite provides gen_random_uuid in core. Exercise the complete planner
  // migration, including the older outbox RPC that shares these event rows.
  await db.exec(planner.replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  await db.exec(await readFile(join(root, 'lib/supabase/task-scheduling-migration.sql'), 'utf8'));
  for (const table of ['tasks', 'exams', 'planner_preferences', 'recurring_commitments']) {
    await db.exec(`alter table ${table} enable row level security; create policy owner_only on ${table} for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid()); grant select,insert,update,delete on ${table} to authenticated;`);
  }
  await db.exec(await readFile(join(root, 'lib/supabase/assistant-conversation-migration.sql'), 'utf8'));
  await db.query('insert into auth.users(id) values($1),($2)', [owner, other]);
  await db.query("insert into profiles(id,email) values($1,'owner@test.invalid'),($2,'other@test.invalid')", [owner, other]);
  await db.query("insert into planner_preferences(user_id,time_zone,school_days,school_start_time,school_home_time,max_daily_minutes,min_break_minutes,weekend_available_start,weekend_available_end) values($1,'America/Los_Angeles',array[1,2,3,4,5], '08:00','15:30',960,0,'07:00','23:00')", [owner]);
  await db.exec("set timezone to 'UTC'");
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
});
after(async () => { await db.close(); await rm(temporary, { recursive: true, force: true }); });
async function snapshot() { return (await db.query('select public.assistant_calendar_snapshot() as data')).rows[0].data; }
function intent(operations, extras = {}) { return parseConversationIntent(JSON.stringify({ mode: 'act', reply: 'I can do that.', assumptions: [], operations, plan: null, ...extras })); }
async function apply(compiled, revision, requestId = randomUUID(), parsed = null) {
  return (await db.query('select public.apply_assistant_calendar_changes($1,$2,$3,$4,$5) as data', [requestId, conversationId, revision, JSON.stringify(compiled.writes), JSON.stringify({ reply: compiled.reply, intent: parsed, items: compiled.items })])).rows[0].data;
}
async function turn(text, operations, extras = {}, timeZone = zone, now = NOW) {
  const state = await snapshot();
  // Bulk language responses are mocked. The REAL semantic validation,
  // planner, PostgreSQL save transaction, and reloaded state are exercised.
  const parsed = intent(operations, extras);
  const compiled = compileConversation(parsed, calendarFromSnapshot(state, owner, now, timeZone));
  const receipt = await apply(compiled, state.revision, randomUUID(), parsed);
  return { receipt, state: await snapshot(), text };
}
async function undo(receipt) {
  return apply({ writes: receipt.undoOperations, reply: 'Undone', items: [] }, receipt.revision);
}

test('multi-turn typo, type correction, time/date follow-ups persist without duplicate items', async () => {
  const initial = await snapshot();
  const created = await turn('add a task for my counsler meeting today at 7', [{ action: 'create', entity: 'task', title: 'Counselor meeting', date: '2026-09-06', start: '19:00', durationMinutes: 30 }], { assumptions: ['I assumed 7 PM because 7 AM has passed.'] });
  const taskId = created.receipt.items[0].id;
  assert.equal(created.state.tasks.find(t => t.id === taskId).title, 'Counselor meeting');
  assert.equal(created.state.tasks.find(t => t.id === taskId).scheduled_start_at, '2026-09-07T02:00:00+00:00');
  const corrected = await turn('i meant an event', [{ action: 'convert', entity: 'event', id: taskId }]);
  const eventId = corrected.receipt.items[0].id;
  assert.ok(!corrected.state.tasks.some(t => t.id === taskId));
  assert.equal(corrected.state.events.filter(e => e.client_commitment_id === eventId).length, 1);
  const moved = await turn('make it 8', [{ action: 'update', entity: 'event', id: eventId, start: '20:00' }]);
  assert.equal(moved.state.events.find(e => e.client_commitment_id === eventId).end_time, '20:30:00');
  const tomorrow = await turn('move that to tomorrow', [{ action: 'update', entity: 'event', id: eventId, date: '2026-09-07' }]);
  assert.equal(tomorrow.state.events.find(e => e.client_commitment_id === eventId).start_date, '2026-09-07');
  assert.equal(tomorrow.state.events.length, initial.events.length + 1);
  await undo(tomorrow.receipt);
  // Remove test event; other tests use the same isolated database.
  const state = await snapshot();
  await apply({ writes: [{ entity: 'event', op: 'delete', id: eventId }], reply: 'cleanup', items: [] }, state.revision);
});

test('multiple typed additions preserve explicit times and do not invent recurrence', async () => {
  const result = await turn('hiking even saturday 4am to 9am and pickleball task 4 to 5pm', [
    { action: 'create', entity: 'event', title: 'Hiking', date: '2026-09-12', start: '04:00', end: '09:00', explicitStart: '04:00', explicitEnd: '09:00' },
    { action: 'create', entity: 'task', title: 'Pickleball', date: '2026-09-12', start: '16:00', end: '17:00', explicitEnd: '17:00' },
  ]);
  const hiking = result.state.events.find(e => e.title === 'Hiking');
  assert.equal(hiking.start_time, '04:00:00');
  assert.equal(hiking.end_date, hiking.start_date);
  assert.equal(result.state.tasks.find(t => t.title === 'Pickleball').duration_seconds, 3600);
  await undo(result.receipt);
});

test('discussion has no writes; malformed discussion-with-actions is rejected', async () => {
  const before = await snapshot();
  const result = await turn('would a meeting tomorrow be better?', [], { mode: 'discuss', reply: 'Tomorrow has more room in the evening.' });
  assert.equal(result.receipt.saved, false);
  assert.equal(result.state.revision, before.revision);
  assert.throws(() => intent([{ action: 'create', entity: 'event', title: 'Oops' }], { mode: 'discuss' }), /Discussion cannot/);
});

test('older planner snapshots cannot erase a newly created chat event', async () => {
  const before = await snapshot();
  const result = await turn('add a test event', [{ action: 'create', entity: 'event', title: 'Cross-tab event', date: '2026-09-06', start: '18:00', durationMinutes: 20 }]);
  assert.equal(result.state.preferences.revision, before.preferences.revision + 1);
  const stalePayload = { preferences: before.preferences, commitments: before.events, plans: [], feedback: [], adjustments: [] };
  const stale = await db.query('select replace_planner_snapshot($1,$2,true) as revision', [before.preferences.revision, JSON.stringify(stalePayload)]);
  assert.equal(stale.rows[0].revision, null);
  await db.query('select replace_planner_snapshot($1,$2,false)', [result.state.preferences.revision, JSON.stringify(stalePayload)]);
  const after = await snapshot();
  assert.equal(after.events.filter(event => event.title === 'Cross-tab event').length, 1);
  await apply({ writes: [{ entity: 'event', op: 'delete', id: result.receipt.items[0].id }], reply: 'cleanup', items: [] }, after.revision);
});

test('a broad replan preserves fixed items added in the same request', async () => {
  const state = await snapshot();
  const parsed = intent([{ action: 'create', entity: 'task', title: 'Fixed essay', date: '2026-09-06', start: '22:00', durationMinutes: 60 }], { mode: 'plan', plan: {
    taskScope: 'all_pending', taskIds: [], startDate: '2026-09-06', horizonDays: 7, todayLoad: 'normal', includeAlreadyScheduled: true,
    additionalTasks: [{ title: 'Flexible reading', durationMinutes: 30 }],
  } });
  const compiled = compileConversation(parsed, calendarFromSnapshot(state, owner, NOW, zone));
  const fixed = compiled.items.find(item => item.title === 'Fixed essay');
  assert.equal(compiled.writes.filter(write => write.id === fixed.id).length, 1);
  assert.equal(compiled.writes.find(write => write.id === fixed.id).data.scheduled_start_at, '2026-09-07T05:00:00.000Z');
});

test('two-week planning does not silently truncate the second week', async () => {
  const state = await snapshot();
  const calendar = calendarFromSnapshot(state, owner, NOW, zone);
  const parsed = intent([], { mode: 'plan', plan: {
    taskScope: 'task_ids', taskIds: [], startDate: '2026-09-06', horizonDays: 14, todayLoad: 'normal', includeAlreadyScheduled: false,
    excludedDates: ['2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-12'],
    additionalTasks: [{ title: 'Second-week reading', durationMinutes: 30 }],
  } });
  const compiled = compileConversation(parsed, calendar);
  assert.equal(compiled.writes[0].data.scheduled_date, '2026-09-13');
});

test('mixed edits and planning are valid under either mutation label', async () => {
  const state = await snapshot();
  const payload = {
    taskScope: 'task_ids', taskIds: [], startDate: '2026-09-07', horizonDays: 7,
    todayLoad: 'normal', includeAlreadyScheduled: false, availableAfter: '17:00',
    allowedWeekdays: [0,2,3,4,6], additionalTasks: [{ title: 'Reading', durationMinutes: 30 }],
  };
  const parsed = intent([{ action: 'create', entity: 'event', title: 'Call', date: '2026-09-07', start: '20:00', durationMinutes: 20 }], { mode: 'act', plan: payload });
  assert.equal(parsed.mode, 'plan');
  const compiled = compileConversation(parsed, calendarFromSnapshot(state, owner, NOW, zone));
  assert.equal(compiled.writes.length, 2);
  assert.equal(compiled.writes.find(write => write.entity === 'task').data.scheduled_date, '2026-09-08');
  assert.throws(() => intent(parsed.operations, { mode: 'discuss', plan: payload }), /Discussion cannot/);
});

test('school interval is real: 10–11 PM works, 10–11 AM conflicts', async () => {
  const state = await snapshot();
  const calendar = calendarFromSnapshot(state, owner, NOW, zone);
  const night = intent([{ action: 'create', entity: 'task', title: 'College essay', date: '2026-09-07', start: '22:00', end: '23:00' }]);
  assert.ok(compileConversation(night, calendar).writes.length);
  assert.throws(() => compileConversation(intent([{ ...night.operations[0], start: '10:00', end: '11:00' }]), calendar), /really overlaps School/);
  assert.throws(() => compileConversation(intent([{ ...night.operations[0], explicitStart: '10:00' }]), calendar), /explicitly requested/);
});

test('actual conflicts between new items reject the entire bundle', async () => {
  const before = await snapshot();
  assert.throws(() => compileConversation(intent([
    { action: 'create', entity: 'event', title: 'Game', date: '2026-09-06', start: '17:00', durationMinutes: 60 },
    { action: 'create', entity: 'task', title: 'Essay', date: '2026-09-06', start: '17:30', durationMinutes: 60 },
  ]), calendarFromSnapshot(before, owner, NOW, zone)), /really overlaps/);
  assert.equal((await snapshot()).revision, before.revision);
});

test('overdue work remains schedulable and exact original deadlines survive save', async () => {
  const id = randomUUID();
  await db.query("insert into tasks(id,user_id,title,source,due_date,due_time) values($1,$2,'Old Canvas assignment','canvas','2026-08-28T22:00:00Z','15:00')", [id, owner]);
  const result = await turn('schedule my old canvas task tonight', [{ action: 'update', entity: 'task', id, date: '2026-09-06', start: '21:00', durationMinutes: 45 }]);
  const saved = result.state.tasks.find(t => t.id === id);
  assert.equal(saved.due_date, '2026-08-28T22:00:00+00:00');
  assert.equal(saved.scheduled_date, '2026-09-06');
  assert.match(result.receipt.reply, /deadline stays unchanged/);
  await undo(result.receipt);
});

test('planning and plan correction use actual task IDs, estimates and excluded weekdays', async () => {
  const planned = await turn('plan all overdue, keep today light, add essay work', [], { mode: 'plan', plan: {
    taskScope: 'overdue', taskIds: [], startDate: '2026-09-06', horizonDays: 7, todayLoad: 'light', includeAlreadyScheduled: false,
    availableAfter: '16:00', availableBefore: '23:00', additionalTasks: [{ title: 'Essay work', durationMinutes: 90, estimated: true }],
  } });
  assert.ok(planned.receipt.items.length >= 2);
  assert.match(planned.receipt.reply, /estimated/);
  const ids = planned.receipt.items.map(item => item.id);
  const corrected = await turn('keep Friday free too', [], { mode: 'plan', plan: {
    taskScope: 'task_ids', taskIds: ids, startDate: '2026-09-06', horizonDays: 7, todayLoad: 'light', includeAlreadyScheduled: true,
    availableAfter: '16:00', availableBefore: '23:00', additionalTasks: [], allowedWeekdays: [0,1,2,3,4,6],
  } });
  assert.equal(corrected.state.tasks.filter(t => t.title === 'Essay work').length, 1);
  for (const id of ids) assert.notEqual(corrected.state.tasks.find(t => t.id === id).scheduled_date, '2026-09-11');
  assert.equal(corrected.state.tasks.find(t => t.title === 'Old Canvas assignment').due_date, '2026-08-28T22:00:00+00:00');
});

test('midnight crossing and timezone-local dates are preserved; DST gaps/folds rejected', async () => {
  const state = await snapshot();
  const calendar = calendarFromSnapshot(state, owner, NOW, zone);
  const midnight = compileConversation(intent([{ action: 'create', entity: 'event', title: 'Late call', date: '2026-09-06', start: '23:00', end: '00:00' }]), calendar);
  assert.equal(midnight.writes[0].data.start_date, '2026-09-06');
  assert.equal(midnight.writes[0].data.end_time, '00:00');
  const dst = { ...calendar, now: '2027-03-13T20:00:00Z' };
  assert.throws(() => compileConversation(intent([{ action: 'create', entity: 'event', title: 'Call', date: '2027-03-14', start: '02:30', durationMinutes: 30 }]), dst), /does not exist/);
  assert.throws(() => compileConversation(intent([{ action: 'create', entity: 'event', title: 'Call', date: '2026-11-01', start: '01:30', durationMinutes: 30 }]), calendar), /happens twice/);
  assert.throws(() => compileConversation(intent([{ action: 'create', entity: 'event', title: 'Past', date: '2026-09-06', start: '07:00', durationMinutes: 30 }]), calendar), /already passed/);
});

test('lost-response retries return original saved IDs and create exactly once', async () => {
  const before = await snapshot();
  const compiled = compileConversation(intent([{ action: 'create', entity: 'event', title: 'Retry test', date: '2026-09-09', start: '22:00', durationMinutes: 30 }]), calendarFromSnapshot(before, owner, NOW, zone));
  const requestId = randomUUID();
  const first = await apply(compiled, before.revision, requestId);
  const retry = await apply(compiled, before.revision, requestId);
  assert.deepEqual(retry, first);
  assert.equal((await snapshot()).events.filter(e => e.title === 'Retry test').length, 1);
  await undo(first);
});

test('database failure rolls back earlier writes and does not produce success receipt', async () => {
  const before = await snapshot();
  const requestId = randomUUID();
  await assert.rejects(apply({ writes: [
    { entity: 'task', op: 'put', id: randomUUID(), data: { title: 'Must roll back' } },
    { entity: 'event', op: 'put', id: randomUUID(), data: { title: 'Invalid event' } },
  ], reply: 'should not save', items: [] }, before.revision, requestId));
  assert.equal((await snapshot()).revision, before.revision);
  assert.equal((await db.query('select * from assistant_action_receipts where request_id=$1', [requestId])).rows.length, 0);
});

test('stale snapshots cannot overwrite newer user changes', async () => {
  const before = await snapshot();
  const compiled = compileConversation(intent([{ action: 'create', entity: 'task', title: 'Stale draft' }]), calendarFromSnapshot(before, owner, NOW, zone));
  await db.query("insert into tasks(user_id,title) values($1,'Newer manual task')", [owner]);
  await assert.rejects(apply(compiled, before.revision), /CALENDAR_CHANGED/);
  assert.ok(!(await snapshot()).tasks.some(t => t.title === 'Stale draft'));
});

test('account RLS isolates snapshots, receipts and mutation targets', async () => {
  const owned = await snapshot();
  const taskId = owned.tasks[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  const foreign = await snapshot();
  assert.equal(foreign.tasks.length, 0);
  assert.equal((await db.query('select * from assistant_action_receipts')).rows.length, 0);
  await assert.rejects(apply({ writes: [{ entity: 'task', op: 'put', id: taskId, data: { title: 'Unauthorized' } }], reply: 'no', items: [] }, foreign.revision));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  assert.equal((await snapshot()).tasks.find(t => t.id === taskId).title, owned.tasks[0].title);
});

test('provider context includes all overdue tasks, verified outcomes and local clock', async () => {
  const current = await snapshot();
  const facts = conversationFacts(calendarFromSnapshot(current, owner, NOW, zone), [{ saved: true, items: [{ id: 'actual-id', title: 'Meeting' }] }]);
  assert.equal(facts.tasks.length, current.tasks.length);
  assert.ok(facts.tasks.some(t => t.overdue));
  const prompt = conversationSystemPrompt(facts);
  assert.match(prompt, /actual-id/);
  assert.match(prompt, /1:00 PM/);
  assert.match(prompt, /earlier assistant prose alone is NOT proof/);
  assert.throws(() => readConversationRequest({ requestId: randomUUID(), conversationId, timeZone: 'Invalid/Zone', messages: [{ role: 'user', content: 'hello' }] }));
});
