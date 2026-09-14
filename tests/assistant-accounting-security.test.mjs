import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { bindAssistantUsageClient } from '../lib/planner/assistant-usage.ts';
import { assistantBudgetConfiguration, assistantBudgetEnvelope, fetchBudgetedAssistantProvider } from '../lib/planner/assistant-budget.ts';
import { complimentaryBillingPeriod } from '../lib/billing/plan.ts';
import { assistantProviderBody } from '../lib/planner/assistant-provider.ts';

const db = new PGlite();
const owner = randomUUID(), other = randomUUID();
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const originalFetch = globalThis.fetch;
let legacyWrites = 0;
const environment = {
  DEEPSEEK_BUDGET_MODEL: 'synthetic-model', AI_PROVIDER_DAILY_BUDGET_USD: '10', AI_PROVIDER_MONTHLY_BUDGET_USD: '100',
  AI_PROVIDER_DAILY_TOKEN_LIMIT: '1000000', AI_PROVIDER_MONTHLY_TOKEN_LIMIT: '10000000',
  DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: '1.25', DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: '2.5',
};

async function roleQuery(role, sql, parameters = [], user = '') {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [user]);
    return await db.query(sql, parameters);
  } finally { await db.exec('RESET ROLE'); }
}
const service = (sql, args) => roleQuery('service_role', sql, args);
async function admitted(user = owner, { daily = 0, monthly = 0 } = {}) {
  const leaseId = randomUUID();
  await db.query("INSERT INTO assistant_ai_leases(lease_id,request_id,user_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '90 seconds')", [leaseId, randomUUID(), user]);
  const result = await service('SELECT * FROM assistant_reserve_ai_request_server($1,$2,$3,$4)', [user, leaseId, daily, monthly]);
  return { leaseId, result: result.rows[0] };
}
async function reserve(leaseId, { user = owner, id = randomUUID(), cost = 100, tokens = 100, daily = 200, monthly = 300, dailyTokens = 200, monthlyTokens = 300 } = {}) {
  const result = await service('SELECT assistant_reserve_provider_budget($1,$2,$3,$4,$5,$6,$7,$8,$9) AS allowed', [user, leaseId, id, cost, tokens, daily, monthly, dailyTokens, monthlyTokens]);
  return { id, allowed: result.rows[0].allowed };
}
async function cleanBudget() { await db.exec('TRUNCATE assistant_provider_budget_calls,assistant_provider_budget_buckets'); }

before(async () => {
  await db.exec(`CREATE SCHEMA auth; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE public.assistant_action_receipts(user_id uuid,request_id uuid,response jsonb);
  `);
  await db.query('INSERT INTO auth.users(id) VALUES($1),($2)', [owner,other]);
  await db.exec((await read('lib/supabase/assistant-usage-migration.sql')).replace(/^CREATE EXTENSION[^;]+;/gmi,''));
  // Safely reproduce direct browser ledger pollution before the repair.
  for (let i = 0; i < 3; i++) {
    const old = await roleQuery('authenticated','SELECT allowed FROM assistant_reserve_ai_request($1,0,0)',[randomUUID()],owner);
    legacyWrites += Number(old.rows[0].allowed);
  }
  await db.exec('TRUNCATE assistant_ai_usage');
  await db.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql'));
  // An additional legacy overload must not retain stale explicit grants.
  await db.exec('CREATE FUNCTION assistant_fail_ai_request(integer) RETURNS boolean LANGUAGE sql AS $$SELECT true$$');
  const migration = await read('lib/supabase/assistant-accounting-security-migration.sql');
  await db.exec(migration); await db.exec(migration);
});
after(async () => { globalThis.fetch = originalFetch; await db.close(); });

test('direct authenticated ledger pollution is reproduced, then every legacy overload and server RPC denies browser roles', async () => {
  assert.equal(legacyWrites,3);
  const functions = (await db.query(`SELECT p.oid::text oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE 'assistant_%ai_request%' OR p.proname LIKE 'assistant_%provider_budget' OR p.proname='assistant_prune_security_metadata')`)).rows;
  assert.ok(functions.length >= 10);
  for (const f of functions) for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS allowed",[role,f.oid])).rows[0].allowed,false,`${role}:${f.proname}`);
  }
  for (const user of [owner,other,'']) {
    const role = user ? 'authenticated' : 'anon';
    await assert.rejects(roleQuery(role,'SELECT assistant_reserve_ai_request($1,0,0)',[randomUUID()],user),e=>e.code==='42501');
    await assert.rejects(roleQuery(role,'SELECT assistant_reserve_ai_request_server($1,$2,0,0)',[owner,randomUUID()],user),e=>e.code==='42501');
    for (const table of ['assistant_ai_usage','assistant_ai_leases','assistant_provider_budget_calls','assistant_provider_budget_buckets']) {
      await assert.rejects(roleQuery(role,`SELECT * FROM ${table}`,[],user),e=>e.code==='42501');
    }
  }
});

test('trusted usage admission requires a current owned lease; completion cannot cross users or replay; identity context is restored', async () => {
  const {leaseId,result} = await admitted();
  assert.equal(result.allowed,true); assert.equal(result.daily_limit,0,'no new customer quota');
  assert.equal((await service('SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[owner,leaseId])).rows[0].allowed,false);
  await assert.rejects(service('SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[other,leaseId]),e=>e.code==='42501');
  await assert.rejects(service('SELECT assistant_complete_ai_request_server($1,$2,1,1,2,$3)',[other,leaseId,'fixture']),e=>e.code==='42501');
  assert.equal((await service('SELECT assistant_complete_ai_request_server($1,$2,1,1,2,$3) AS done',[owner,leaseId,'fixture'])).rows[0].done,true);
  assert.equal((await service('SELECT assistant_complete_ai_request_server($1,$2,1,1,2,$3) AS done',[owner,leaseId,'fixture'])).rows[0].done,false);
  assert.equal((await db.query("SELECT current_setting('request.jwt.claim.sub',true) AS sub")).rows[0].sub,'');
  const expired = randomUUID();
  await db.query("INSERT INTO assistant_ai_leases(lease_id,request_id,user_id,expires_at) VALUES($1,$2,$3,clock_timestamp()-interval '1 second')",[expired,randomUUID(),owner]);
  await assert.rejects(service('SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[owner,expired]),e=>e.code==='42501');
});

test('global atomic budget admission covers different users and duplicates without overshooting the configured allowance', async () => {
  await cleanBudget();
  const a = await admitted(), b = await admitted(other);
  const accepted = await reserve(a.leaseId);
  assert.equal(accepted.allowed,true);
  assert.equal((await reserve(a.leaseId,{id:accepted.id})).allowed,false,'same provider attempt cannot buy a second call');
  assert.equal((await reserve(b.leaseId,{user:other})).allowed,true);
  assert.equal((await reserve(a.leaseId)).allowed,false,'across-user daily dollar/token cap');
  const totals = (await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows;
  assert.equal(totals.length,2); assert.ok(totals.every(row=>Number(row.charged_micro_usd)===200 && Number(row.charged_tokens)===200));
  const migration = await read('lib/supabase/assistant-accounting-security-migration.sql');
  assert.match(migration,/pg_advisory_xact_lock\(hashtextextended\('orderly:assistant-provider-budget',0\)\)/,'cross-process atomic database serialization, not process memory');
});

test('repeated concurrent admission submissions share one database ceiling rather than process-local counters', async () => {
  const a=await admitted();
  // PGlite queues statements on its isolated connection. This stresses atomic
  // statements and counter/idempotency results, not a production load test or
  // a claim to emulate PostgreSQL lock contention across remote connections.
  for(let round=0;round<5;round++) {
    await cleanBudget();
    const submissions=await Promise.all(Array.from({length:20},()=>db.query(
      'SELECT assistant_reserve_provider_budget($1,$2,$3,100,100,300,300,300,300) AS allowed',[owner,a.leaseId,randomUUID()])));
    assert.equal(submissions.filter(result=>result.rows[0].allowed).length,3);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM assistant_provider_budget_calls')).rows[0].count,3);
    assert.ok((await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===300));
  }
});

test('monthly and token caps cannot be bypassed with larger daily caps, zero limits, forged leases or unsettled requests', async () => {
  await cleanBudget(); const a=await admitted();
  assert.equal((await reserve(a.leaseId,{monthly:100})).allowed,true);
  assert.equal((await reserve(a.leaseId,{daily:1000,monthly:100})).allowed,false);
  await cleanBudget();
  assert.equal((await reserve(a.leaseId,{cost:1,dailyTokens:100})).allowed,true);
  assert.equal((await reserve(a.leaseId,{cost:1,dailyTokens:100})).allowed,false,'independent token circuit breaker');
  await assert.rejects(reserve(a.leaseId,{cost:0}),e=>e.code==='22023');
  await assert.rejects(reserve(a.leaseId,{user:other}),e=>e.code==='42501');
  await assert.rejects(reserve(randomUUID()),e=>e.code==='42501');
  assert.equal((await db.query('SELECT count(*)::int AS count FROM assistant_provider_budget_calls WHERE settled_at IS NULL')).rows[0].count,1,'unknown outcome remains reserved');
});

test('settlement is bounded, once-only and owner-scoped; account deletion never refunds global provider spend', async () => {
  await cleanBudget(); const a=await admitted(); const call=await reserve(a.leaseId);
  const settle=(user,cost,tokens)=>service('SELECT assistant_settle_provider_budget($1,$2,$3,$4) AS done',[user,call.id,cost,tokens]);
  assert.equal((await settle(other,1,1)).rows[0].done,false);
  assert.equal((await settle(owner,-1,1)).rows[0].done,false);
  assert.equal((await settle(owner,101,100)).rows[0].done,false);
  assert.equal((await settle(owner,25,20)).rows[0].done,true);
  assert.equal((await settle(owner,0,0)).rows[0].done,false);
  assert.ok((await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===25 && Number(row.charged_tokens)===20));
  const disposable=randomUUID(); await db.query('INSERT INTO auth.users VALUES($1)',[disposable]);
  const b=await admitted(disposable); const another=await reserve(b.leaseId,{user:disposable});
  await db.query('DELETE FROM auth.users WHERE id=$1',[disposable]);
  assert.equal((await db.query('SELECT user_id FROM assistant_provider_budget_calls WHERE call_id=$1',[another.id])).rows[0].user_id,null);
  assert.ok((await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===125));
});

test('bounded explicit retention cannot delete recent reservations or refund budget counters', async () => {
  await cleanBudget(); const a=await admitted(); const call=await reserve(a.leaseId);
  await assert.rejects(service('SELECT assistant_prune_security_metadata(now(),500)'),e=>e.code==='22023');
  assert.equal((await service("SELECT assistant_prune_security_metadata(now()-interval '200 days',500) AS count")).rows[0].count,0);
  await db.query("UPDATE assistant_provider_budget_calls SET created_at=clock_timestamp()-interval '400 days' WHERE call_id=$1",[call.id]);
  assert.equal((await service("SELECT assistant_prune_security_metadata(now()-interval '200 days',1) AS count")).rows[0].count,1);
  assert.ok((await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===100));
});

test('bound usage adapter uses verified identity and an RPC allowlist, never a caller-supplied identity', async () => {
  const calls=[]; const client=bindAssistantUsageClient({async rpc(...args){calls.push(args);return {data:true,error:null};}},owner);
  await client.rpc('assistant_complete_ai_request',{p_user_id:other,p_request_id:'fixture'});
  assert.equal(calls[0][0],'assistant_complete_ai_request_server'); assert.equal(calls[0][1].p_user_id,owner);
  assert.ok((await client.rpc('delete_all_users',{})).error); assert.equal(calls.length,1);
  assert.ok((await bindAssistantUsageClient(null,owner).rpc('assistant_reserve_ai_request',{})).error);
});

test('budget configuration has no invented defaults, rejects malformed values/model drift and computes conservative exact cost', () => {
  assert.equal(assistantBudgetConfiguration({}),null);
  for (const value of ['0','-1','NaN','Infinity',' 10 ','1e4','0.0000001']) assert.equal(assistantBudgetConfiguration({...environment,AI_PROVIDER_DAILY_BUDGET_USD:value}),null);
  for (const value of ['0','1.5','1e6','9007199254740992']) assert.equal(assistantBudgetConfiguration({...environment,AI_PROVIDER_DAILY_TOKEN_LIMIT:value}),null);
  const configuration=assistantBudgetConfiguration(environment); assert.ok(configuration);
  const body=assistantProviderBody('synthetic-model',[{role:'user',content:'Study 📚'}],500);
  const envelope=assistantBudgetEnvelope(body,configuration);
  assert.ok(envelope.promptTokens>new TextEncoder().encode(body).byteLength);
  assert.equal(envelope.microUsd,Math.ceil(envelope.promptTokens*1.25+500*2.5));
  assert.throws(()=>assistantBudgetEnvelope(body,{...configuration,model:'unreviewed-model'}));
  assert.throws(()=>assistantBudgetEnvelope(body.replace('"max_tokens":500','"max_tokens":99999'),configuration));
});

test('provider dispatch only follows a confirmed durable admission; retries get unique reservations and valid usage settles', async () => {
  const calls=[]; let dispatched=0;
  const client={async rpc(name,args){calls.push({name,args});return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}};
  globalThis.fetch=async()=>{dispatched++;return Response.json({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});};
  const body=assistantProviderBody('synthetic-model',[{role:'user',content:'Test'}],500);
  const options={billingPeriod:complimentaryBillingPeriod(),apiKey:'not-a-real-key',signal:new AbortController().signal,deadline:Date.now()+10_000};
  for (let i=0;i<3;i++) await fetchBudgetedAssistantProvider(client,owner,randomUUID(),body,options,environment);
  assert.equal(dispatched,3);
  const reserves=calls.filter(c=>c.name==='assistant_reserve_paid_provider_budget');
  assert.equal(new Set(reserves.map(c=>c.args.p_call_id)).size,3,'each repair/lookup has separate exposure');
  assert.equal(calls.filter(c=>c.name==='assistant_settle_paid_provider_budget').length,3);
  for(const result of [{data:false,error:null},{data:null,error:{code:'offline'}},{data:'true',error:null}]) {
    await assert.rejects(fetchBudgetedAssistantProvider({rpc:async()=>result},owner,randomUUID(),body,options,environment));
  }
  await assert.rejects(fetchBudgetedAssistantProvider(client,owner,randomUUID(),body,options,{}));
  assert.equal(dispatched,3);
});

test('a reservation committed before its response is lost never dispatches and remains charged in the real isolated ledger', async () => {
  await cleanBudget(); const {leaseId}=await admitted();let dispatched=0;
  globalThis.fetch=async()=>{dispatched++;return Response.json({});};
  const client={rpc:async(name,p)=>{
    assert.equal(name,'assistant_reserve_paid_provider_budget');
    await service('SELECT assistant_reserve_provider_budget($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
      p.p_user_id,p.p_lease_id,p.p_call_id,p.p_reserve_micro_usd,p.p_reserve_tokens,p.p_daily_micro_usd,p.p_monthly_micro_usd,p.p_daily_tokens,p.p_monthly_tokens,
    ]);
    throw new Error('Synthetic lost response after reservation commit');
  }};
  await assert.rejects(fetchBudgetedAssistantProvider(client,owner,leaseId,assistantProviderBody('synthetic-model',[{role:'user',content:'Test'}],500),
    {billingPeriod:complimentaryBillingPeriod(),apiKey:'not-a-real-key',signal:new AbortController().signal,deadline:Date.now()+10_000},environment));
  assert.equal(dispatched,0);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM assistant_provider_budget_calls WHERE settled_at IS NULL')).rows[0].count,1);
  assert.ok((await db.query('SELECT * FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)>0));
});

test('timeouts, HTTP errors, malformed/absent usage and lost settlement do not refund uncertain provider spend', async () => {
  const body=assistantProviderBody('synthetic-model',[{role:'user',content:'Test'}],500);
  const options={billingPeriod:complimentaryBillingPeriod(),apiKey:'not-a-real-key',signal:new AbortController().signal,deadline:Date.now()+10_000};
  for(const provider of [async()=>{throw new Error('network lost');},async()=>new Response('',{status:500}),async()=>Response.json({}),async()=>Response.json({usage:{prompt_tokens:1,completion_tokens:1,total_tokens:1}}),async()=>Response.json({usage:{prompt_tokens:1_000_000,completion_tokens:1,total_tokens:1_000_001}})]) {
    const calls=[];globalThis.fetch=provider;
    const client={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}};
    await fetchBudgetedAssistantProvider(client,owner,randomUUID(),body,options,environment).catch(()=>{});
    assert.equal(calls.filter(c=>c.name==='assistant_reserve_paid_provider_budget').length,1);
    assert.equal(calls.filter(c=>c.name==='assistant_settle_paid_provider_budget').length,0);
  }
});

test('abort or elapsed deadline during admission never dispatches, and only confirmed pre-dispatch cancellation refunds', async () => {
  const controller=new AbortController(); const calls=[];let fetches=0;
  globalThis.fetch=async()=>{fetches++;return Response.json({});};
  const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='assistant_reserve_paid_provider_budget')controller.abort();return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}};
  const body=assistantProviderBody('synthetic-model',[{role:'user',content:'Test'}],500);
  await assert.rejects(fetchBudgetedAssistantProvider(client,owner,randomUUID(),body,{billingPeriod:complimentaryBillingPeriod(),apiKey:'not-a-real-key',signal:controller.signal,deadline:Date.now()+10_000},environment));
  assert.equal(fetches,0);assert.equal(calls.at(-1).args.p_actual_micro_usd,0);
});

test('lost settlement responses retain the existing admission and do not retry or log sensitive provider data', async () => {
  const messages=[];const originalError=console.error;console.error=(...args)=>messages.push(args);
  let fetches=0;const calls=[];
  globalThis.fetch=async()=>{fetches++;return Response.json({usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15}});};
  const client={rpc:async(name,args)=>{calls.push({name,args});if(name==='assistant_settle_paid_provider_budget')throw new Error('secret-provider-content');return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}};
  try {
    await fetchBudgetedAssistantProvider(client,owner,randomUUID(),assistantProviderBody('synthetic-model',[{role:'user',content:'Private assignment'}],500),
      {billingPeriod:complimentaryBillingPeriod(),apiKey:'not-a-real-key',signal:new AbortController().signal,deadline:Date.now()+10_000},environment);
    assert.equal(fetches,1);assert.equal(calls.length,2);assert.deepEqual(messages,[['Assistant provider safety:','settlement_unconfirmed']]);
  } finally {console.error=originalError;}
});
