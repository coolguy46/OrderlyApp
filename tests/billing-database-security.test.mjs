import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const token = '20000000-0000-4000-8000-000000000001';
const nextToken = '20000000-0000-4000-8000-000000000002';
before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE TABLE public.account_deletion_requests(user_id uuid PRIMARY KEY);
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`);
  await db.query('INSERT INTO auth.users VALUES($1),($2)', [owner, other]);
  const sql = await readFile(new URL('../lib/supabase/billing-migration.sql', import.meta.url), 'utf8');
  await db.exec(sql); await db.exec(sql);
});
after(() => db.close());

async function role(role, sql, params = []) {
  await db.exec(`BEGIN; SET LOCAL ROLE ${role}`);
  try { return await db.query(sql, params); } finally { await db.exec('ROLLBACK'); }
}

test('browser roles cannot read, spoof, delete or claim billing ownership; service role can', async () => {
  for (const who of ['anon', 'authenticated']) {
    for (const sql of ['SELECT * FROM billing_accounts', 'SELECT * FROM billing_webhook_events', "INSERT INTO billing_accounts(user_id) VALUES ('" + owner + "')", 'DELETE FROM billing_accounts', 'UPDATE billing_accounts SET closed=true']) {
      await assert.rejects(role(who, sql), e => e.code === '42501');
    }
    await assert.rejects(role(who, 'SELECT * FROM claim_billing_account($1,$2)', [owner, token]), e => e.code === '42501');
  }
  assert.equal((await role('service_role', 'SELECT * FROM claim_billing_account($1,$2)', [owner, token])).rows[0].user_id, owner);
});

test('durable checkout lease excludes another request and preserves retry identity', async () => {
  const first = (await db.query('SELECT * FROM claim_billing_account($1,$2)', [owner, token])).rows[0];
  assert.equal((await db.query('SELECT * FROM claim_billing_account($1,$2)', [owner, nextToken])).rows.length, 0);
  await db.query("UPDATE billing_accounts SET lease_expires_at=now()-interval '1 second' WHERE user_id=$1", [owner]);
  const next = (await db.query('SELECT * FROM claim_billing_account($1,$2)', [owner, nextToken])).rows[0];
  assert.equal(next.attempt_id, first.attempt_id); assert.equal(next.lease_token, nextToken);
  // A delayed old worker cannot release the current owner's lease.
  assert.equal((await db.query('UPDATE billing_accounts SET lease_token=null WHERE user_id=$1 AND lease_token=$2 RETURNING *', [owner, token])).rows.length, 0);
});

test('customer mappings are unique and deletion-queued users cannot start checkout', async () => {
  await db.query("UPDATE billing_accounts SET customer_id='cus_first' WHERE user_id=$1", [owner]);
  await assert.rejects(db.query("INSERT INTO billing_accounts(user_id,customer_id) VALUES($1,'cus_first')", [other]), e => e.code === '23505');
  await db.query('INSERT INTO account_deletion_requests VALUES($1)', [other]);
  await assert.rejects(db.query('SELECT * FROM claim_billing_account($1,$2)', [other, token]), /deletion is in progress/);
});

test('checkout trial decision supports only unset, no-trial, or seven days', async () => {
  for (const days of [null, 0, 7]) {
    await db.query('UPDATE billing_accounts SET attempt_trial_days=$1 WHERE user_id=$2', [days, owner]);
    assert.equal((await db.query('SELECT attempt_trial_days FROM billing_accounts WHERE user_id=$1', [owner])).rows[0].attempt_trial_days, days);
  }
  for (const days of [-1, 1, 8, 30]) {
    await assert.rejects(db.query('UPDATE billing_accounts SET attempt_trial_days=$1 WHERE user_id=$2', [days, owner]), e => e.code === '23514');
  }
});

test('event ledger is idempotent and stores no card or full webhook payload', async () => {
  for (let i = 0; i < 2; i++) await db.exec("INSERT INTO billing_webhook_events(event_id,event_type,stripe_created) VALUES('evt_test','invoice.paid',123) ON CONFLICT DO NOTHING");
  assert.equal((await db.query('SELECT count(*)::int n FROM billing_webhook_events')).rows[0].n, 1);
  const columns = (await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='billing_webhook_events'")).rows.map(r => r.column_name);
  assert.deepEqual(columns.sort(), ['event_id', 'event_type', 'received_at', 'stripe_created']);
});

test('even background auth deletion cannot orphan an unclosed billing account', async () => {
  await assert.rejects(db.query('DELETE FROM auth.users WHERE id=$1', [owner]), /Billing must be closed/);
  await db.query('UPDATE billing_accounts SET closed=true WHERE user_id=$1', [owner]);
  await db.query('DELETE FROM auth.users WHERE id=$1', [owner]);
  assert.equal((await db.query('SELECT * FROM billing_accounts WHERE user_id=$1', [owner])).rows.length, 0);
});
