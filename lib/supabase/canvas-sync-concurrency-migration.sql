-- Serialize Canvas imports per account and fence stale invocations.
--
-- Apply after canvas-sync-reliability-migration.sql and before the dispatch
-- migration that activates pg_cron. Safe to run more than once. The application intentionally refuses to mutate Canvas data until
-- these RPCs are installed; do not deploy the application change without this
-- migration.

BEGIN;

ALTER TABLE public.canvas_settings
ADD COLUMN IF NOT EXISTS last_background_attempt_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sync_lease_token UUID,
ADD COLUMN IF NOT EXISTS sync_lease_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS sync_revision BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.canvas_settings.sync_lease_token IS
  'Opaque owner token for the one active Canvas import allowed per account.';

COMMENT ON COLUMN public.canvas_settings.sync_lease_expires_at IS
  'Crash-recovery deadline for the active Canvas import lease.';

COMMENT ON COLUMN public.canvas_settings.sync_revision IS
  'Monotonic fencing revision incremented for every acquired Canvas import lease.';

-- A browser user owns their settings row through RLS, but lease/revision
-- columns are server-owned. Reject attempts to forge them through the public
-- data API. SECURITY DEFINER lease RPCs execute without an auth.uid().
CREATE OR REPLACE FUNCTION public.protect_canvas_sync_internal_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF auth.uid() IS NOT NULL
       AND OLD.sync_lease_token IS NOT NULL
       AND OLD.sync_lease_expires_at > statement_timestamp() THEN
      RAISE EXCEPTION 'Canvas settings are temporarily locked by an active sync'
        USING ERRCODE = '55P03';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND (
      NEW.sync_lease_token IS NOT NULL
      OR NEW.sync_lease_expires_at IS NOT NULL
      OR NEW.sync_revision <> 0
      OR NEW.last_sync_at IS NOT NULL
      OR NEW.last_background_sync_at IS NOT NULL
      OR NEW.last_background_attempt_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Canvas sync state is server-managed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.sync_lease_token IS DISTINCT FROM OLD.sync_lease_token
    OR NEW.sync_lease_expires_at IS DISTINCT FROM OLD.sync_lease_expires_at
    OR NEW.sync_revision IS DISTINCT FROM OLD.sync_revision
    OR NEW.last_sync_at IS DISTINCT FROM OLD.last_sync_at
    OR NEW.last_background_sync_at IS DISTINCT FROM OLD.last_background_sync_at
    OR NEW.last_background_attempt_at IS DISTINCT FROM OLD.last_background_attempt_at
  ) THEN
    RAISE EXCEPTION 'Canvas sync state is server-managed' USING ERRCODE = '42501';
  END IF;

  -- Keep the feed and its timezone stable while an import owns the row. This
  -- prevents a snapshot fetched from an old connection from being committed
  -- after the user replaces or disconnects that connection.
  IF OLD.sync_lease_token IS NOT NULL
     AND OLD.sync_lease_expires_at > statement_timestamp()
     AND (
       NEW.ical_url IS DISTINCT FROM OLD.ical_url
       OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
       OR NEW.sync_enabled IS DISTINCT FROM OLD.sync_enabled
     ) THEN
    RAISE EXCEPTION 'Canvas settings are temporarily locked by an active sync'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS protect_canvas_sync_internal_state
ON public.canvas_settings;

CREATE TRIGGER protect_canvas_sync_internal_state
BEFORE INSERT OR UPDATE OR DELETE ON public.canvas_settings
FOR EACH ROW EXECUTE FUNCTION public.protect_canvas_sync_internal_state();

-- The two-minute lease is twice the route's one-minute function budget. A
-- terminated invocation therefore cannot overlap its successor, while the
-- next five-minute scheduler boundary can always recover the account.
CREATE OR REPLACE FUNCTION public.claim_canvas_sync(
  target_user_id UUID
)
RETURNS TABLE(lease_token UUID, sync_revision BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.canvas_settings AS settings
  SET
    sync_lease_token = gen_random_uuid(),
    sync_lease_expires_at = statement_timestamp() + interval '2 minutes',
    sync_revision = settings.sync_revision + 1
  WHERE settings.user_id = target_user_id
    AND settings.ical_url IS NOT NULL
    AND (
      settings.sync_lease_token IS NULL
      OR settings.sync_lease_expires_at IS NULL
      OR settings.sync_lease_expires_at <= statement_timestamp()
    )
  RETURNING settings.sync_lease_token, settings.sync_revision;
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_canvas_sync_lease(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.canvas_settings AS settings
  SET sync_lease_expires_at = statement_timestamp() + interval '2 minutes'
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision
    AND settings.sync_lease_expires_at > statement_timestamp();

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_canvas_sync(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT,
  requested_mode TEXT,
  completed_sync_at TIMESTAMP WITH TIME ZONE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF requested_mode NOT IN ('manual', 'background') THEN
    RAISE EXCEPTION 'Invalid Canvas sync mode' USING ERRCODE = '22023';
  END IF;

  UPDATE public.canvas_settings AS settings
  SET
    last_sync_at = completed_sync_at,
    last_background_sync_at = CASE
      WHEN requested_mode = 'background' THEN completed_sync_at
      ELSE settings.last_background_sync_at
    END,
    sync_lease_token = NULL,
    sync_lease_expires_at = NULL
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision
    AND settings.sync_lease_expires_at > statement_timestamp();

  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_canvas_sync_lease(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  UPDATE public.canvas_settings AS settings
  SET
    sync_lease_token = NULL,
    sync_lease_expires_at = NULL
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.protect_canvas_sync_internal_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_canvas_sync(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_canvas_sync_lease(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_canvas_sync(UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_canvas_sync_lease(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_canvas_sync(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_canvas_sync_lease(UUID, UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_canvas_sync(UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_canvas_sync_lease(UUID, UUID, BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
