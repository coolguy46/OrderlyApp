import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { complimentaryBillingPeriod, ORDERLY_AI_DAILY_TOKENS, ORDERLY_AI_MONTHLY_TOKENS } from '../lib/billing/plan.ts';
import { fetchBudgetedAssistantProvider, AssistantTokenLimitError } from '../lib/planner/assistant-budget.ts';
import { assistantProviderBody } from '../lib/planner/assistant-provider.ts';

const db=new PGlite(), owner=randomUUID(), other=randomUUID();
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const period=()=>({start:new Date(Date.now()-3*86400000).toISOString(),end:new Date(Date.now()+27*86400000).toISOString()});
let lease, billing;
const originalFetch=globalThis.fetch;
async function role(role,sql,args=[]) {
  await db.exec(`SET ROLE ${role}`);
  try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}
}
async function admit(user=owner) {
  const id=randomUUID();
  await db.query("INSERT INTO assistant_ai_leases(lease_id,request_id,user_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '90 seconds')",[id,randomUUID(),user]);
  await role('service_role','SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[user,id]);
  return id;
}
async function reset() {
  await db.exec('TRUNCATE assistant_token_calls,assistant_token_buckets,assistant_provider_budget_calls,assistant_provider_budget_buckets');
  lease=await admit();billing=period();
}
async function reserve(tokens, {user=owner,id=randomUUID(),leaseId=lease,window=billing}={}) {
  const result=await role('service_role','SELECT assistant_reserve_paid_provider_budget($1,$2,$3,100,$4,10000000,100000000,10000000,100000000,$5,$6) AS result',
    [user,leaseId,id,tokens,window.start,window.end]);
  return {id,result:result.rows[0].result};
}
const settle=(user,id,tokens)=>role('service_role','SELECT assistant_settle_paid_provider_budget($1,$2,10,$3) AS done',[user,id,tokens]);
before(async()=>{
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE public.assistant_action_receipts(user_id uuid,request_id uuid,response jsonb);`);
  await db.query('INSERT INTO auth.users VALUES($1),($2)',[owner,other]);
  await db.exec((await read('lib/supabase/assistant-usage-migration.sql')).replace(/^CREATE EXTENSION[^;]+;/gmi,''));
  await db.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql'));
  // Execute exact release SQL twice, including the required ordering.
  for(let pass=0;pass<2;pass++) {
    await db.exec(await read('lib/supabase/assistant-accounting-security-migration.sql'));
    await db.exec(await read('lib/supabase/assistant-paid-token-limits-migration.sql'));
  }
});
after(async()=>{globalThis.fetch=originalFetch;await db.close();});

test('paid quota tables and RPCs deny browser roles; service cannot use legacy global admission to bypass per-user caps',async()=>{
  await reset();
  for(const actor of ['anon','authenticated']) {
    for(const table of ['assistant_token_calls','assistant_token_buckets']) await assert.rejects(role(actor,`SELECT * FROM ${table}`),e=>e.code==='42501');
    await assert.rejects(role(actor,'SELECT assistant_reserve_paid_provider_budget($1,$2,$3,1,1,100,100,100,100,$4,$5)',[owner,lease,randomUUID(),billing.start,billing.end]),e=>e.code==='42501');
    await assert.rejects(role(actor,'SELECT assistant_settle_paid_provider_budget($1,$2,0,0)',[owner,randomUUID()]),e=>e.code==='42501');
  }
  await assert.rejects(role('service_role','SELECT assistant_reserve_provider_budget($1,$2,$3,1,1,100,100,100,100)',[owner,lease,randomUUID()]),e=>e.code==='42501');
  await assert.rejects(role('service_role','SELECT assistant_settle_provider_budget($1,$2,0,0)',[owner,randomUUID()]),e=>e.code==='42501');
  await assert.rejects(reserve(1,{user:other}),e=>e.code==='42501');
});

test('50k daily ceiling is atomic; valid settlement refunds only unused reserve and cannot be replayed or stolen',async()=>{
  await reset();assert.equal(ORDERLY_AI_DAILY_TOKENS,50000);
  const call=await reserve(50000);assert.equal(call.result,'allowed');
  assert.equal((await reserve(1)).result,'daily_limit');
  assert.equal((await reserve(50000,{id:call.id})).result,'replay');
  for(const [user,tokens] of [[other,0],[owner,-1],[owner,50001]]) assert.equal((await settle(user,call.id,tokens)).rows[0].done,false);
  assert.equal((await settle(owner,call.id,1000)).rows[0].done,true);
  assert.equal((await settle(owner,call.id,0)).rows[0].done,false);
  assert.equal((await reserve(49000)).result,'allowed');
  assert.equal((await reserve(1)).result,'daily_limit');
  assert.ok((await db.query('SELECT charged_tokens FROM assistant_token_buckets')).rows.every(r=>Number(r.charged_tokens)===50000));
});

test('1M billing-month cap is independent of UTC days and is never reset at a calendar month boundary',async()=>{
  await reset();assert.equal(ORDERLY_AI_MONTHLY_TOKENS,1000000);
  const call=await reserve(1);await settle(owner,call.id,0);
  await db.query("UPDATE assistant_token_buckets SET charged_tokens=990000 WHERE period_kind='billing'");
  assert.equal((await reserve(10000)).result,'allowed');
  assert.equal((await reserve(1)).result,'monthly_limit');
  // Advancing the daily bucket does not change the verified paid period.
  await db.query("UPDATE assistant_token_buckets SET period_start=period_start-interval '1 day' WHERE period_kind='day'");
  assert.equal((await reserve(1)).result,'monthly_limit');
  const rows=(await db.query("SELECT * FROM assistant_token_buckets WHERE period_kind='billing'")).rows;
  assert.equal(rows.length,1);assert.equal(new Date(rows[0].period_start).toISOString(),billing.start);
  // A different, current server-verified renewal period gets its own bucket.
  const renewal={start:new Date(Date.now()-1000).toISOString(),end:new Date(Date.now()+30*86400000).toISOString()};
  assert.equal((await reserve(1,{window:renewal})).result,'allowed');
});

test('UTC day rolls over separately; invalid or expired billing periods never create reservations',async()=>{
  await reset();await reserve(50000);
  await db.query("UPDATE assistant_token_buckets SET period_start=period_start-interval '1 day' WHERE period_kind='day'");
  assert.equal((await reserve(1)).result,'allowed');
  for(const window of [{start:null,end:billing.end},{start:billing.start,end:new Date(Date.now()-1000).toISOString()},
    {start:new Date(Date.now()+10000).toISOString(),end:billing.end},{start:'-infinity',end:'infinity'},
    {start:new Date(Date.now()-40*86400000).toISOString(),end:billing.end}]) await assert.rejects(reserve(1,{window}),e=>e.code==='22023');
});

test('bursts across multiple leases cannot exceed one user allowance; another paid user retains their own quota',async()=>{
  for(let pass=0;pass<3;pass++) {
    await reset();const secondLease=await admit();
    // PGlite queues one backend: checks SQL invariants, not remote load capacity.
    const results=await Promise.all(Array.from({length:20},(_,i)=>reserve(5000,{leaseId:i%2?secondLease:lease})));
    assert.equal(results.filter(r=>r.result==='allowed').length,10);
    const otherLease=await admit(other);
    assert.equal((await reserve(50000,{user:other,leaseId:otherLease})).result,'allowed');
  }
});

test('global denial does not charge a personal bucket; account deletion does not refund provider spend',async()=>{
  await reset();
  const denied=await role('service_role','SELECT assistant_reserve_paid_provider_budget($1,$2,$3,100,100,1,1,1,1,$4,$5) AS result',[owner,lease,randomUUID(),billing.start,billing.end]);
  assert.equal(denied.rows[0].result,'global_limit');
  assert.ok((await db.query('SELECT charged_tokens FROM assistant_token_buckets')).rows.every(r=>Number(r.charged_tokens)===0));
  const disposable=randomUUID();await db.query('INSERT INTO auth.users VALUES($1)',[disposable]);
  const id=await admit(disposable);await reserve(100,{user:disposable,leaseId:id});
  await db.query('DELETE FROM auth.users WHERE id=$1',[disposable]);
  assert.ok((await db.query('SELECT charged_tokens FROM assistant_provider_budget_buckets')).rows.every(r=>Number(r.charged_tokens)===100));
  assert.equal((await db.query('SELECT user_id FROM assistant_token_calls')).rows[0].user_id,null);
});

test('HTTP admission checks current trusted period and raises clear daily/monthly quota errors before provider dispatch',async()=>{
  let fetches=0;globalThis.fetch=async()=>{fetches++;return Response.json({});};
  const env={DEEPSEEK_BUDGET_MODEL:'fixture',AI_PROVIDER_DAILY_BUDGET_USD:'5',AI_PROVIDER_MONTHLY_BUDGET_USD:'50',AI_PROVIDER_DAILY_TOKEN_LIMIT:'5000000',AI_PROVIDER_MONTHLY_TOKEN_LIMIT:'50000000',DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS:'0.3',DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS:'1.2'};
  const body=assistantProviderBody('fixture',[{role:'user',content:'test'}],500);
  const options={apiKey:'synthetic',signal:new AbortController().signal,deadline:Date.now()+10000,billingPeriod:complimentaryBillingPeriod()};
  for(const period of ['daily','monthly']) await assert.rejects(fetchBudgetedAssistantProvider({rpc:async(name,p)=>{
    assert.equal(name,'assistant_reserve_paid_provider_budget');assert.equal(p.p_billing_period_start,options.billingPeriod.start);
    return {data:`${period}_limit`,error:null};
  }},owner,randomUUID(),body,options,env),e=>e instanceof AssistantTokenLimitError&&e.period===period);
  await assert.rejects(fetchBudgetedAssistantProvider({rpc:async()=>assert.fail('missing period must reject before RPC')},owner,randomUUID(),body,{...options,billingPeriod:undefined},env));
  assert.equal(fetches,0);
});
