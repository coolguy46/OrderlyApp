-- Bound authenticated Canvas provider requests across serverless instances and
-- persist the course count from the last complete feed snapshot.
--
-- Apply after canvas-sync-concurrency-migration.sql while Canvas manual and
-- scheduled sync are paused. Safe to run more than once after a failed deploy.

BEGIN;

ALTER TABLE public.canvas_settings
ADD COLUMN IF NOT EXISTS course_count INTEGER NOT NULL DEFAULT 0;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.canvas_settings WHERE course_count < 0
  ) THEN
    RAISE EXCEPTION
      'Canvas provider throttle preflight failed: negative course_count values require manual review';
  END IF;
END;
$preflight$;

ALTER TABLE public.canvas_settings
DROP CONSTRAINT IF EXISTS canvas_settings_course_count_nonnegative;

ALTER TABLE public.canvas_settings
ADD CONSTRAINT canvas_settings_course_count_nonnegative
CHECK (course_count >= 0);

COMMENT ON COLUMN public.canvas_settings.course_count IS
  'Server-managed distinct course count from the last successful complete Canvas snapshot.';

CREATE TABLE IF NOT EXISTS public.canvas_provider_request_limits (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  validation_last_started_at TIMESTAMP WITH TIME ZONE,
  validation_claim_token UUID,
  validation_claim_expires_at TIMESTAMP WITH TIME ZONE,
  manual_sync_last_started_at TIMESTAMP WITH TIME ZONE,
  manual_sync_claim_token UUID,
  manual_sync_claim_expires_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE public.canvas_provider_request_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.canvas_provider_request_limits FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.canvas_provider_request_limits IS
  'Server-managed per-account cooldown and crash-recoverable in-flight guards for outbound Canvas requests.';

-- Browser writes may update connection preferences, but successful snapshot
-- metadata and lease state are server-owned. Keep connection identity stable
-- while an import owns the row.
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
      OR NEW.course_count <> 0
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
    OR NEW.course_count IS DISTINCT FROM OLD.course_count
  ) THEN
    RAISE EXCEPTION 'Canvas sync state is server-managed' USING ERRCODE = '42501';
  END IF;

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

-- This authenticated RPC atomically claims one provider request or reports a
-- bounded retry delay. The expiring token survives serverless process death;
-- the last-start timestamp keeps a completed request inside its cooldown.
CREATE OR REPLACE FUNCTION public.claim_canvas_provider_request(
  requested_kind TEXT
)
RETURNS TABLE(claim_token UUID, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id UUID := auth.uid();
  granted_token UUID;
  available_at TIMESTAMP WITH TIME ZONE;
  claim_time TIMESTAMP WITH TIME ZONE := statement_timestamp();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF requested_kind NOT IN ('validate', 'manual_sync') THEN
    RAISE EXCEPTION 'Invalid Canvas provider request kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.canvas_provider_request_limits(user_id)
  VALUES (actor_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF requested_kind = 'validate' THEN
    UPDATE public.canvas_provider_request_limits AS limits
    SET
      validation_last_started_at = claim_time,
      validation_claim_token = gen_random_uuid(),
      validation_claim_expires_at = claim_time + interval '30 seconds'
    WHERE limits.user_id = actor_id
      AND (
        limits.validation_claim_token IS NULL
        OR limits.validation_claim_expires_at IS NULL
        OR limits.validation_claim_expires_at <= claim_time
      )
      AND (
        limits.validation_last_started_at IS NULL
        OR limits.validation_last_started_at <= claim_time - interval '30 seconds'
      )
    RETURNING limits.validation_claim_token INTO granted_token;

    IF granted_token IS NOT NULL THEN
      RETURN QUERY SELECT granted_token, 0;
      RETURN;
    END IF;

    SELECT GREATEST(
      COALESCE(limits.validation_last_started_at + interval '30 seconds', claim_time),
      CASE
        WHEN limits.validation_claim_token IS NOT NULL
          AND limits.validation_claim_expires_at > claim_time
        THEN limits.validation_claim_expires_at
        ELSE claim_time
      END
    )
    INTO available_at
    FROM public.canvas_provider_request_limits AS limits
    WHERE limits.user_id = actor_id;
  ELSE
    UPDATE public.canvas_provider_request_limits AS limits
    SET
      manual_sync_last_started_at = claim_time,
      manual_sync_claim_token = gen_random_uuid(),
      manual_sync_claim_expires_at = claim_time + interval '2 minutes'
    WHERE limits.user_id = actor_id
      AND (
        limits.manual_sync_claim_token IS NULL
        OR limits.manual_sync_claim_expires_at IS NULL
        OR limits.manual_sync_claim_expires_at <= claim_time
      )
      AND (
        limits.manual_sync_last_started_at IS NULL
        OR limits.manual_sync_last_started_at <= claim_time - interval '60 seconds'
      )
    RETURNING limits.manual_sync_claim_token INTO granted_token;

    IF granted_token IS NOT NULL THEN
      RETURN QUERY SELECT granted_token, 0;
      RETURN;
    END IF;

    SELECT GREATEST(
      COALESCE(limits.manual_sync_last_started_at + interval '60 seconds', claim_time),
      CASE
        WHEN limits.manual_sync_claim_token IS NOT NULL
          AND limits.manual_sync_claim_expires_at > claim_time
        THEN limits.manual_sync_claim_expires_at
        ELSE claim_time
      END
    )
    INTO available_at
    FROM public.canvas_provider_request_limits AS limits
    WHERE limits.user_id = actor_id;
  END IF;

  RETURN QUERY SELECT
    NULL::UUID,
    GREATEST(
      1,
      CEIL(EXTRACT(EPOCH FROM (COALESCE(available_at, claim_time + interval '1 second') - claim_time)))::INTEGER
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_canvas_provider_request(
  requested_kind TEXT,
  expected_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF requested_kind NOT IN ('validate', 'manual_sync') THEN
    RAISE EXCEPTION 'Invalid Canvas provider request kind' USING ERRCODE = '22023';
  END IF;

  IF requested_kind = 'validate' THEN
    UPDATE public.canvas_provider_request_limits AS limits
    SET validation_claim_token = NULL, validation_claim_expires_at = NULL
    WHERE limits.user_id = actor_id
      AND limits.validation_claim_token = expected_claim_token;
  ELSE
    UPDATE public.canvas_provider_request_limits AS limits
    SET manual_sync_claim_token = NULL, manual_sync_claim_expires_at = NULL
    WHERE limits.user_id = actor_id
      AND limits.manual_sync_claim_token = expected_claim_token;
  END IF;

  RETURN FOUND;
END;
$function$;

-- Completion and course-count persistence are one fenced update. A stale
-- serverless invocation cannot publish metadata after its lease is replaced.
DROP FUNCTION IF EXISTS public.complete_canvas_sync(
  UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE
);

CREATE OR REPLACE FUNCTION public.complete_canvas_sync(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT,
  requested_mode TEXT,
  completed_sync_at TIMESTAMP WITH TIME ZONE,
  completed_course_count INTEGER
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
  IF completed_course_count IS NOT NULL AND completed_course_count < 0 THEN
    RAISE EXCEPTION 'Invalid Canvas course count' USING ERRCODE = '22023';
  END IF;

  UPDATE public.canvas_settings AS settings
  SET
    last_sync_at = completed_sync_at,
    last_background_sync_at = CASE
      WHEN requested_mode = 'background' THEN completed_sync_at
      ELSE settings.last_background_sync_at
    END,
    course_count = CASE
      WHEN completed_course_count IS NULL THEN settings.course_count
      ELSE completed_course_count
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

REVOKE ALL ON FUNCTION public.claim_canvas_provider_request(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_canvas_provider_request(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_canvas_sync(
  UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_canvas_provider_request(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_canvas_provider_request(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_canvas_sync(
  UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
