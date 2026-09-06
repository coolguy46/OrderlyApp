-- Conversational mutations: account-scoped receipts and atomic calendar writes.
-- Run after planner-migration.sql and task-scheduling-migration.sql.
begin;

-- CREATE FUNCTION does not validate every referenced column. Fail deployment
-- clearly instead of shipping against an older, browser-local planner schema.
do $$ begin
  if to_regprocedure('public.replace_planner_snapshot(bigint,jsonb,boolean)') is null
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='planner_preferences' and column_name='revision') then
    raise exception 'Apply the current planner-migration.sql before assistant-conversation-migration.sql';
  end if;
end $$;

create table if not exists public.assistant_action_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  conversation_id uuid not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.assistant_action_receipts enable row level security;
drop policy if exists assistant_receipts_owner on public.assistant_action_receipts;
create policy assistant_receipts_owner on public.assistant_action_receipts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert on public.assistant_action_receipts to authenticated;

create or replace function public.assistant_calendar_snapshot()
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  owner_id uuid := auth.uid();
  task_rows jsonb;
  event_rows jsonb;
  pref_rows jsonb;
  exam_rows jsonb;
begin
  if owner_id is null then raise exception 'Sign in first'; end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') into task_rows from public.tasks t where t.user_id = owner_id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') into event_rows from public.recurring_commitments e where e.user_id = owner_id;
  select to_jsonb(p) into pref_rows from public.planner_preferences p where p.user_id = owner_id;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') into exam_rows from public.exams e where e.user_id = owner_id;
  return jsonb_build_object('tasks', task_rows, 'events', event_rows, 'preferences', pref_rows, 'exams', exam_rows,
    'revision', md5(task_rows::text || event_rows::text || coalesce(pref_rows::text, 'null') || exam_rows::text));
end;
$$;

create or replace function public.apply_assistant_calendar_changes(
  p_request_id uuid, p_conversation_id uuid, p_revision text,
  p_operations jsonb, p_response jsonb
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  owner_id uuid := auth.uid();
  prior jsonb;
  item jsonb;
  row_data jsonb;
  previous_row jsonb;
  inverse_ops jsonb := '[]';
  result jsonb;
  task_row public.tasks%rowtype;
  event_row public.recurring_commitments%rowtype;
begin
  if owner_id is null then raise exception 'Sign in first'; end if;
  if p_request_id is null or p_conversation_id is null then raise exception 'Request ID required'; end if;
  -- Serialize assistant bundles for this account. A lost HTTP response can be
  -- retried with the same key; the original receipt wins, with no repeat writes.
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 19));
  select response into prior from public.assistant_action_receipts where user_id = owner_id and request_id = p_request_id;
  if found then return prior; end if;
  if jsonb_typeof(p_operations) <> 'array' or jsonb_array_length(p_operations) > 60 then raise exception 'Invalid operations'; end if;
  if jsonb_array_length(p_operations) > 0 and (public.assistant_calendar_snapshot()->>'revision') is distinct from p_revision then
    raise exception 'CALENDAR_CHANGED';
  end if;
  for item in select value from jsonb_array_elements(p_operations) loop
    if item->>'entity' = 'task' then
      select to_jsonb(t) into previous_row from public.tasks t where t.id = (item->>'id')::uuid and t.user_id = owner_id for update;
      if item->>'op' = 'delete' then
        if previous_row is null or coalesce(previous_row->>'source', 'manual') <> 'manual' then raise exception 'Only your manual task can be converted'; end if;
        delete from public.tasks where id = (item->>'id')::uuid and user_id = owner_id;
      elsif item->>'op' = 'put' then
        row_data := coalesce(previous_row, jsonb_build_object('priority','medium','status','pending','recurrence','none','source','manual')) || (item->'data');
        task_row := jsonb_populate_record(null::public.tasks, row_data || jsonb_build_object('id',item->>'id','user_id',owner_id));
        if task_row.title is null or length(trim(task_row.title)) = 0 or length(task_row.title) > 300 then raise exception 'Invalid task title'; end if;
        if task_row.duration_seconds is not null and (task_row.duration_seconds <= 0 or task_row.duration_seconds > 86400) then raise exception 'Invalid duration'; end if;
        if previous_row is null then
          insert into public.tasks(id,user_id,subject_id,title,description,priority,status,due_date,due_time,recurrence,recurrence_days,source,scheduled_date,scheduled_start_at,duration_seconds,schedule_recurrence_end_date,schedule_occurrence_overrides)
          values(task_row.id,owner_id,task_row.subject_id,task_row.title,task_row.description,task_row.priority,task_row.status,task_row.due_date,task_row.due_time,task_row.recurrence,task_row.recurrence_days,task_row.source,task_row.scheduled_date,task_row.scheduled_start_at,task_row.duration_seconds,task_row.schedule_recurrence_end_date,coalesce(task_row.schedule_occurrence_overrides,'{}'));
        else
          -- Deadlines, completion and Canvas fields cannot be modified by this
          -- scheduling API. Existing imported assignment metadata stays intact.
          update public.tasks set title=task_row.title,description=task_row.description,
            scheduled_date=task_row.scheduled_date,scheduled_start_at=task_row.scheduled_start_at,duration_seconds=task_row.duration_seconds,
            recurrence=task_row.recurrence,recurrence_days=task_row.recurrence_days,
            schedule_recurrence_end_date=task_row.schedule_recurrence_end_date,schedule_occurrence_overrides=coalesce(task_row.schedule_occurrence_overrides,'{}'),updated_at=clock_timestamp()
          where id=task_row.id and user_id=owner_id;
        end if;
      else raise exception 'Unknown task operation'; end if;
    elsif item->>'entity' = 'event' then
      select to_jsonb(e) into previous_row from public.recurring_commitments e where e.client_commitment_id = item->>'id' and e.user_id = owner_id for update;
      if previous_row->>'kind' = 'school' then raise exception 'School settings must be edited in Settings'; end if;
      if item->>'op' = 'delete' then
        if previous_row is null then raise exception 'Event no longer exists'; end if;
        delete from public.recurring_commitments where client_commitment_id=item->>'id' and user_id=owner_id;
      elsif item->>'op' = 'put' then
        row_data := coalesce(previous_row,jsonb_build_object('kind','personal','enabled',true,'time_zone','UTC','occurrence_overrides','{}'::jsonb)) || (item->'data');
        event_row := jsonb_populate_record(null::public.recurring_commitments,row_data || jsonb_build_object('client_commitment_id',item->>'id','user_id',owner_id));
        if event_row.title is null or length(trim(event_row.title))=0 or length(event_row.title)>300 or event_row.kind='school' then raise exception 'Invalid event'; end if;
        insert into public.recurring_commitments(user_id,client_commitment_id,title,description,location,kind,days_of_week,start_time,end_time,start_date,end_date,time_zone,enabled,color,occurrence_overrides)
        values(owner_id,event_row.client_commitment_id,event_row.title,event_row.description,event_row.location,event_row.kind,event_row.days_of_week,event_row.start_time,event_row.end_time,event_row.start_date,event_row.end_date,event_row.time_zone,event_row.enabled,event_row.color,coalesce(event_row.occurrence_overrides,'{}'))
        on conflict(user_id,client_commitment_id) do update set title=excluded.title,description=excluded.description,location=excluded.location,kind=excluded.kind,days_of_week=excluded.days_of_week,start_time=excluded.start_time,end_time=excluded.end_time,start_date=excluded.start_date,end_date=excluded.end_date,time_zone=excluded.time_zone,enabled=excluded.enabled,color=excluded.color,occurrence_overrides=excluded.occurrence_overrides,updated_at=clock_timestamp();
      else raise exception 'Unknown event operation'; end if;
    else raise exception 'Unknown entity'; end if;
    inverse_ops := jsonb_build_array(jsonb_build_object('entity',item->>'entity','id',item->>'id','op',case when previous_row is null then 'delete' else 'put' end,'data',previous_row)) || inverse_ops;
  end loop;
  -- The legacy whole-planner outbox also writes events. Advance its CAS
  -- revision so an older tab cannot reconcile-delete newly saved chat events.
  if exists (select 1 from jsonb_array_elements(p_operations) op where op->>'entity'='event') then
    insert into public.planner_preferences(user_id,revision,time_zone)
    values(owner_id,1,coalesce((select time_zone from public.recurring_commitments where user_id=owner_id order by updated_at desc limit 1),'UTC'))
    on conflict(user_id) do update set revision=public.planner_preferences.revision+1;
  end if;
  result := p_response || jsonb_build_object('requestId',p_request_id,'saved',jsonb_array_length(p_operations)>0,
    'undoOperations',inverse_ops,'revision',public.assistant_calendar_snapshot()->>'revision');
  insert into public.assistant_action_receipts(user_id,request_id,conversation_id,response) values(owner_id,p_request_id,p_conversation_id,result);
  return result;
end;
$$;
revoke all on function public.assistant_calendar_snapshot() from public, anon;
revoke all on function public.apply_assistant_calendar_changes(uuid,uuid,text,jsonb,jsonb) from public, anon;
grant execute on function public.assistant_calendar_snapshot() to authenticated;
grant execute on function public.apply_assistant_calendar_changes(uuid,uuid,text,jsonb,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
