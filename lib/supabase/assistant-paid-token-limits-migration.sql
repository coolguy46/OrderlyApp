-- Apply AFTER assistant-accounting-security-migration.sql, BEFORE the matching
-- paid-provider routes. No subscriptions, account identities or user content change.
begin;
create table if not exists public.assistant_token_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  period_kind text not null check(period_kind in ('day','billing')),
  period_start timestamptz not null,
  charged_tokens bigint not null default 0 check(charged_tokens>=0),
  primary key(user_id,period_kind,period_start)
);
create table if not exists public.assistant_token_calls (
  call_id uuid primary key references public.assistant_provider_budget_calls(call_id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  day_start timestamptz not null,
  billing_start timestamptz not null,
  reserved_tokens bigint not null check(reserved_tokens>0),
  settled boolean not null default false
);
alter table public.assistant_token_buckets enable row level security;
alter table public.assistant_token_calls enable row level security;
revoke all on public.assistant_token_buckets,public.assistant_token_calls from public,anon,authenticated,service_role;

create or replace function public.assistant_reserve_paid_provider_budget(
  p_user_id uuid,p_lease_id uuid,p_call_id uuid,p_reserve_micro_usd bigint,p_reserve_tokens bigint,
  p_daily_micro_usd bigint,p_monthly_micro_usd bigint,p_daily_tokens bigint,p_monthly_tokens bigint,
  p_billing_period_start timestamptz,p_billing_period_end timestamptz
) returns text language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_now timestamptz; v_day timestamptz; v_row public.assistant_token_buckets;
begin
  perform pg_advisory_xact_lock(hashtextextended('orderly:assistant-provider-budget',0));
  v_now := clock_timestamp();
  if p_billing_period_start is null or p_billing_period_end is null or not isfinite(p_billing_period_start)
    or not isfinite(p_billing_period_end) or p_billing_period_start>v_now or p_billing_period_end<=v_now
    or p_billing_period_end<=p_billing_period_start or p_billing_period_end-p_billing_period_start>interval '32 days'
    or p_reserve_tokens is null or p_reserve_tokens<=0 then
    raise exception 'Current verified billing period and positive token reservation required' using errcode='22023';
  end if;
  if not exists(select 1 from public.assistant_ai_leases l join public.assistant_ai_usage u on u.request_id=l.lease_id
    where l.lease_id=p_lease_id and l.user_id=p_user_id and u.user_id=p_user_id and u.status='reserved'
    and l.released_at is null and l.expires_at>v_now) then
    raise exception 'Current owned accounted lease required' using errcode='42501';
  end if;
  if exists(select 1 from public.assistant_provider_budget_calls where call_id=p_call_id) then return 'replay'; end if;
  v_day := date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC';
  insert into public.assistant_token_buckets(user_id,period_kind,period_start)
    values(p_user_id,'day',v_day),(p_user_id,'billing',p_billing_period_start) on conflict do nothing;
  for v_row in select * from public.assistant_token_buckets where user_id=p_user_id and
    ((period_kind='day' and period_start=v_day) or (period_kind='billing' and period_start=p_billing_period_start)) loop
    if p_reserve_tokens > (case when v_row.period_kind='day' then 50000 else 1000000 end)-v_row.charged_tokens then
      return case when v_row.period_kind='day' then 'daily_limit' else 'monthly_limit' end;
    end if;
  end loop;
  if not public.assistant_reserve_provider_budget(p_user_id,p_lease_id,p_call_id,p_reserve_micro_usd,p_reserve_tokens,
      p_daily_micro_usd,p_monthly_micro_usd,p_daily_tokens,p_monthly_tokens) then return 'global_limit'; end if;
  insert into public.assistant_token_calls(call_id,user_id,day_start,billing_start,reserved_tokens)
    values(p_call_id,p_user_id,v_day,p_billing_period_start,p_reserve_tokens);
  update public.assistant_token_buckets set charged_tokens=charged_tokens+p_reserve_tokens where user_id=p_user_id and
    ((period_kind='day' and period_start=v_day) or (period_kind='billing' and period_start=p_billing_period_start));
  return 'allowed';
end $$;

create or replace function public.assistant_settle_paid_provider_budget(
  p_user_id uuid,p_call_id uuid,p_actual_micro_usd bigint,p_actual_tokens bigint
) returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare v_call public.assistant_token_calls;
begin
  perform pg_advisory_xact_lock(hashtextextended('orderly:assistant-provider-budget',0));
  select * into v_call from public.assistant_token_calls where call_id=p_call_id and user_id=p_user_id;
  if not found or v_call.settled then return false; end if;
  if not public.assistant_settle_provider_budget(p_user_id,p_call_id,p_actual_micro_usd,p_actual_tokens) then return false; end if;
  update public.assistant_token_buckets set charged_tokens=charged_tokens-(v_call.reserved_tokens-p_actual_tokens)
    where user_id=p_user_id and ((period_kind='day' and period_start=v_call.day_start)
      or (period_kind='billing' and period_start=v_call.billing_start));
  update public.assistant_token_calls set settled=true where call_id=p_call_id;
  return true;
end $$;

-- Neither browsers nor other service callers can bypass the per-account wrapper.
revoke all on function public.assistant_reserve_provider_budget(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint) from service_role;
revoke all on function public.assistant_settle_provider_budget(uuid,uuid,bigint,bigint) from service_role;
revoke all on function public.assistant_reserve_paid_provider_budget(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.assistant_settle_paid_provider_budget(uuid,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.assistant_reserve_paid_provider_budget(uuid,uuid,uuid,bigint,bigint,bigint,bigint,bigint,bigint,timestamptz,timestamptz) to service_role;
grant execute on function public.assistant_settle_paid_provider_budget(uuid,uuid,bigint,bigint) to service_role;
comment on table public.assistant_token_buckets is 'Server-only token admission: 50,000 per UTC day and 1,000,000 per verified Stripe billing period. Includes unknown in-flight reservations; no prompts.';
commit;
