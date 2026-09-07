-- Security boundary hardening. Apply AFTER the current bootstrap/incremental
-- schema, planner, relationship-ownership, and assistant migrations.
-- Optional legacy study tables are hardened only when already installed.
--
-- No records are rewritten or removed. A preflight aborts the whole transaction
-- if an existing relationship violates ownership. Review those records with a
-- backed-up, explicitly approved repair before retrying. Run with the schema
-- owner's role. A Git push does not apply this production migration.
BEGIN;

-- Application clients do not need to create tables/functions. This also makes
-- public a trusted schema for older functions with unqualified object names.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- Older dispatcher migrations revoked only PUBLIC. Remove direct default
-- client grants too, without scheduling any jobs or changing Vault secrets.
DO $dispatch_permissions$
BEGIN
  IF to_regprocedure('public.dispatch_due_canvas_syncs()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.dispatch_due_canvas_syncs() FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('public.dispatch_account_deletions()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.dispatch_account_deletions() FROM PUBLIC, anon, authenticated;
  END IF;
END;
$dispatch_permissions$;

-- Pin pg_catalog first and pg_temp explicitly last for our own privileged
-- functions. Do not alter extension/provider functions in the public schema.
DO $paths$
DECLARE
  routine RECORD;
BEGIN
  FOR routine IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY(ARRAY[
        'handle_new_user', 'search_profiles_for_friendship',
        'get_friendships_with_profiles', 'adjust_completed_task_count',
        'adjust_total_study_time', 'enforce_owned_subject_reference',
        'enforce_owned_task_reference', 'enforce_owned_exam_reference',
        'claim_account_deletion_requests', 'dispatch_account_deletions',
        'dispatch_due_canvas_syncs', 'claim_canvas_sync',
        'renew_canvas_sync_lease', 'complete_canvas_sync',
        'release_canvas_sync_lease', 'claim_canvas_provider_request',
        'release_canvas_provider_request', 'assistant_reserve_ai_request',
        'assistant_complete_ai_request', 'assistant_fail_ai_request'
      ])
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public, pg_temp', routine.signature);
  END LOOP;
END;
$paths$;

-- A child row's RLS is not enough: a caller may own the child but supply the
-- ID of somebody else's parent. Cover relationships omitted by older optional
-- feature migrations, in addition to the core subject/task/exam guards.
DO $preflight$
DECLARE
  reference RECORD;
  invalid BOOLEAN;
BEGIN
  FOR reference IN SELECT * FROM (VALUES
    ('planner_blocks', 'commitment_id', 'recurring_commitments'),
    ('study_sets', 'exam_id', 'exams'),
    ('flashcards', 'study_set_id', 'study_sets'),
    ('mcq_questions', 'study_set_id', 'study_sets'),
    ('study_set_files', 'study_set_id', 'study_sets')
  ) AS refs(child_table, column_name, parent_table)
  LOOP
    IF to_regclass('public.' || reference.child_table) IS NULL THEN CONTINUE; END IF;
    IF to_regclass('public.' || reference.parent_table) IS NULL THEN
      RAISE EXCEPTION 'Security preflight: required parent table missing for %', reference.child_table;
    END IF;
    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM public.%I child LEFT JOIN public.%I parent ON parent.id=child.%I
       WHERE child.%I IS NOT NULL AND (parent.id IS NULL OR parent.user_id<>child.user_id))',
      reference.child_table, reference.parent_table, reference.column_name, reference.column_name
    ) INTO invalid;
    IF invalid THEN
      RAISE EXCEPTION 'Security preflight: review invalid ownership in %.% before applying; no data was changed',
        reference.child_table, reference.column_name;
    END IF;
  END LOOP;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.enforce_owned_optional_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  reference_id UUID := (to_jsonb(NEW)->>TG_ARGV[0])::UUID;
  reference_owned BOOLEAN;
BEGIN
  IF reference_id IS NULL THEN RETURN NEW; END IF;
  -- Identifiers come only from migration-defined trigger arguments; the
  -- referenced ID and owner are bound values, not interpolated user content.
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id=$1 AND user_id=$2)', TG_ARGV[1])
    INTO reference_owned USING reference_id, NEW.user_id;
  IF NOT reference_owned THEN
    RAISE EXCEPTION 'Referenced record must belong to the row owner' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_owned_optional_reference() FROM PUBLIC, anon, authenticated;

DO $triggers$
DECLARE
  reference RECORD;
BEGIN
  FOR reference IN SELECT * FROM (VALUES
    ('planner_blocks', 'commitment_id', 'recurring_commitments'),
    ('study_sets', 'exam_id', 'exams'),
    ('flashcards', 'study_set_id', 'study_sets'),
    ('mcq_questions', 'study_set_id', 'study_sets'),
    ('study_set_files', 'study_set_id', 'study_sets')
  ) AS refs(child_table, column_name, parent_table)
  LOOP
    IF to_regclass('public.' || reference.child_table) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS security_owned_parent ON public.%I', reference.child_table);
    EXECUTE format('CREATE TRIGGER security_owned_parent BEFORE INSERT OR UPDATE OF user_id, %I ON public.%I
      FOR EACH ROW EXECUTE FUNCTION public.enforce_owned_optional_reference(%L,%L)',
      reference.column_name, reference.child_table, reference.column_name, reference.parent_table);
  END LOOP;
END;
$triggers$;

CREATE OR REPLACE FUNCTION public.enforce_study_set_link_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  linked_id JSONB;
  linked_uuid UUID;
BEGIN
  IF jsonb_typeof(NEW.linked_task_ids) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Task links must be an array' USING ERRCODE = '23503';
  END IF;
  FOR linked_id IN SELECT value FROM jsonb_array_elements(NEW.linked_task_ids) LOOP
    IF jsonb_typeof(linked_id) <> 'string' THEN
      RAISE EXCEPTION 'Invalid task link' USING ERRCODE = '23503';
    END IF;
    BEGIN
      linked_uuid := (linked_id #>> '{}')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid task link' USING ERRCODE = '23503';
    END;
    -- JSON links can outlive a deleted task (unlike foreign-key references).
    -- Retain those harmless historical IDs, but never link another owner.
    IF EXISTS (SELECT 1 FROM public.tasks WHERE id=linked_uuid AND user_id<>NEW.user_id) THEN
      RAISE EXCEPTION 'Task links must belong to the row owner' USING ERRCODE = '23503';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_study_set_link_ownership() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_study_file_path_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF split_part(NEW.storage_path, '/', 1) <> NEW.user_id::TEXT
    OR NEW.storage_path NOT LIKE NEW.user_id::TEXT || '/%'
    OR NEW.storage_path ~ '(^|/)[.]{1,2}(/|$)'
    OR length(split_part(NEW.storage_path, '/', 2)) = 0 THEN
    RAISE EXCEPTION 'File path must belong to the row owner' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_study_file_path_ownership() FROM PUBLIC, anon, authenticated;

DO $legacy$
DECLARE
  invalid BOOLEAN;
BEGIN
  IF to_regclass('public.study_sets') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.study_sets WHERE jsonb_typeof(linked_task_ids) IS DISTINCT FROM 'array') THEN
      RAISE EXCEPTION 'Security preflight: review invalid study task links; no data was changed';
    END IF;
    -- Compare as text for preflight, then separately validate UUID syntax.
    SELECT EXISTS (
      SELECT 1 FROM public.study_sets s CROSS JOIN LATERAL jsonb_array_elements(s.linked_task_ids) item
      LEFT JOIN public.tasks t ON t.id::TEXT = lower(item #>> '{}')
      WHERE jsonb_typeof(item) <> 'string'
        OR (item #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR (t.id IS NOT NULL AND t.user_id <> s.user_id)
    ) INTO invalid;
    IF invalid THEN
      RAISE EXCEPTION 'Security preflight: review invalid study task links; no data was changed';
    END IF;
    DROP TRIGGER IF EXISTS security_owned_task_links ON public.study_sets;
    CREATE TRIGGER security_owned_task_links BEFORE INSERT OR UPDATE OF user_id, linked_task_ids ON public.study_sets
      FOR EACH ROW EXECUTE FUNCTION public.enforce_study_set_link_ownership();
  END IF;

  IF to_regclass('public.study_set_files') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.study_set_files WHERE
      split_part(storage_path,'/',1) <> user_id::TEXT
      OR storage_path NOT LIKE user_id::TEXT || '/%'
      OR storage_path ~ '(^|/)[.]{1,2}(/|$)'
      OR length(split_part(storage_path,'/',2)) = 0) THEN
      RAISE EXCEPTION 'Security preflight: review invalid study file paths; no data was changed';
    END IF;
    DROP TRIGGER IF EXISTS security_owned_file_path ON public.study_set_files;
    CREATE TRIGGER security_owned_file_path BEFORE INSERT OR UPDATE OF user_id, storage_path ON public.study_set_files
      FOR EACH ROW EXECUTE FUNCTION public.enforce_study_file_path_ownership();
  END IF;
END;
$legacy$;

-- Trigger routines are not public RPC endpoints. Revoking invocation does not
-- prevent already-installed triggers from executing their functions.
DO $trigger_privileges$
DECLARE
  routine RECORD;
BEGIN
  FOR routine IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prorettype='pg_catalog.trigger'::regtype
      AND p.proname=ANY(ARRAY['handle_new_user','update_updated_at_column',
        'handle_updated_at','planner_touch_updated_at','enforce_friendship_update_invariants',
        'protect_profile_managed_fields','adjust_completed_task_count','adjust_total_study_time',
        'enforce_owned_subject_reference','enforce_owned_task_reference','enforce_owned_exam_reference',
        'protect_canvas_sync_internal_state'])
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', routine.signature);
  END LOOP;
END;
$trigger_privileges$;

NOTIFY pgrst, 'reload schema';
COMMIT;
