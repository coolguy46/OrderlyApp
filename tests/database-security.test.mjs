import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// Run the real schema/policies as two unprivileged users and anon, not mocks of
// an application's ownership checks. This is an isolated, in-memory database.
const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const ids = Object.fromEntries(['subject', 'task', 'exam', 'event', 'plan', 'block', 'set']
  .map(key => [key, [randomUUID(), randomUUID()]]));
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const withoutExtensions = sql => sql.replace(/^CREATE EXTENSION[^;]+;/gmi, '');
let legacyCrossReferenceWasAccepted = false;
let legacyAnonymousDispatchRows = 0;

async function asUser(user, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${user ? 'authenticated' : 'anon'};`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user ?? '']);
    return await db.query(sql, params);
  } finally {
    await db.exec('ROLLBACK');
  }
}

before(async () => {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    CREATE FUNCTION public.uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  `);
  await db.exec(withoutExtensions(await read('lib/supabase/schema.sql')));
  for (const path of [
    'lib/supabase/task-scheduling-migration.sql',
    'lib/supabase/planner-migration.sql',
    'lib/supabase/relationship-ownership-migration.sql',
    'lib/supabase/assistant-usage-migration.sql',
    'lib/supabase/assistant-conversation-migration.sql',
    'lib/supabase/assistant-abuse-guard-migration.sql',
    'docs/migration_new_features.sql',
  ]) await db.exec(withoutExtensions(await read(path)));
  await db.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql'));
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)',
    [owner, 'first@example.invalid', other, 'second@example.invalid']);
  for (const [index, user] of [owner, other].entries()) {
    await db.query("INSERT INTO subjects(id,user_id,name) VALUES ($1,$2,'Private class')", [ids.subject[index], user]);
    await db.query("INSERT INTO tasks(id,user_id,subject_id,title) VALUES ($1,$2,$3,'Private assignment')", [ids.task[index], user, ids.subject[index]]);
    await db.query("INSERT INTO exams(id,user_id,subject_id,title,exam_date) VALUES ($1,$2,$3,'Private exam','2030-01-02')", [ids.exam[index], user, ids.subject[index]]);
    await db.query("INSERT INTO recurring_commitments(id,user_id,client_commitment_id,title,days_of_week,start_time,end_time) VALUES ($1,$2,$3,'Private meeting',array[1]::smallint[],'10:00','11:00')", [ids.event[index], user, `event-${index}`]);
    await db.query("INSERT INTO planner_plans(id,user_id,client_plan_id,horizon_start,horizon_end,input_fingerprint) VALUES ($1,$2,$3,'2030-01-01','2030-01-08','test')", [ids.plan[index], user, `plan-${index}`]);
    await db.query("INSERT INTO planner_blocks(id,plan_id,user_id,client_block_id,source_kind,task_id,commitment_id,source_id_snapshot,title_snapshot,start_at,end_at,deadline_at,estimated_minutes) VALUES ($1,$2,$3,'block','task',$4,$5,'task','Private block','2030-01-01 10:00Z','2030-01-01 10:30Z','2030-01-02',30)", [ids.block[index], ids.plan[index], user, ids.task[index], ids.event[index]]);
    await db.query("INSERT INTO study_sets(id,user_id,exam_id,name,linked_task_ids) VALUES ($1,$2,$3,'Private study set',$4)", [ids.set[index], user, ids.exam[index], JSON.stringify([ids.task[index]])]);
    await db.query("INSERT INTO flashcards(study_set_id,user_id,front,back) VALUES ($1,$2,'Private question','Private answer')", [ids.set[index], user]);
    await db.query("INSERT INTO mcq_questions(study_set_id,user_id,question) VALUES ($1,$2,'Private question')", [ids.set[index], user]);
    await db.query("INSERT INTO study_set_files(study_set_id,user_id,file_name,storage_path) VALUES ($1,$2,'private.txt',$3)", [ids.set[index], user, `${user}/private.txt`]);
    await db.query("INSERT INTO canvas_settings(user_id,ical_url) VALUES ($1,'https://canvas.example.invalid/private-feed')", [user]);
    await db.query("INSERT INTO goals(user_id,title,target_value,unit) VALUES ($1,'Private goal',10,'hours')", [user]);
    await db.query("INSERT INTO planner_preferences(user_id) VALUES ($1)", [user]);
    await db.query("INSERT INTO study_sessions(user_id,task_id,subject_id,duration_minutes,started_at) VALUES ($1,$2,$3,30,'2030-01-01')", [user,ids.task[index],ids.subject[index]]);
    await db.query('INSERT INTO timer_states(user_id,subject_id) VALUES ($1,$2)', [user,ids.subject[index]]);
    await db.query("INSERT INTO planner_feedback(user_id,client_feedback_id,plan_id,block_id,predicted_minutes,timing_rating) VALUES ($1,'feedback',$2,$3,30,'accurate')", [user,ids.plan[index],ids.block[index]]);
    await db.query("INSERT INTO plan_adjustments(user_id,client_adjustment_id,client_plan_id,plan_id,block_id,adjustment_type) VALUES ($1,'adjustment','plan',$2,$3,'move')", [user,ids.plan[index],ids.block[index]]);
    for (const query of [
      "INSERT INTO resume_items(user_id,category,title) VALUES ($1,'education','Private education')",
      "INSERT INTO college_courses(user_id,name,grade) VALUES ($1,'Private course','A')",
      "INSERT INTO extracurriculars(user_id,name,category) VALUES ($1,'Private activity','sports')",
      "INSERT INTO college_applications(user_id,name,app_type) VALUES ($1,'Private application','match')",
      "INSERT INTO test_scores(user_id,test_name,score) VALUES ($1,'Private score',100)",
      "INSERT INTO recommendations(user_id,recommender_name) VALUES ($1,'Private contact')",
      "INSERT INTO sat_act_progress(user_id,test_type,section_name) VALUES ($1,'SAT','Private progress')",
    ]) await db.query(query, [user]);
    await db.query("INSERT INTO assistant_action_receipts(user_id,request_id,conversation_id,response) VALUES ($1,$2,$3,'{\"reply\":\"Private conversation\"}')", [user, randomUUID(), randomUUID()]);
  }
  // Evidence of the pre-repair integrity weakness. It writes no persistent row.
  const beforeFix = await asUser(owner, 'UPDATE flashcards SET study_set_id=$1 WHERE user_id=$2 RETURNING id', [ids.set[1], owner]);
  legacyCrossReferenceWasAccepted = beforeFix.rows.length > 0;
  // Real dispatch SQL, but its infrastructure dependencies are inert local
  // fixtures. Nothing reaches a network and no recurring job is installed.
  await db.exec(`CREATE SCHEMA vault; CREATE SCHEMA net;
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz DEFAULT now());
    INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES
      ('canvas_sync_cron_secret','test-only-not-a-real-secret'),
      ('canvas_sync_endpoint_url','https://example.invalid/api/canvas/background-sync');
    CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
      RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;`);
  const dispatch = await read('lib/supabase/canvas-background-dispatch-migration.sql');
  await db.exec(dispatch.match(/CREATE OR REPLACE FUNCTION public\.dispatch_due_canvas_syncs\(\)[\s\S]*?\$function\$;/)[0]);
  // Reproduce the historic PUBLIC-only revoke despite explicit default grants.
  await db.exec('REVOKE ALL ON FUNCTION public.dispatch_due_canvas_syncs() FROM PUBLIC');
  legacyAnonymousDispatchRows = (await asUser(null,'SELECT * FROM public.dispatch_due_canvas_syncs()')).rows.length;
  await db.exec(await read('lib/supabase/security-boundaries-migration.sql'));
  await db.exec(await read('lib/supabase/security-boundaries-migration.sql'));
});
after(async () => { await db.close(); });

test('every application table has RLS, and anonymous reads reveal no records', async () => {
  const tables = (await db.query("SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")).rows;
  assert.ok(tables.length > 25);
  for (const table of tables) {
    assert.equal(table.relrowsecurity, true, `${table.relname} must have RLS`);
    try {
      const result = await asUser(null, `SELECT * FROM public.${table.relname}`);
      assert.equal(result.rows.length, 0, `anonymous ${table.relname} read`);
    } catch (error) {
      assert.equal(error.code, '42501', `${table.relname}: ${error.message}`);
    }
  }
});

test('account-owned data is visible only to its owner; direct cross-account CRUD is blocked', async () => {
  for (const table of ['subjects','tasks','exams','goals','canvas_settings','planner_preferences','recurring_commitments','planner_plans','planner_blocks','study_sets','flashcards','mcq_questions','study_set_files','assistant_action_receipts','study_sessions','timer_states','planner_feedback','plan_adjustments','resume_items','college_courses','extracurriculars','college_applications','test_scores','recommendations','sat_act_progress']) {
    const own = await asUser(owner, `SELECT * FROM ${table}`);
    assert.ok(own.rows.length > 0, `${table}: legitimate read`);
    assert.ok(own.rows.every(row => row.user_id === owner), `${table}: own read boundary`);
    assert.equal((await asUser(owner, `SELECT * FROM ${table} WHERE user_id=$1`, [other])).rows.length, 0);
    assert.equal((await asUser(owner, `UPDATE ${table} SET user_id=user_id WHERE user_id=$1 RETURNING *`, [other])).rows.length, 0);
    assert.equal((await asUser(owner, `DELETE FROM ${table} WHERE user_id=$1 RETURNING *`, [other])).rows.length, 0);
    await assert.rejects(asUser(owner, `UPDATE ${table} SET user_id=$1 WHERE user_id=$2`, [other, owner]), error => ['42501','23503','23505'].includes(error.code), `${table}: ownership change`);
    const forged = {...own.rows[0], user_id: other};
    if ('id' in forged) forged.id = randomUUID();
    if ('request_id' in forged) forged.request_id = randomUUID();
    await assert.rejects(asUser(owner, `INSERT INTO ${table} SELECT * FROM jsonb_populate_record(NULL::public.${table},$1::jsonb)`, [JSON.stringify(forged)]), error => ['42501','23503','23505'].includes(error.code), `${table}: cross-account insert`);
  }
  const created = await asUser(owner, "INSERT INTO tasks(user_id,title,subject_id) VALUES ($1,'Legitimate new task',$2) RETURNING user_id,title", [owner, ids.subject[0]]);
  assert.equal(created.rows[0].user_id, owner);
});

test('nested subject/task/plan references cannot point at another account', async () => {
  for (const [sql, params] of [
    ['UPDATE tasks SET subject_id=$1 WHERE id=$2', [ids.subject[1], ids.task[0]]],
    ['UPDATE exams SET subject_id=$1 WHERE id=$2', [ids.subject[1], ids.exam[0]]],
    ['UPDATE planner_blocks SET task_id=$1 WHERE id=$2', [ids.task[1], ids.block[0]]],
    ['UPDATE planner_blocks SET commitment_id=$1 WHERE id=$2', [ids.event[1], ids.block[0]]],
    ['UPDATE planner_blocks SET plan_id=$1 WHERE id=$2', [ids.plan[1], ids.block[0]]],
  ]) await assert.rejects(asUser(owner, sql, params), error => ['23503','42501'].includes(error.code));
});

test('legacy study references are now owner checked, including direct API writes', async () => {
  assert.equal(legacyCrossReferenceWasAccepted, true, 'reproduced before repairing');
  for (const [sql, params] of [
    ['UPDATE study_sets SET exam_id=$1 WHERE id=$2', [ids.exam[1], ids.set[0]]],
    ['UPDATE study_sets SET linked_task_ids=$1 WHERE id=$2', [JSON.stringify([ids.task[1]]), ids.set[0]]],
    ['UPDATE flashcards SET study_set_id=$1 WHERE user_id=$2', [ids.set[1], owner]],
    ['UPDATE mcq_questions SET study_set_id=$1 WHERE user_id=$2', [ids.set[1], owner]],
    ['UPDATE study_set_files SET study_set_id=$1 WHERE user_id=$2', [ids.set[1], owner]],
    ['UPDATE study_set_files SET storage_path=$1 WHERE user_id=$2', [`${other}/private.txt`, owner]],
  ]) await assert.rejects(asUser(owner, sql, params), error => error.code === '23503');
  assert.equal((await asUser(owner, 'UPDATE study_sets SET name=$1 WHERE id=$2 RETURNING name', ['Renamed', ids.set[0]])).rows[0].name, 'Renamed');
  assert.equal((await asUser(owner, 'UPDATE flashcards SET front=$1 WHERE user_id=$2 RETURNING front', ['Updated', owner])).rows[0].front, 'Updated');
});

test('profile identity/counters and background-job operations remain server managed', async () => {
  await assert.rejects(asUser(owner, 'UPDATE profiles SET email=$1 WHERE id=$2', ['forged@example.invalid', owner]), error => error.code === '42501');
  await assert.rejects(asUser(owner, 'UPDATE profiles SET tasks_completed=100 WHERE id=$1', [owner]), error => error.code === '42501');
  for (const user of [null, owner]) {
    for (const sql of ['SELECT * FROM claim_account_deletion_requests()', `SELECT * FROM claim_canvas_sync('${other}')`, 'SELECT * FROM assistant_ai_usage', 'SELECT * FROM canvas_provider_request_limits']) {
      await assert.rejects(asUser(user, sql), error => error.code === '42501');
    }
  }
  assert.equal((await asUser(owner, 'UPDATE profiles SET full_name=$1 WHERE id=$2 RETURNING full_name', ['New display name', owner])).rows[0].full_name, 'New display name');
});

test('calendar snapshots, mutations, and task completion cannot act across accounts', async () => {
  await assert.rejects(asUser(null, 'SELECT assistant_calendar_snapshot()'), error => error.code === '42501');
  const snapshot = (await asUser(owner, 'SELECT assistant_calendar_snapshot() AS value')).rows[0].value;
  for (const row of [...snapshot.tasks, ...snapshot.events, ...snapshot.exams]) assert.equal(row.user_id, owner);
  await assert.rejects(asUser(owner, 'SELECT complete_task_with_successor($1,NULL)', [ids.task[1]]), /Task not found/);
  await assert.rejects(asUser(owner, 'SELECT apply_assistant_calendar_changes($1,$2,$3,$4,$5)', [randomUUID(),randomUUID(),snapshot.revision,JSON.stringify([{entity:'task',op:'delete',id:ids.task[1]}]),'{}']), /Only your manual task/);
  const completed = (await asUser(owner, 'SELECT complete_task_with_successor($1,NULL) AS value', [ids.task[0]])).rows[0].value;
  assert.equal(completed.changed, true);
  assert.equal(completed.completed.user_id, owner);
});

test('the migration prevents untrusted schema creation and pins application definer search paths', async () => {
  for (const user of [null, owner]) await assert.rejects(asUser(user, 'CREATE TABLE public.attacker_owned(id int)'), error => error.code === '42501');
  const functions = (await db.query("SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef")).rows;
  for (const fn of functions) assert.ok(fn.proconfig?.includes('search_path=pg_catalog, public, pg_temp') || fn.proconfig?.includes('search_path=pg_catalog'), fn.proname);
});

test('preflight rejects legacy bad references atomically without deleting or rewriting them', async () => {
  // Simulate an older install with a pre-existing invalid row, exclusively in
  // this isolated database. A rejected deployment must leave it untouched.
  await db.exec('ALTER TABLE flashcards DISABLE TRIGGER security_owned_parent; GRANT CREATE ON SCHEMA public TO authenticated');
  await db.query('UPDATE flashcards SET study_set_id=$1 WHERE user_id=$2', [ids.set[1], owner]);
  try {
    await assert.rejects(db.exec(await read('lib/supabase/security-boundaries-migration.sql')), /Security preflight.*flashcards/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query('SELECT study_set_id FROM flashcards WHERE user_id=$1', [owner])).rows[0].study_set_id, ids.set[1]);
    assert.equal((await db.query("SELECT has_schema_privilege('authenticated','public','CREATE') AS allowed")).rows[0].allowed, true, 'earlier privilege change also rolled back');
  } finally {
    await db.exec('ROLLBACK');
    await db.query('UPDATE flashcards SET study_set_id=$1 WHERE user_id=$2', [ids.set[0], owner]);
    await db.exec('ALTER TABLE flashcards ENABLE TRIGGER security_owned_parent');
    await db.exec(await read('lib/supabase/security-boundaries-migration.sql'));
  }
});

test('security-definer usage accounting cannot be redirected into a caller temporary table', async () => {
  await db.exec('BEGIN; SET LOCAL ROLE authenticated');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
    await db.exec('CREATE TEMP TABLE assistant_ai_usage(request_id uuid,user_id uuid,status text)');
    const request = randomUUID();
    assert.equal((await db.query('SELECT allowed FROM public.assistant_reserve_ai_request($1,0,0)', [request])).rows[0].allowed, true);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM pg_temp.assistant_ai_usage')).rows[0].count, 0);
    await db.exec('RESET ROLE');
    assert.equal((await db.query('SELECT user_id FROM public.assistant_ai_usage WHERE request_id=$1', [request])).rows[0].user_id, owner);
  } finally { await db.exec('ROLLBACK'); }
});

test('hardening also applies to fresh installs without optional planner or legacy study tables', async () => {
  const minimal = new PGlite();
  try {
    await minimal.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb DEFAULT '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$SELECT gen_random_uuid()$$;`);
    await minimal.exec(withoutExtensions(await read('lib/supabase/schema.sql')));
    await minimal.exec(await read('lib/supabase/security-boundaries-migration.sql'));
    await minimal.exec(await read('lib/supabase/security-boundaries-migration.sql'));
    assert.equal((await minimal.query("SELECT to_regclass('public.study_sets') AS optional_table")).rows[0].optional_table, null);
    await assert.rejects(minimal.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql')), /Apply assistant-conversation-migration/);
    await minimal.exec('ROLLBACK');
    assert.equal((await minimal.query("SELECT to_regclass('public.assistant_ai_leases') AS lease_table")).rows[0].lease_table,null,'missing receipts fail before partial lease installation');
    await minimal.exec('CREATE TABLE assistant_action_receipts(user_id uuid,request_id uuid,response jsonb); CREATE TABLE assistant_ai_leases(request_id uuid PRIMARY KEY); INSERT INTO assistant_ai_leases VALUES (gen_random_uuid())');
    await assert.rejects(minimal.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql')), /Unexpected Assistant lease schema/);
    await minimal.exec('ROLLBACK');
    assert.equal((await minimal.query('SELECT count(*)::int AS count FROM assistant_ai_leases')).rows[0].count,1,'unexpected draft schema/data is preserved for deliberate migration');
  } finally { await minimal.close(); }
});

test('only the server can acquire/release AI abuse leases, even with a known request ID', async () => {
  for (const user of [null,owner,other]) {
    for (const sql of [
      'SELECT * FROM assistant_ai_leases',
      `SELECT assistant_acquire_ai_lease('${owner}','${randomUUID()}',60,4)`,
      `SELECT assistant_release_ai_lease('${owner}','${randomUUID()}')`,
    ]) await assert.rejects(asUser(user, sql), error => error.code === '42501');
  }
});

test('cron dispatch denies direct client grants rather than relying only on PUBLIC revocation', async () => {
  assert.equal(legacyAnonymousDispatchRows,2,'historic ACL returned account IDs and invoked the inert dispatcher');
  for (const user of [null,owner]) await assert.rejects(asUser(user, 'SELECT * FROM public.dispatch_due_canvas_syncs()'), error => error.code === '42501');
  const sql = await read('lib/supabase/canvas-background-dispatch-migration.sql');
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.dispatch_due_canvas_syncs\(\) FROM PUBLIC, anon, authenticated/);
});

test('AI leases persist burst counts after release and enforce duplicate/concurrent request boundaries', async () => {
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  const requests = Array.from({length:7}, () => randomUUID());
  const leaseIds = new Map();
  const claim = async (user, request) => {
    const value = (await db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS value', [user,request])).rows[0].value;
    if (value.allowed) leaseIds.set(request,value.lease_id);
    return value;
  };
  const release = async (user, request) => (await db.query('SELECT assistant_release_ai_lease($1,$2) AS value', [user,leaseIds.get(request)])).rows[0].value;
  try {
    assert.equal((await claim(owner,requests[0])).allowed, true);
    assert.equal((await claim(owner,requests[0])).reason, 'duplicate');
    assert.equal((await claim(owner,requests[1])).allowed, true);
    assert.equal((await claim(owner,requests[2])).reason, 'concurrency');
    assert.equal(await release(other,requests[0]), false, 'server release still matches both identifiers');
    assert.equal(await release(owner,requests[0]), true);
    assert.equal((await claim(owner,requests[2])).allowed, true);
    await release(owner,requests[1]); await release(owner,requests[2]);
    for (const request of requests.slice(3,6)) {
      assert.equal((await claim(owner,request)).allowed, true);
      await release(owner,request);
    }
    assert.equal((await claim(owner,requests[6])).reason, 'rate');
    assert.equal((await claim(other,randomUUID())).allowed, true, 'one account cannot consume another account burst allowance');
    await db.exec('RESET ROLE');
    await db.query("UPDATE assistant_ai_leases SET acquired_at=clock_timestamp()-interval '120 seconds',expires_at=clock_timestamp()-interval '30 seconds' WHERE user_id=$1", [owner]);
    await db.exec('SET LOCAL ROLE service_role');
    assert.equal((await claim(owner,requests[6])).allowed, true, 'expired burst window recovers');
  } finally { await db.exec('ROLLBACK'); }
});

test('expired incomplete AI requests recover without losing attempt history or releasing a newer lease', async () => {
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  const request = randomUUID();
  const claim = async () => (await db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS value',[owner,request])).rows[0].value;
  try {
    const first = await claim();
    assert.equal(first.allowed,true);
    await db.exec('RESET ROLE');
    await db.query("UPDATE assistant_ai_leases SET acquired_at=clock_timestamp()-interval '120 seconds',expires_at=clock_timestamp()-interval '30 seconds' WHERE lease_id=$1",[first.lease_id]);
    await db.exec('SET LOCAL ROLE service_role');
    const next = await claim();
    assert.equal(next.allowed,true);
    assert.notEqual(next.lease_id,first.lease_id);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM assistant_ai_leases WHERE user_id=$1 AND request_id=$2',[owner,request])).rows[0].count,2,'both attempts retained');
    assert.equal((await db.query('SELECT assistant_release_ai_lease($1,$2) AS released',[owner,first.lease_id])).rows[0].released,true);
    assert.equal((await db.query('SELECT released_at FROM assistant_ai_leases WHERE lease_id=$1',[next.lease_id])).rows[0].released_at,null,'old invocation cannot release new attempt');
    assert.equal((await claim()).reason,'duplicate');
    await db.query('SELECT assistant_release_ai_lease($1,$2)',[owner,next.lease_id]);
    assert.equal((await claim()).reason,'duplicate','released attempts still wait their original safe lifetime');
    const savedRequest = (await db.query('SELECT request_id FROM assistant_action_receipts WHERE user_id=$1 LIMIT 1',[owner])).rows[0].request_id;
    assert.equal((await db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS value',[owner,savedRequest])).rows[0].value.reason,'completed','saved receipt prevents another provider attempt');
  } finally { await db.exec('ROLLBACK'); }
});

test('deleting an isolated Auth identity cascades owned sensitive records, including legacy study data', async () => {
  await db.exec('BEGIN');
  try {
    await db.query('DELETE FROM auth.users WHERE id=$1', [other]);
    const tables = (await db.query("SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='user_id'")).rows;
    for (const {table_name:table} of tables) {
      if (table === 'account_deletion_requests') continue; // Intentional durable retry/completion marker.
      assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id=$1`, [other])).rows[0].count, 0, table);
    }
    assert.equal((await db.query('SELECT count(*)::int AS count FROM tasks WHERE user_id=$1', [owner])).rows[0].count, 1, 'other account remains intact');
  } finally { await db.exec('ROLLBACK'); }
});

test('production preflight runs read-only and returns metadata/counts rather than account content', async () => {
  const before = (await db.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count;
  const report = await db.exec(await read('docs/security-preflight.sql'));
  const counts = report.find(result => result.fields?.some(field => field.name === 'invalid_count'));
  assert.ok(counts?.rows.length > 0);
  assert.ok(counts.rows.every(row => row.invalid_count === 0));
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(owner) && !serialized.includes(other));
  assert.ok(!serialized.includes('Private assignment') && !serialized.includes('test-only-not-a-real-secret'));
  assert.equal((await db.query('SELECT count(*)::int AS count FROM tasks')).rows[0].count, before);
});
