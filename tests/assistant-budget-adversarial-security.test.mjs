import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fetchBudgetedAssistantProvider } from '../lib/planner/assistant-budget.ts';
import { complimentaryBillingPeriod } from '../lib/billing/plan.ts';
import { assistantProviderBody } from '../lib/planner/assistant-provider.ts';

// All rates/allowances here are synthetic test parameters, never deployment
// configuration. All provider responses are local fetch mocks.
const environment = { DEEPSEEK_BUDGET_MODEL: 'adversarial-fixture',
  AI_PROVIDER_DAILY_BUDGET_USD: '10', AI_PROVIDER_MONTHLY_BUDGET_USD: '100',
  AI_PROVIDER_DAILY_TOKEN_LIMIT: '1000000', AI_PROVIDER_MONTHLY_TOKEN_LIMIT: '10000000',
  DEEPSEEK_INPUT_USD_PER_MILLION_TOKENS: '1', DEEPSEEK_OUTPUT_USD_PER_MILLION_TOKENS: '2' };
const body = assistantProviderBody('adversarial-fixture',[{role:'user',content:'Synthetic schedule'}],500);
const originalFetch = globalThis.fetch;
const originalError = console.error;
const log = [];
const db = new PGlite();
const users = ['30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002'];
const leases = ['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002'];
const SEEDS = [0x5eed5afe,0xa11ce026,0xbadc0de];
const read = path => readFile(new URL(`../${path}`,import.meta.url),'utf8');

before(async()=>{
  console.error=(...args)=>log.push(args);
  await db.exec(`CREATE SCHEMA auth;CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    CREATE TABLE public.assistant_action_receipts(user_id uuid,request_id uuid,response jsonb);`);
  await db.exec((await read('lib/supabase/assistant-usage-migration.sql')).replace(/^CREATE EXTENSION[^;]+;/gmi,''));
  await db.exec(await read('lib/supabase/assistant-abuse-guard-migration.sql'));
  await db.exec(await read('lib/supabase/assistant-accounting-security-migration.sql'));
  await db.exec(await read('lib/supabase/security-rate-limit-migration.sql'));
  for(let i=0;i<users.length;i++) {
    await db.query('INSERT INTO auth.users VALUES($1)',[users[i]]);
    await db.query("INSERT INTO assistant_ai_leases(lease_id,request_id,user_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '90 seconds')",[leases[i],randomUUID(),users[i]]);
    await db.query('SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[users[i],leases[i]]);
  }
});
after(async()=>{globalThis.fetch=originalFetch;console.error=originalError;await db.close();});

function rng(seed) {let state=seed>>>0;return limit=>{state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)%limit;};}
function idFrom(seed,index) {return `50000000-${(seed&65535).toString(16).padStart(4,'0')}-4000-8000-${index.toString(16).padStart(12,'0')}`;}
async function asRole(role,sql,args=[]) {await db.exec(`SET ROLE ${role}`);try{return await db.query(sql,args);}finally{await db.exec('RESET ROLE');}}
const budgetQuery='SELECT assistant_reserve_provider_budget($1,$2,$3,$4,$5,10000,20000,50000,100000) AS allowed';

test('malformed numeric-string provider usage never refunds a conservative reservation (failing-before regression)',async()=>{
  for(const usage of [
    {prompt_tokens:'10',completion_tokens:'5',total_tokens:'15'},
    {prompt_tokens:'10',completion_tokens:5,total_tokens:15},
    {prompt_tokens:10,completion_tokens:'5',total_tokens:15},
    {prompt_tokens:10,completion_tokens:5,total_tokens:'15'},
  ]) {
    const calls=[];globalThis.fetch=async()=>Response.json({usage});
    await fetchBudgetedAssistantProvider({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}},users[0],leases[0],body,
      {billingPeriod:complimentaryBillingPeriod(),apiKey:'synthetic-no-network',signal:new AbortController().signal,deadline:Date.now()+1000},environment);
    assert.equal(calls.filter(call=>call.name==='assistant_settle_paid_provider_budget').length,0,JSON.stringify(usage));
  }
});

test('seeded malformed and boundary provider usage cannot manufacture refunds or unbounded retries',async()=>{
  const malformed=[null,undefined,false,true,-1,0,1.1,'1','01','1e3',[],{},Number.MAX_SAFE_INTEGER,1e100];
  for(const seed of SEEDS) {
    const next=rng(seed);
    for(let step=0;step<100;step++) {
      const usage={prompt_tokens:10,completion_tokens:5,total_tokens:15};
      const field=['prompt_tokens','completion_tokens','total_tokens'][next(3)];
      usage[field]=malformed[next(malformed.length)];
      const calls=[];let providers=0;
      globalThis.fetch=async()=>{providers++;return Response.json({usage});};
      await fetchBudgetedAssistantProvider({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}},users[0],leases[0],body,
        {billingPeriod:complimentaryBillingPeriod(),apiKey:'synthetic-no-network',signal:new AbortController().signal,deadline:Date.now()+1000},environment);
      assert.equal(providers,1,`seed=${seed},step=${step}`);
      assert.equal(calls.filter(call=>call.name==='assistant_settle_paid_provider_budget').length,0,`seed=${seed},step=${step},usage=${JSON.stringify(usage)}`);
    }
  }
});

test('valid numeric usage including zero output settles once with exact rounded cost',async()=>{
  for(const completion of [0,5]) {
    const calls=[];globalThis.fetch=async()=>Response.json({usage:{prompt_tokens:10,completion_tokens:completion,total_tokens:10+completion}});
    await fetchBudgetedAssistantProvider({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='assistant_reserve_paid_provider_budget'?'allowed':true,error:null};}},users[0],leases[0],body,
      {billingPeriod:complimentaryBillingPeriod(),apiKey:'synthetic-no-network',signal:new AbortController().signal,deadline:Date.now()+1000},environment);
    const settlements=calls.filter(call=>call.name==='assistant_settle_paid_provider_budget');
    assert.equal(settlements.length,1);
    assert.equal(settlements[0].args.p_actual_tokens,10+completion);
    assert.equal(settlements[0].args.p_actual_micro_usd,10+completion*2);
  }
});

test('seeded SQL state-machine attacks preserve exact totals across owned admission, replay, refund and cross-user attempts',async()=>{
  for(const seed of SEEDS) {
    await db.exec('TRUNCATE assistant_provider_budget_calls,assistant_provider_budget_buckets');
    const next=rng(seed),records=[];let expectedCost=0,expectedTokens=0;
    for(let step=0;step<200;step++) {
      const choice=next(4);
      if(choice===0 || !records.length) {
        const actor=next(2),cost=1+next(700),tokens=1+next(4000),id=idFrom(seed,step);
        const expected=expectedCost+cost<=10000 && expectedTokens+tokens<=50000;
        const result=await asRole('service_role',budgetQuery,[users[actor],leases[actor],id,cost,tokens]);
        assert.equal(result.rows[0].allowed,expected,`seed=${seed},step=${step}:reserve`);
        if(expected){expectedCost+=cost;expectedTokens+=tokens;records.push({actor,cost,tokens,id,settled:false});}
      } else {
        const record=records[next(records.length)];
        if(choice===1) {
          assert.equal((await asRole('service_role',budgetQuery,[users[record.actor],leases[record.actor],record.id,record.cost,record.tokens])).rows[0].allowed,false,'duplicate is never allowed');
        } else {
          const wrong=choice===3,actualCost=next(record.cost+1),actualTokens=next(record.tokens+1);
          const result=await asRole('service_role','SELECT assistant_settle_provider_budget($1,$2,$3,$4) AS allowed',[users[wrong?1-record.actor:record.actor],record.id,actualCost,actualTokens]);
          const expected=!wrong && !record.settled;
          assert.equal(result.rows[0].allowed,expected,`seed=${seed},step=${step}:settle`);
          if(expected){expectedCost-=record.cost-actualCost;expectedTokens-=record.tokens-actualTokens;record.settled=true;}
        }
      }
      const totals=(await db.query('SELECT charged_micro_usd,charged_tokens FROM assistant_provider_budget_buckets')).rows;
      assert.equal(totals.length,2);
      assert.ok(totals.every(row=>Number(row.charged_micro_usd)===expectedCost && Number(row.charged_tokens)===expectedTokens),`seed=${seed},step=${step}:counter mismatch`);
      assert.ok(expectedCost<=10000 && expectedTokens<=50000);
    }
  }
});

test('malformed direct SQL calls fail closed for browser roles even when they know valid lease and provider-call IDs',async()=>{
  for(const role of ['anon','authenticated']) {
    for(const user of users) for(const amount of [0,-1,1,Number.MAX_SAFE_INTEGER]) {
      await assert.rejects(asRole(role,budgetQuery,[user,leases[0],randomUUID(),amount,amount]),error=>error.code==='42501');
      await assert.rejects(asRole(role,'SELECT assistant_settle_provider_budget($1,$2,$3,$4)',[user,randomUUID(),amount,amount]),error=>error.code==='42501');
      await assert.rejects(asRole(role,'SELECT consume_security_rate_limit($1,$2,$3,$4)',[user,'billing_checkout',10000,1]),error=>error.code==='42501');
    }
  }
  assert.ok(!JSON.stringify(log).includes('synthetic-no-network'),'credentials never enter diagnostic output');
});

test('queued SQL lease and rate bursts do not reset counters through release or stable request replay',async()=>{
  // PGlite executes these submissions on ONE backend. This exercises dispatch
  // order and real SQL invariants, NOT independent-connection lock contention.
  for(let round=0;round<10;round++) {
    const user=randomUUID(),requestIds=Array.from({length:24},()=>randomUUID());
    await db.query('INSERT INTO auth.users VALUES($1)',[user]);
    await db.exec('SET ROLE service_role');
    try {
      const burst=await Promise.all(requestIds.map(id=>db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS result',[user,id])));
      const admitted=burst.map((result,index)=>({index,...result.rows[0].result})).filter(result=>result.allowed);
      assert.equal(admitted.length,2,`round=${round}:concurrency`);
      for(const admission of admitted) {
        assert.equal((await db.query('SELECT assistant_release_ai_lease($1,$2) AS result',[users[0],admission.lease_id])).rows[0].result,false);
        assert.equal((await db.query('SELECT assistant_release_ai_lease($1,$2) AS result',[user,admission.lease_id])).rows[0].result,true);
        const replay=(await db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS result',[user,requestIds[admission.index]])).rows[0].result;
        assert.equal(replay.allowed,false);assert.equal(replay.reason,'duplicate');
      }
      for(let attempt=0;attempt<8;attempt++) {
        const result=(await db.query('SELECT assistant_acquire_ai_lease($1,$2,6,2) AS result',[user,randomUUID()])).rows[0].result;
        assert.equal(result.allowed,attempt<4,`round=${round}:burst must count released attempts`);
        if(result.allowed) await db.query('SELECT assistant_release_ai_lease($1,$2)',[user,result.lease_id]);
        else assert.equal(result.reason,'rate');
      }
      const rates=await Promise.all(Array.from({length:40},()=>db.query("SELECT consume_security_rate_limit($1,'billing_checkout',6,86400) AS result",[user])));
      assert.equal(rates.filter(result=>result.rows[0].result.allowed).length,6,`round=${round}:rate admission`);
      assert.ok(rates.filter(result=>!result.rows[0].result.allowed).every(result=>result.rows[0].result.retry_after>0));
    } finally {await db.exec('RESET ROLE');}
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM assistant_ai_leases WHERE user_id=$1',[user])).rows[0].count),6);
    assert.equal(Number((await db.query('SELECT count(*) AS count FROM security_rate_limits WHERE user_id=$1',[user])).rows[0].count),1);
    await db.query('DELETE FROM auth.users WHERE id=$1',[user]);
  }
});

test('SQL maximum bigint budgets cannot wrap and invalid minimum limits cannot dispatch',async()=>{
  await db.exec('TRUNCATE assistant_provider_budget_calls,assistant_provider_budget_buckets');
  const max='9223372036854775807',id=randomUUID();
  const query='SELECT assistant_reserve_provider_budget($1,$2,$3,$4,$4,$5,$5,$5,$5) AS allowed';
  assert.equal((await asRole('service_role',query,[users[0],leases[0],id,max,max])).rows[0].allowed,true);
  assert.equal((await asRole('service_role',query,[users[0],leases[0],randomUUID(),1,max])).rows[0].allowed,false);
  for(const invalid of [null,0,-1]) await assert.rejects(asRole('service_role',query,[users[0],leases[0],randomUUID(),1,invalid]),error=>error.code==='22023');
  await assert.rejects(asRole('service_role',query,[users[0],leases[0],randomUUID(),'9223372036854775808',max]),error=>error.code==='22003');
  const totals=(await db.query('SELECT charged_micro_usd::text AS cost,charged_tokens::text AS tokens FROM assistant_provider_budget_buckets')).rows;
  assert.ok(totals.every(row=>row.cost===max && row.tokens===max));
  assert.equal((await asRole('service_role','SELECT assistant_settle_provider_budget($1,$2,0,0) AS allowed',[users[0],id])).rows[0].allowed,true);
  assert.ok((await db.query('SELECT charged_micro_usd,charged_tokens FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===0 && Number(row.charged_tokens)===0));
});

test('account deletion then UUID recreation cannot reclaim in-flight or settled provider charges',async()=>{
  await db.exec('TRUNCATE assistant_provider_budget_calls,assistant_provider_budget_buckets');
  const user=randomUUID(),lease=randomUUID(),first=randomUUID(),second=randomUUID();
  await db.query('INSERT INTO auth.users VALUES($1)',[user]);
  await db.query("INSERT INTO assistant_ai_leases(lease_id,request_id,user_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '90 seconds')",[lease,randomUUID(),user]);
  await asRole('service_role','SELECT * FROM assistant_reserve_ai_request_server($1,$2,0,0)',[user,lease]);
  for(const id of [first,second]) assert.equal((await asRole('service_role',budgetQuery,[user,lease,id,100,100])).rows[0].allowed,true);
  assert.equal((await asRole('service_role','SELECT assistant_settle_provider_budget($1,$2,50,50) AS allowed',[user,first])).rows[0].allowed,true);
  await db.query('DELETE FROM auth.users WHERE id=$1',[user]);
  await db.query('INSERT INTO auth.users VALUES($1)',[user]);
  for(const id of [first,second]) assert.equal((await asRole('service_role','SELECT assistant_settle_provider_budget($1,$2,0,0) AS allowed',[user,id])).rows[0].allowed,false);
  await assert.rejects(asRole('service_role',budgetQuery,[user,lease,randomUUID(),1,1]),error=>error.code==='42501');
  assert.ok((await db.query('SELECT user_id FROM assistant_provider_budget_calls')).rows.every(row=>row.user_id===null));
  assert.ok((await db.query('SELECT charged_micro_usd,charged_tokens FROM assistant_provider_budget_buckets')).rows.every(row=>Number(row.charged_micro_usd)===150 && Number(row.charged_tokens)===150));
  await db.query('DELETE FROM auth.users WHERE id=$1',[user]);
});
