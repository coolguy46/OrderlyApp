-- Read-only metadata and aggregate checks. Never returns user content, IDs,
-- feed URLs, Vault values, HTTP headers, or worker request bodies.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'profile_client_insert',has_table_privilege('authenticated','public.profiles','INSERT'),
  'counter_mismatches',(SELECT count(*) FROM public.profiles p
    WHERE tasks_completed IS DISTINCT FROM (SELECT LEAST(count(*),2147483647)::integer FROM public.tasks t WHERE t.user_id=p.id AND t.status='completed')
    OR total_study_time IS DISTINCT FROM (SELECT LEAST(coalesce(sum(s.duration_minutes),0),2147483647)::integer FROM public.study_sessions s WHERE s.user_id=p.id)),
  'open_competition_policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('competitions','competition_participants')),
  'competition_client_select',has_table_privilege('authenticated','public.competitions','SELECT'),
  'participants_client_select',has_table_privilege('authenticated','public.competition_participants','SELECT'),
  'private_tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
    'anon_access',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),
    'client_access',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relname IN ('account_deletion_requests','canvas_provider_request_limits','assistant_ai_leases')),
  'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,
    'anon',has_function_privilege('anon',p.oid,'EXECUTE'),
    'client',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'server',has_function_privilege('service_role',p.oid,'EXECUTE'),'search_path',p.proconfig))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND p.proname IN ('protect_profile_managed_fields','adjust_completed_task_count','adjust_total_study_time',
      'claim_account_deletion_requests','dispatch_account_deletions','dispatch_due_canvas_syncs',
      'claim_canvas_sync','complete_canvas_sync','claim_canvas_provider_request','release_canvas_provider_request')),
  'cron_jobs',(SELECT jsonb_agg(jsonb_build_object('name',jobname,'active',active,'schedule',schedule)) FROM cron.job),
  'queue_pending',(SELECT count(*) FROM public.account_deletion_requests WHERE status <> 'completed'),
  'builtin_uuid_function_installed',to_regprocedure('pg_catalog.gen_random_uuid()') IS NOT NULL,
  'http_response_columns',(SELECT jsonb_agg(column_name) FROM information_schema.columns WHERE table_schema='net' AND table_name='_http_response')
) AS verification;
ROLLBACK;
