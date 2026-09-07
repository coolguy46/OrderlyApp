import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Production-shaped older schema, fictional data, no network or real jobs.
// Execute the actual incremental files, not only the modern bootstrap schema.
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const read = name => readFile(new URL(`../lib/supabase/${name}-migration.sql`, import.meta.url), 'utf8');
const install = async name => db.exec((await read(name)).replace(/^CREATE EXTENSION[^;]+;/gmi, ''));
async function actor(role, user, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user ?? '']);
    return await db.query(sql, params);
  } finally { await db.exec('ROLLBACK'); }
}
before(async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth,public TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE TABLE profiles(id uuid PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,email text,
      full_name text,total_study_time integer DEFAULT 0,tasks_completed integer DEFAULT 0,
      current_streak integer DEFAULT 0,longest_streak integer DEFAULT 0);
    ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Enable insert for service role and triggers" ON profiles FOR INSERT WITH CHECK(true);
    CREATE POLICY own_profiles ON profiles FOR SELECT USING(id=auth.uid());
    CREATE POLICY own_profile_updates ON profiles FOR UPDATE USING(id=auth.uid()) WITH CHECK(id=auth.uid());
    CREATE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
      SET search_path=pg_catalog,public,pg_temp AS $$BEGIN
      INSERT INTO public.profiles(id,email) VALUES(NEW.id,NEW.email); RETURN NEW; END$$;
    CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
    CREATE TABLE tasks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles ON DELETE CASCADE,status text DEFAULT 'pending');
    CREATE TABLE study_sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES profiles ON DELETE CASCADE,duration_minutes integer NOT NULL);
    CREATE TABLE competitions(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE TABLE competition_participants(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Anyone can view competitions" ON competitions FOR SELECT USING(true);
    CREATE POLICY "Anyone can view competition participants" ON competition_participants FOR SELECT USING(true);
    CREATE TABLE canvas_settings(user_id uuid PRIMARY KEY REFERENCES profiles ON DELETE CASCADE,
      ical_url text,time_zone text DEFAULT 'America/Los_Angeles',sync_enabled boolean DEFAULT true,
      auto_sync_interval integer DEFAULT 15,last_sync_at timestamptz,last_background_sync_at timestamptz,
      last_background_attempt_at timestamptz);
    CREATE SCHEMA vault; CREATE SCHEMA net; CREATE SCHEMA cron;
    CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text,created_at timestamptz DEFAULT now());
    CREATE VIEW vault.secrets AS SELECT name FROM vault.decrypted_secrets;
    CREATE FUNCTION vault.create_secret(secret text,name text,description text) RETURNS uuid LANGUAGE sql AS
      $$WITH added AS(INSERT INTO vault.decrypted_secrets VALUES(name,secret,now())) SELECT gen_random_uuid()$$;
    CREATE TABLE cron.job(jobid bigint GENERATED ALWAYS AS IDENTITY,jobname text,schedule text,command text,active boolean DEFAULT true);
    CREATE FUNCTION cron.schedule(text,text,text) RETURNS bigint LANGUAGE sql AS
      $$INSERT INTO cron.job(jobname,schedule,command) VALUES($1,$2,$3) RETURNING jobid$$;
    CREATE FUNCTION cron.unschedule(bigint) RETURNS boolean LANGUAGE sql AS
      $$WITH gone AS(DELETE FROM cron.job WHERE jobid=$1 RETURNING *) SELECT EXISTS(SELECT 1 FROM gone)$$;
    CREATE FUNCTION cron.alter_job(job_id bigint,active boolean) RETURNS void LANGUAGE sql AS
      $$UPDATE cron.job SET active=$2 WHERE jobid=$1$$;
    CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer)
      RETURNS bigint LANGUAGE sql AS $$SELECT 123::bigint$$;
  `);
  await db.query('INSERT INTO auth.users VALUES($1,$2),($3,$4)', [owner,'first@example.invalid',other,'second@example.invalid']);
  await db.query("INSERT INTO tasks(user_id,status) VALUES($1,'completed'),($1,'pending')",[owner]);
  await db.query('INSERT INTO study_sessions(user_id,duration_minutes) VALUES($1,30)',[owner]);
  await db.exec('UPDATE profiles SET tasks_completed=999,total_study_time=999');
  await db.query("INSERT INTO canvas_settings(user_id,ical_url) VALUES($1,'https://school.example.invalid/feed'),($2,'https://school.example.invalid/feed')",[owner,other]);
});
after(async () => { await db.close(); });

test('profile incremental preflight rolls back permission changes on invalid historic sessions',async () => {
  await db.query('INSERT INTO study_sessions(user_id,duration_minutes) VALUES($1,1441)',[other]);
  await assert.rejects(install('profile-integrity'), /preflight failed/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','profiles','INSERT') ok")).rows[0].ok,true);
  await db.exec('DELETE FROM study_sessions WHERE duration_minutes=1441');
});

test('profile upgrade repairs totals, protects managed fields, and preserves signup/task/study updates',async () => {
  await install('profile-integrity'); await install('profile-integrity');
  assert.deepEqual((await db.query('SELECT tasks_completed,total_study_time FROM profiles WHERE id=$1',[owner])).rows[0],{tasks_completed:1,total_study_time:30});
  await assert.rejects(actor('authenticated',owner,'UPDATE profiles SET tasks_completed=99 WHERE id=$1',[owner]), e=>e.code==='42501');
  await assert.rejects(actor('anon',null,'INSERT INTO profiles(id) VALUES($1)',[other]),e=>e.code==='42501');
  assert.equal((await actor('authenticated',owner,"UPDATE profiles SET full_name='New name' WHERE id=$1 RETURNING full_name",[owner])).rows[0].full_name,'New name');
  await db.exec('BEGIN; SET LOCAL ROLE authenticated');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await db.query("UPDATE tasks SET status='completed' WHERE user_id=$1",[owner]);
    await db.query('UPDATE study_sessions SET duration_minutes=45 WHERE user_id=$1',[owner]);
    assert.deepEqual((await db.query('SELECT tasks_completed,total_study_time FROM profiles WHERE id=$1',[owner])).rows[0],{tasks_completed:2,total_study_time:45});
    await db.query('DELETE FROM study_sessions WHERE user_id=$1',[owner]);
    assert.equal((await db.query('SELECT total_study_time FROM profiles WHERE id=$1',[owner])).rows[0].total_study_time,0);
  } finally { await db.exec('ROLLBACK'); }
  await db.exec("INSERT INTO auth.users VALUES('10000000-0000-4000-8000-000000000003','signup@example.invalid')");
  assert.equal((await db.query('SELECT count(*)::int n FROM profiles')).rows[0].n,3);
});

test('competition lockdown denies browser access without deleting records',async () => {
  await db.exec('INSERT INTO competitions DEFAULT VALUES');
  await install('competition-lockdown'); await install('competition-lockdown');
  for(const role of ['anon','authenticated']) {
    for(const table of ['competitions','competition_participants']) {
      await assert.rejects(actor(role,owner,`SELECT * FROM ${table}`),e=>e.code==='42501');
    }
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM competitions')).rows[0].n,1);
});

test('missing Canvas schema upgrades to owner cooldowns and fenced service-only completion',async () => {
  await install('canvas-sync-concurrency'); await install('canvas-provider-throttle');
  await install('canvas-provider-throttle');
  await db.exec('BEGIN; SET LOCAL ROLE authenticated');
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);
    const token=(await db.query("SELECT * FROM claim_canvas_provider_request('manual_sync')")).rows[0].claim_token;
    assert.ok(token);
    assert.equal((await db.query("SELECT * FROM claim_canvas_provider_request('manual_sync')")).rows[0].claim_token,null);
    assert.equal((await db.query("SELECT release_canvas_provider_request('manual_sync',gen_random_uuid()) ok")).rows[0].ok,false);
    assert.equal((await db.query("SELECT release_canvas_provider_request('manual_sync',$1) ok",[token])).rows[0].ok,true);
    assert.ok((await db.query("SELECT * FROM claim_canvas_provider_request('manual_sync')")).rows[0].retry_after_seconds>0);
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[other]);
    assert.ok((await db.query("SELECT * FROM claim_canvas_provider_request('manual_sync')")).rows[0].claim_token);
  } finally { await db.exec('ROLLBACK'); }
  await assert.rejects(actor('authenticated',owner,'UPDATE canvas_settings SET course_count=99 WHERE user_id=$1',[owner]),e=>e.code==='42501');
  for(const role of ['anon','authenticated']) {
    await assert.rejects(actor(role,owner,'SELECT * FROM canvas_provider_request_limits'),e=>e.code==='42501');
    await assert.rejects(actor(role,owner,'SELECT * FROM claim_canvas_sync($1)',[owner]),e=>e.code==='42501');
  }
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  try {
    const lease=(await db.query('SELECT * FROM claim_canvas_sync($1)',[owner])).rows[0];
    assert.ok(lease.lease_token);
    assert.equal((await db.query('SELECT * FROM claim_canvas_sync($1)',[owner])).rows.length,0);
    assert.equal((await db.query("SELECT complete_canvas_sync($1,gen_random_uuid(),$2,'manual',now(),3) ok",[owner,lease.sync_revision])).rows[0].ok,false);
    assert.equal((await db.query("SELECT complete_canvas_sync($1,$2,$3,'manual',now(),3) ok",[owner,lease.lease_token,lease.sync_revision])).rows[0].ok,true);
    assert.equal((await db.query('SELECT course_count FROM canvas_settings WHERE user_id=$1',[owner])).rows[0].course_count,3);
  } finally { await db.exec('ROLLBACK'); }
});

test('new deletion queue is private, lease-bound and retryable without deleting an account',async () => {
  await install('account-deletion'); await install('account-deletion');
  for(const role of ['anon','authenticated']) await assert.rejects(actor(role,owner,'SELECT * FROM claim_account_deletion_requests()'),e=>e.code==='42501');
  await db.exec('BEGIN; SET LOCAL ROLE service_role');
  try {
    await db.query('INSERT INTO account_deletion_requests(user_id) VALUES($1)',[owner]);
    const first=(await db.query('SELECT * FROM claim_account_deletion_requests()')).rows[0];
    assert.equal(first.user_id,owner); assert.equal(first.attempts,1);
    assert.equal((await db.query('SELECT * FROM claim_account_deletion_requests()')).rows.length,0);
    await db.exec("UPDATE account_deletion_requests SET lease_expires_at=now()-interval '1 minute'");
    const next=(await db.query('SELECT * FROM claim_account_deletion_requests()')).rows[0];
    assert.notEqual(first.lease_token,next.lease_token); assert.equal(next.attempts,2);
  } finally { await db.exec('ROLLBACK'); }
  assert.equal((await db.query('SELECT count(*)::int n FROM account_deletion_requests')).rows[0].n,0);
});

test('dispatchers require configuration, install one job each, and deny direct browser calls',async () => {
  for(const name of ['canvas-background-dispatch','account-deletion-dispatch']) {
    await assert.rejects(install(name),/scheduler preflight/);
    await db.exec('ROLLBACK');
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM cron.job')).rows[0].n,0);
  await db.exec(`INSERT INTO vault.decrypted_secrets(name,decrypted_secret) VALUES
    ('canvas_sync_cron_secret','fictional-not-a-credential'),
    ('canvas_sync_endpoint_url','https://example.invalid/api/canvas/background-sync'),
    ('account_deletion_endpoint_url','https://example.invalid/api/account/deletion/process')`);
  for(const name of ['canvas-background-dispatch','account-deletion-dispatch']) {
    await install(name); await install(name);
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM cron.job')).rows[0].n,2);
  assert.equal((await db.query('SELECT dispatch_account_deletions() id')).rows[0].id,123);
  assert.equal((await db.query('SELECT * FROM dispatch_due_canvas_syncs()')).rows.length,2);
  for(const role of ['anon','authenticated']) {
    for(const fn of ['dispatch_due_canvas_syncs','dispatch_account_deletions']) await assert.rejects(actor(role,owner,`SELECT * FROM ${fn}()`),e=>e.code==='42501');
  }
  for(const fn of ['protect_profile_managed_fields','adjust_completed_task_count','adjust_total_study_time','protect_canvas_sync_internal_state']) {
    assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') ok",[`${fn}()`])).rows[0].ok,false);
  }
});

test('production endpoint configuration is idempotent, preserves secrets, and refuses another origin',async () => {
  const sql=await readFile(new URL('../docs/security-worker-endpoints-2026-09-07.sql',import.meta.url),'utf8');
  // These are fictional fixture settings only; no actual credential is read.
  await assert.rejects(db.exec(sql),/differs from the approved/);
  await db.exec('ROLLBACK');
  await db.exec("DELETE FROM vault.decrypted_secrets WHERE name <> 'canvas_sync_cron_secret'");
  await db.exec(sql); await db.exec(sql);
  assert.equal((await db.query('SELECT count(*)::int n FROM vault.secrets')).rows[0].n,3);
  assert.equal((await db.query("SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='canvas_sync_cron_secret'")).rows[0].decrypted_secret,'fictional-not-a-credential');
});

test('rollout pause affects only the intended Canvas job and can be resumed',async () => {
  await db.exec(await readFile(new URL('../docs/security-canvas-pause-2026-09-07.sql',import.meta.url),'utf8'));
  assert.equal((await db.query("SELECT active FROM cron.job WHERE jobname='orderly-canvas-background-sync'")).rows[0].active,false);
  assert.equal((await db.query("SELECT active FROM cron.job WHERE jobname='orderly-account-deletion-worker'")).rows[0].active,true);
  await install('canvas-background-dispatch');
  assert.equal((await db.query("SELECT active FROM cron.job WHERE jobname='orderly-canvas-background-sync'")).rows[0].active,true);
});
