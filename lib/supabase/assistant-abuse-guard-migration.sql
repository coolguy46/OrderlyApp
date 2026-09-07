-- Server-only technical abuse protection shared by all paid Assistant routes.
-- No daily/monthly allowance. Apply before deploying routes that require it.
begin;
do $$
begin
  if (select count(*) from pg_attribute where attrelid=to_regclass('public.assistant_action_receipts')
      and attname in ('user_id','request_id','response') and not attisdropped) <> 3 then
    raise exception 'Apply assistant-conversation-migration.sql and verify owner-scoped action receipts before the Assistant abuse guard';
  end if;
  if to_regclass('public.assistant_ai_leases') is not null then
    if (select count(*) from pg_attribute where attrelid=to_regclass('public.assistant_ai_leases')
        and attname in ('lease_id','request_id','user_id','acquired_at','expires_at','released_at') and not attisdropped) <> 6
       or not exists(select 1 from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
         where c.conrelid=to_regclass('public.assistant_ai_leases') and c.contype='p' and cardinality(c.conkey)=1 and a.attname='lease_id') then
      raise exception 'Unexpected Assistant lease schema (possibly an earlier provisional draft); review and migrate existing lease data before applying this file';
    end if;
  end if;
end;
$$;
create table if not exists public.assistant_ai_leases (
  lease_id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  acquired_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  released_at timestamptz
);
create index if not exists assistant_ai_leases_user_acquired
  on public.assistant_ai_leases(user_id, acquired_at desc);
create index if not exists assistant_ai_leases_user_request
  on public.assistant_ai_leases(user_id, request_id, expires_at desc);
alter table public.assistant_ai_leases enable row level security;
revoke all on public.assistant_ai_leases from public, anon, authenticated;
grant select, insert, update, delete on public.assistant_ai_leases to service_role;

create or replace function public.assistant_acquire_ai_lease(
  p_user_id uuid, p_request_id uuid,
  p_per_minute integer default 6, p_max_concurrent integer default 2
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_lease_id uuid;
  v_limit integer := least(greatest(coalesce(p_per_minute, 6), 1), 60);
  v_concurrent integer := least(greatest(coalesce(p_max_concurrent, 2), 1), 4);
begin
  -- EXECUTE grants below are the boundary: verified server identity is required.
  if p_user_id is null or p_request_id is null then raise exception 'Identity required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('assistant-lease:' || p_user_id::text, 0));
  -- Serialize with receipt writes too: if an earlier save is still committing,
  -- inspect its final result before granting another paid attempt.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 19));
  v_now := clock_timestamp();
  if exists(select 1 from public.assistant_action_receipts where user_id=p_user_id and request_id=p_request_id) then
    return jsonb_build_object('allowed', false, 'reason', 'completed', 'retry_after', 0);
  end if;
  -- Released attempts also wait out their original lifetime. A lost response
  -- can safely retry its stable request ID only when the earlier invocation has
  -- expired and no receipt exists. Keep every attempt to avoid refunding bursts.
  if exists(select 1 from public.assistant_ai_leases where user_id=p_user_id and request_id=p_request_id and expires_at>v_now) then
    return jsonb_build_object('allowed', false, 'reason', 'duplicate', 'retry_after', 5);
  end if;
  -- Count completed/failed/disconnected requests too; releasing a lease must
  -- never refund its burst slot or permit an attacker to reset the counter.
  select count(*) into v_count from public.assistant_ai_leases
    where user_id=p_user_id and acquired_at > v_now - interval '60 seconds';
  if v_count >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'rate', 'retry_after', 60);
  end if;
  select count(*) into v_count from public.assistant_ai_leases
    where user_id=p_user_id and released_at is null and expires_at > v_now;
  if v_count >= v_concurrent then
    return jsonb_build_object('allowed', false, 'reason', 'concurrency', 'retry_after', 5);
  end if;
  insert into public.assistant_ai_leases(request_id,user_id,acquired_at,expires_at)
    values(p_request_id,p_user_id,v_now,v_now + interval '90 seconds')
    returning lease_id into v_lease_id;
  return jsonb_build_object('allowed', true, 'reason', 'allowed', 'retry_after', 0, 'lease_id', v_lease_id);
end;
$$;
create or replace function public.assistant_release_ai_lease(p_user_id uuid,p_lease_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
begin
  update public.assistant_ai_leases set released_at=clock_timestamp()
    where user_id=p_user_id and lease_id=p_lease_id and released_at is null;
  return found;
end;
$$;
revoke all on function public.assistant_acquire_ai_lease(uuid,uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.assistant_release_ai_lease(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assistant_acquire_ai_lease(uuid,uuid,integer,integer) to service_role;
grant execute on function public.assistant_release_ai_lease(uuid,uuid) to service_role;
comment on table public.assistant_ai_leases is 'Server-only Assistant burst/concurrency request metadata; no prompts or task content. Account deletion cascades. No new automatic retention policy.';
commit;
