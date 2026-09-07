-- Orderly security: READ-ONLY production metadata and migration preflight.
-- Run in the intended Supabase project's SQL Editor as its administrator.
-- This file does not create objects, change grants, schedule jobs, call app
-- RPCs, contact external services, or return user content/identifiers/secrets.
-- It returns schema metadata and invalid-reference COUNTS only.
--
-- Run BEFORE the security migrations and AGAIN afterwards. Save the metadata
-- results privately with the deployment record. A zero invalid_count means
-- the selected ownership check passed, not that the whole app is secure.
-- "not installed" is normal for optional legacy features. Missing required
-- Assistant lease schema/RPCs is a blocker for the new paid-route deployment.
-- Any invalid_count > 0 requires backed-up manual review; do not delete rows
-- just to make the migration pass. The migration itself aborts transactionally.
--
-- Every statement runs under an explicitly READ ONLY transaction. The local
-- timeout protects against unusually large legacy data. If it times out,
-- ROLLBACK before retrying a smaller section; no changes were applied.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';

-- 1. Known application tables: RLS must be enabled. A table grant alone does
-- not bypass RLS, so SELECT=true for authenticated is expected for client data.
-- Internal deletion/usage/lease/provider tables must have no browser grants.
WITH expected(table_name, internal_only) AS (VALUES
  ('profiles',false),('subjects',false),('tasks',false),('goals',false),
  ('study_sessions',false),('exams',false),('canvas_settings',false),
  ('timer_states',false),('planner_preferences',false),
  ('recurring_commitments',false),('planner_plans',false),
  ('planner_blocks',false),('planner_feedback',false),('plan_adjustments',false),
  ('assistant_action_receipts',false),('friendships',false),
  ('competitions',true),('competition_participants',true),('achievements',false),
  ('resume_items',false),('college_courses',false),('extracurriculars',false),
  ('college_applications',false),('test_scores',false),('recommendations',false),
  ('study_sets',false),('flashcards',false),('mcq_questions',false),
  ('study_set_files',false),('sat_act_progress',false),
  ('assistant_ai_usage',true),('assistant_ai_leases',true),
  ('canvas_provider_request_limits',true),('account_deletion_requests',true)
)
SELECT e.table_name, c.oid IS NOT NULL AS installed, e.internal_only,
  c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
  CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') END AS anon_any_crud_grant,
  CASE WHEN c.oid IS NOT NULL THEN has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') END AS authenticated_any_crud_grant,
  pg_get_userbyid(c.relowner) AS table_owner
FROM expected e
LEFT JOIN pg_class c ON c.oid=to_regclass('public.' || e.table_name)
ORDER BY e.table_name;

-- 2. Actual RLS policy definitions. These are schema expressions, not records.
-- Review unexpected permissive policies: policies may be OR-ed together.
-- Accepted-friend profile access is existing behavior, not an owner-only policy.
SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;

-- 3. Function existence, execution grants, and search paths. No function body
-- or Vault secret is selected. For server_only=true, anon/authenticated execute
-- must both be false. For invoker APIs, authenticated execute=true is expected.
WITH expected(signature, server_only) AS (VALUES
  ('public.dispatch_due_canvas_syncs()',true),
  ('public.dispatch_account_deletions()',true),
  ('public.claim_account_deletion_requests(integer,uuid)',true),
  ('public.claim_canvas_sync(uuid)',true),
  ('public.renew_canvas_sync_lease(uuid,uuid,bigint)',true),
  ('public.complete_canvas_sync(uuid,uuid,bigint,text,timestamp with time zone,integer)',true),
  ('public.release_canvas_sync_lease(uuid,uuid,bigint)',true),
  ('public.assistant_acquire_ai_lease(uuid,uuid,integer,integer)',true),
  ('public.assistant_release_ai_lease(uuid,uuid)',true),
  ('public.assistant_calendar_snapshot()',false),
  ('public.apply_assistant_calendar_changes(uuid,uuid,text,jsonb,jsonb)',false),
  ('public.complete_task_with_successor(uuid,jsonb)',false),
  ('public.replace_planner_snapshot(bigint,jsonb,boolean)',false),
  ('public.assistant_reserve_ai_request(uuid,integer,integer)',false),
  ('public.assistant_complete_ai_request(uuid,integer,integer,integer,text)',false),
  ('public.assistant_fail_ai_request(uuid)',false),
  ('public.enforce_owned_optional_reference()',true),
  ('public.enforce_study_set_link_ownership()',true),
  ('public.enforce_study_file_path_ownership()',true)
)
SELECT e.signature, p.oid IS NOT NULL AS installed, e.server_only,
  p.prosecdef AS security_definer, p.proconfig AS function_settings,
  CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon',p.oid,'EXECUTE') END AS anon_execute,
  CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated',p.oid,'EXECUTE') END AS authenticated_execute,
  CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role',p.oid,'EXECUTE') END AS service_role_execute
FROM expected e
LEFT JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.signature;

-- 4. New relationship guard presence. Enabled must be O (normal) or A (always),
-- not D (disabled). These triggers may be absent before applying the migration.
SELECT c.relname AS table_name, t.tgname AS trigger_name, t.tgenabled AS enabled,
  p.proname AS trigger_function
FROM pg_trigger t
JOIN pg_class c ON c.oid=t.tgrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_proc p ON p.oid=t.tgfoid
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND (t.tgname LIKE 'security_owned_%' OR t.tgname LIKE '%enforce_owned%')
ORDER BY c.relname,t.tgname;

-- 5. Clients must not be able to create attacker-controlled public objects.
SELECT role_name, has_schema_privilege(role_name,'public','CREATE') AS can_create_public_objects
FROM (VALUES ('anon'),('authenticated')) AS client_roles(role_name);

-- 6. Actual lease columns/constraints/indexes for comparing with the deployed
-- assistant-abuse-guard-migration.sql. UUID/timestamp metadata only, no entries.
SELECT column_name,data_type,is_nullable,column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='assistant_ai_leases'
ORDER BY ordinal_position;
SELECT indexname,indexdef
FROM pg_indexes
WHERE schemaname='public' AND tablename='assistant_ai_leases'
ORDER BY indexname;

-- 7. Invalid nested ownership counts. query_to_xml executes only the static
-- SELECT strings below; it lets optional missing tables be skipped without
-- creating a helper function or temporary table. No row content is returned.
WITH checks(name, required_tables, query) AS (VALUES
  ('planner block commitment ownership', ARRAY['planner_blocks','recurring_commitments'],
   $q$SELECT count(*) AS count FROM public.planner_blocks child LEFT JOIN public.recurring_commitments parent ON parent.id=child.commitment_id WHERE child.commitment_id IS NOT NULL AND (parent.id IS NULL OR parent.user_id<>child.user_id)$q$),
  ('study set exam ownership', ARRAY['study_sets','exams'],
   $q$SELECT count(*) AS count FROM public.study_sets child LEFT JOIN public.exams parent ON parent.id=child.exam_id WHERE child.exam_id IS NOT NULL AND (parent.id IS NULL OR parent.user_id<>child.user_id)$q$),
  ('flashcard study set ownership', ARRAY['flashcards','study_sets'],
   $q$SELECT count(*) AS count FROM public.flashcards child LEFT JOIN public.study_sets parent ON parent.id=child.study_set_id WHERE parent.id IS NULL OR parent.user_id<>child.user_id$q$),
  ('MCQ study set ownership', ARRAY['mcq_questions','study_sets'],
   $q$SELECT count(*) AS count FROM public.mcq_questions child LEFT JOIN public.study_sets parent ON parent.id=child.study_set_id WHERE parent.id IS NULL OR parent.user_id<>child.user_id$q$),
  ('study file study set ownership', ARRAY['study_set_files','study_sets'],
   $q$SELECT count(*) AS count FROM public.study_set_files child LEFT JOIN public.study_sets parent ON parent.id=child.study_set_id WHERE parent.id IS NULL OR parent.user_id<>child.user_id$q$),
  ('study file owner path', ARRAY['study_set_files'],
   $q$SELECT count(*) AS count FROM public.study_set_files WHERE split_part(storage_path,'/',1)<>user_id::text OR storage_path NOT LIKE user_id::text || '/%' OR storage_path ~ '(^|/)[.]{1,2}(/|$)' OR length(split_part(storage_path,'/',2))=0$q$),
  ('study task link array and ownership', ARRAY['study_sets','tasks'],
   $q$SELECT count(*) AS count FROM public.study_sets s WHERE jsonb_typeof(linked_task_ids) IS DISTINCT FROM 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s.linked_task_ids)='array' THEN s.linked_task_ids ELSE '[]'::jsonb END) item LEFT JOIN public.tasks t ON t.id::text=lower(item #>> '{}') WHERE jsonb_typeof(item)<>'string' OR (item #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR (t.id IS NOT NULL AND t.user_id<>s.user_id))$q$)
), availability AS (
  SELECT *, NOT EXISTS (SELECT 1 FROM unnest(required_tables) AS needed(table_name)
    WHERE to_regclass('public.' || needed.table_name) IS NULL) AS installed
  FROM checks
)
SELECT name, CASE WHEN installed THEN 'checked' ELSE 'not installed' END AS status,
  CASE WHEN installed THEN (xpath('/table/row/count/text()',query_to_xml(query,false,false,'')))[1]::text::bigint END AS invalid_count
FROM availability
ORDER BY name;

-- 8. Study bucket metadata/policies only. public=true is NOT acceptable for
-- private study materials. Signed URL expiration and actual Storage enforcement
-- still need separate two-user tests using fictional files.
SELECT CASE WHEN to_regclass('storage.buckets') IS NULL THEN 'Storage schema not installed'
  ELSE query_to_xml($q$SELECT id,public FROM storage.buckets WHERE id='study-materials'$q$,false,false,'')::text
  END AS study_bucket_metadata;
SELECT policyname,permissive,roles,cmd,qual,with_check
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
ORDER BY policyname;

ROLLBACK;
