-- Apply after assistant-usage-migration.sql and assistant-abuse-guard-migration.sql.
-- Deploy the matching server-bound routes only after this transaction succeeds.
-- Does not enable customer quotas or select a commercial/provider budget.
begin;
do $$ begin
  if to_regclass('public.assistant_ai_usage') is null or to_regclass('public.assistant_ai_leases') is null then
    raise exception 'Install and verify Assistant usage and abuse migrations first';
  end if;
end $$;

-- Revoke every legacy overload, including any earlier migration version. These
-- functions remain private implementation details of the wrappers below.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('assistant_reserve_ai_request','assistant_complete_ai_request','assistant_fail_ai_request')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.signature);
    execute format('alter function %s set search_path = pg_catalog, public, pg_temp', f.signature);
  end loop;
end $$;

create or replace function public.assistant_reserve_ai_request_server(
  p_user_id uuid, p_request_id uuid, p_daily_limit integer default 0, p_monthly_limit integer default 0
) returns table(allowed boolean, daily_used integer, monthly_used integer, daily_limit integer, monthly_limit integer)
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_previous text := current_setting('request.jwt.claim.sub', true);
begin
  -- Accounting identity and IDs are server-owned, tied to an actual admission
  -- lease. A browser cannot manufacture unlimited ledger entries through RPC.
  if not exists(select 1 from public.assistant_ai_leases where lease_id=p_request_id and user_id=p_user_id
    and released_at is null and expires_at>clock_timestamp()) then
    raise exception 'A current Assistant admission lease is required' using errcode='42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  return query select * from public.assistant_reserve_ai_request(p_request_id,p_daily_limit,p_monthly_limit);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous,''), true);
end $$;

create or replace function public.assistant_complete_ai_request_server(
  p_user_id uuid, p_request_id uuid, p_prompt_tokens integer default 0,
  p_completion_tokens integer default 0, p_total_tokens integer default 0, p_model text default null
) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_previous text := current_setting('request.jwt.claim.sub', true); v_result boolean;
begin
  if not exists(select 1 from public.assistant_ai_leases where lease_id=p_request_id and user_id=p_user_id) then
    raise exception 'Assistant admission lease ownership mismatch' using errcode='42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  v_result := public.assistant_complete_ai_request(p_request_id,p_prompt_tokens,p_completion_tokens,p_total_tokens,p_model);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous,''), true);
  return v_result;
end $$;

create or replace function public.assistant_fail_ai_request_server(p_user_id uuid,p_request_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_previous text := current_setting('request.jwt.claim.sub', true); v_result boolean;
begin
  if not exists(select 1 from public.assistant_ai_leases where lease_id=p_request_id and user_id=p_user_id) then
    raise exception 'Assistant admission lease ownership mismatch' using errcode='42501';
  end if;
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  v_result := public.assistant_fail_ai_request(p_request_id);
  perform set_config('request.jwt.claim.sub', coalesce(v_previous,''), true);
  return v_result;
end $$;

revoke all on function public.assistant_reserve_ai_request_server(uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.assistant_complete_ai_request_server(uuid,uuid,integer,integer,integer,text) from public,anon,authenticated;
revoke all on function public.assistant_fail_ai_request_server(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assistant_reserve_ai_request_server(uuid,uuid,integer,integer) to service_role;
grant execute on function public.assistant_complete_ai_request_server(uuid,uuid,integer,integer,integer,text) to service_role;
grant execute on function public.assistant_fail_ai_request_server(uuid,uuid) to service_role;

-- Aggregate safety counters have no personal data and survive account deletion.
-- Never cascade these counters: deleting/recreating an account cannot refund
-- organization-wide provider spend. UTC buckets account at dispatch admission.
create table if not exists public.assistant_provider_budget_buckets (
  period_kind text not null check(period_kind in ('day','month')),
  period_start date not null,
  charged_micro_usd bigint not null default 0 check(charged_micro_usd>=0),
  charged_tokens bigint not null default 0 check(charged_tokens>=0),
  primary key(period_kind,period_start)
);
create table if not exists public.assistant_provider_budget_calls (
  call_id uuid primary key,
  -- Account deletion removes the identity link, not its aggregate charge.
  -- No prompts or responses are stored.
  lease_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  day_start date not null,
  month_start date not null,
  reserved_micro_usd bigint not null check(reserved_micro_usd>0),
  reserved_tokens bigint not null check(reserved_tokens>0),
  settled_micro_usd bigint,
  settled_tokens bigint,
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  check((settled_at is null and settled_micro_usd is null and settled_tokens is null)
    or (settled_at is not null and settled_micro_usd between 0 and reserved_micro_usd and settled_tokens between 0 and reserved_tokens))
);
create index if not exists assistant_provider_budget_calls_created on public.assistant_provider_budget_calls(created_at);
create index if not exists assistant_ai_usage_retention_created on public.assistant_ai_usage(created_at);
create index if not exists assistant_ai_leases_retention_acquired on public.assistant_ai_leases(acquired_at);
alter table public.assistant_provider_budget_buckets enable row level security;
alter table public.assistant_provider_budget_calls enable row level security;
revoke all on public.assistant_provider_budget_buckets,public.assistant_provider_budget_calls from public,anon,authenticated,service_role;

create or replace function public.assistant_reserve_provider_budget(
  p_user_id uuid,p_lease_id uuid,p_call_id uuid,p_reserve_micro_usd bigint,p_reserve_tokens bigint,
  p_daily_micro_usd bigint,p_monthly_micro_usd bigint,p_daily_tokens bigint,p_monthly_tokens bigint
) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_now timestamptz; v_day date; v_month date; v_row public.assistant_provider_budget_buckets;
begin
  if p_call_id is null or p_reserve_micro_usd is null or p_reserve_micro_usd<=0 or p_reserve_tokens is null or p_reserve_tokens<=0
    or p_daily_micro_usd is null or p_daily_micro_usd<=0 or p_monthly_micro_usd is null or p_monthly_micro_usd<=0
    or p_daily_tokens is null or p_daily_tokens<=0 or p_monthly_tokens is null or p_monthly_tokens<=0 then
    raise exception 'Explicit positive provider safety limits required' using errcode='22023';
  end if;
  -- One short global transaction makes day/month reservation and replay checks
  -- atomic across workers, users, and all three AI routes.
  perform pg_advisory_xact_lock(hashtextextended('orderly:assistant-provider-budget',0));
  v_now := clock_timestamp();
  if not exists(select 1 from public.assistant_ai_leases l join public.assistant_ai_usage u on u.request_id=l.lease_id
      where l.lease_id=p_lease_id and l.user_id=p_user_id and u.user_id=p_user_id and u.status='reserved'
      and l.released_at is null and l.expires_at>v_now) then
    raise exception 'A current accounted Assistant admission lease is required' using errcode='42501';
  end if;
  if exists(select 1 from public.assistant_provider_budget_calls where call_id=p_call_id) then return false; end if;
  v_day := (v_now at time zone 'UTC')::date;
  v_month := date_trunc('month',v_now at time zone 'UTC')::date;
  insert into public.assistant_provider_budget_buckets(period_kind,period_start) values('day',v_day),('month',v_month) on conflict do nothing;
  for v_row in select * from public.assistant_provider_budget_buckets where (period_kind='day' and period_start=v_day) or (period_kind='month' and period_start=v_month) loop
    -- Subtraction avoids integer overflow for malicious/invalid RPC inputs.
    if p_reserve_micro_usd > (case when v_row.period_kind='day' then p_daily_micro_usd else p_monthly_micro_usd end) - v_row.charged_micro_usd
      or p_reserve_tokens > (case when v_row.period_kind='day' then p_daily_tokens else p_monthly_tokens end) - v_row.charged_tokens then return false; end if;
  end loop;
  insert into public.assistant_provider_budget_calls(call_id,lease_id,user_id,day_start,month_start,reserved_micro_usd,reserved_tokens)
    values(p_call_id,p_lease_id,p_user_id,v_day,v_month,p_reserve_micro_usd,p_reserve_tokens);
  update public.assistant_provider_budget_buckets set charged_micro_usd=charged_micro_usd+p_reserve_micro_usd,charged_tokens=charged_tokens+p_reserve_tokens
    where (period_kind='day' and period_start=v_day) or (period_kind='month' and period_start=v_month);
  return true;
end $$;

create or replace function public.assistant_settle_provider_budget(p_user_id uuid,p_call_id uuid,p_actual_micro_usd bigint,p_actual_tokens bigint)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_call public.assistant_provider_budget_calls;
begin
  perform pg_advisory_xact_lock(hashtextextended('orderly:assistant-provider-budget',0));
  select * into v_call from public.assistant_provider_budget_calls where call_id=p_call_id and user_id=p_user_id;
  if not found or v_call.settled_at is not null then return false; end if;
  if p_actual_micro_usd is null or p_actual_tokens is null or p_actual_micro_usd<0 or p_actual_tokens<0
    or p_actual_micro_usd>v_call.reserved_micro_usd or p_actual_tokens>v_call.reserved_tokens then
    -- Unknown/contradictory provider usage never refunds a reservation.
    return false;
  end if;
  update public.assistant_provider_budget_buckets set charged_micro_usd=charged_micro_usd-(v_call.reserved_micro_usd-p_actual_micro_usd),
    charged_tokens=charged_tokens-(v_call.reserved_tokens-p_actual_tokens)
    where (period_kind='day' and period_start=v_call.day_start) or (period_kind='month' and period_start=v_call.month_start);
  update public.assistant_provider_budget_calls set settled_micro_usd=p_actual_micro_usd,settled_tokens=p_actual_tokens,settled_at=clock_timestamp() where call_id=p_call_id;
  return true;
end $$;

-- Optional maintenance only; no scheduler or retention change is activated.
-- Preserve this month and the prior 90 days. Pruning never changes aggregate
-- charges, and removed call IDs cannot replay without a current usage/lease.
create or replace function public.assistant_prune_security_metadata(p_before timestamptz,p_batch_size integer default 500)
returns integer language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_count integer; v_more integer;
begin
  if p_before is null or p_before > date_trunc('month',clock_timestamp() at time zone 'UTC') at time zone 'UTC' - interval '90 days' then
    raise exception 'Retention cutoff must be older than the protected accounting window' using errcode='22023';
  end if;
  delete from public.assistant_provider_budget_calls where call_id in
    (select call_id from public.assistant_provider_budget_calls where created_at<p_before order by created_at limit least(greatest(coalesce(p_batch_size,500),1),1000));
  get diagnostics v_count = row_count;
  delete from public.assistant_ai_usage where request_id in
    (select request_id from public.assistant_ai_usage where created_at<p_before order by created_at limit least(greatest(coalesce(p_batch_size,500),1),1000));
  get diagnostics v_more = row_count; v_count := v_count + v_more;
  delete from public.assistant_ai_leases where lease_id in
    (select lease_id from public.assistant_ai_leases where acquired_at<p_before and expires_at<p_before order by acquired_at limit least(greatest(coalesce(p_batch_size,500),1),1000));
  get diagnostics v_more = row_count; v_count := v_count + v_more;
  return v_count;
end $$;

revoke all on function public.assistant_reserve_provider_budget(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint) from public,anon,authenticated;
revoke all on function public.assistant_settle_provider_budget(uuid,uuid,bigint,bigint) from public,anon,authenticated;
revoke all on function public.assistant_prune_security_metadata(timestamptz,integer) from public,anon,authenticated;
grant execute on function public.assistant_reserve_provider_budget(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint) to service_role;
grant execute on function public.assistant_settle_provider_budget(uuid,uuid,bigint,bigint) to service_role;
grant execute on function public.assistant_prune_security_metadata(timestamptz,integer) to service_role;
comment on table public.assistant_provider_budget_buckets is 'No personal data. Durable UTC dispatch-admission budget totals; account deletion does not refund spend.';
comment on table public.assistant_provider_budget_calls is 'Server-only provider budget metadata; no prompts/responses. Unknown outcomes retain the full reservation. Explicit bounded maintenance is available, not scheduled.';
commit;
