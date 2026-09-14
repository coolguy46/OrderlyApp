-- Apply and verify this exact file before deploying routes that require it.
-- Technical shared token buckets; no prompts, payment details, IPs or URL data.
begin;
create table if not exists public.security_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope ~ '^[a-z][a-z0-9_]{0,47}$'),
  tokens numeric not null check (tokens >= 0 and tokens <= 10000),
  updated_at timestamptz not null,
  primary key (user_id, scope)
);
alter table public.security_rate_limits enable row level security;
revoke all on public.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.security_rate_limits to service_role;

create or replace function public.consume_security_rate_limit(
  p_user_id uuid, p_scope text, p_max_requests integer, p_window_seconds integer
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
set lock_timeout = '1000ms'
as $$
declare
  v_now timestamptz;
  v_row public.security_rate_limits%rowtype;
  v_available numeric;
  v_retry integer;
begin
  if p_user_id is null or p_scope is null or p_scope !~ '^[a-z][a-z0-9_]{0,47}$'
    or p_max_requests is null or p_max_requests < 1 or p_max_requests > 10000
    or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit policy' using errcode = '22023';
  end if;
  -- Serialize both initial creation and consumption across all server instances.
  perform pg_advisory_xact_lock(hashtextextended('request-limit:' || p_user_id::text, 0));
  v_now := clock_timestamp();
  select * into v_row from public.security_rate_limits where user_id=p_user_id and scope=p_scope for update;
  if not found then
    -- Server mistakes cannot create unlimited buckets for an existing account.
    if (select count(*) from public.security_rate_limits where user_id=p_user_id) >= 32 then
      raise exception 'Rate limit scope capacity exceeded' using errcode = '54000';
    end if;
    insert into public.security_rate_limits(user_id,scope,tokens,updated_at)
      values(p_user_id,p_scope,p_max_requests - 1,v_now);
    return jsonb_build_object('allowed',true,'retry_after',0);
  end if;
  v_available := least(p_max_requests, v_row.tokens + greatest(0,extract(epoch from v_now-v_row.updated_at))
    * p_max_requests / p_window_seconds);
  if v_available < 1 then
    v_retry := greatest(1,ceil((1-v_available)*p_window_seconds/p_max_requests)::integer);
    -- Denials do not add rows, refund tokens or postpone recovery indefinitely.
    return jsonb_build_object('allowed',false,'retry_after',v_retry);
  end if;
  update public.security_rate_limits set tokens=v_available-1,updated_at=v_now where user_id=p_user_id and scope=p_scope;
  return jsonb_build_object('allowed',true,'retry_after',0);
end;
$$;
revoke all on function public.consume_security_rate_limit(uuid,text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit(uuid,text,integer,integer) to service_role;
comment on table public.security_rate_limits is 'Service-only shared burst counters; at most 32 rows per account through the RPC, reused instead of event logs, and cascade-deleted with auth.users.';
commit;
