-- Fan out Canvas background syncs into one serverless invocation per due user.
-- This prevents a slow or broken Canvas feed from consuming another user's
-- function budget. This claims dispatch delivery only; the application-wide
-- manual/background mutation lease must already be installed by
-- canvas-sync-concurrency-migration.sql. Apply this migration last because it
-- immediately activates the five-minute cron. Safe to run more than once in the
-- production Supabase SQL editor after both the `canvas_sync_cron_secret` and
-- `canvas_sync_endpoint_url` Vault secrets have been created. The endpoint
-- secret must be the complete, redirect-free HTTPS URL ending exactly in
-- `/api/canvas/background-sync` for the environment being deployed.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.canvas_settings
ADD COLUMN IF NOT EXISTS last_background_attempt_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.canvas_settings.last_background_attempt_at IS
  'Last scheduler dispatch attempt; prevents duplicate work and permits five-minute failure retries.';

CREATE INDEX IF NOT EXISTS idx_canvas_settings_background_dispatch
ON public.canvas_settings(last_background_sync_at, last_background_attempt_at)
WHERE sync_enabled = true AND ical_url IS NOT NULL;

CREATE OR REPLACE FUNCTION public.dispatch_due_canvas_syncs()
RETURNS TABLE(canvas_user_id UUID, request_id BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $function$
DECLARE
  cron_secret TEXT;
  endpoint_url TEXT;
BEGIN
  SELECT decrypted_secret
  INTO cron_secret
  FROM vault.decrypted_secrets
  WHERE name = 'canvas_sync_cron_secret'
  ORDER BY created_at DESC
  LIMIT 1;

  IF cron_secret IS NULL OR length(cron_secret) = 0 THEN
    RAISE EXCEPTION 'Vault secret canvas_sync_cron_secret is missing';
  END IF;

  SELECT BTRIM(decrypted_secret)
  INTO endpoint_url
  FROM vault.decrypted_secrets
  WHERE name = 'canvas_sync_endpoint_url'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Do not silently dispatch a staging database to production (or leak the
  -- bearer secret through an HTTP redirect). Configuration is deliberately
  -- fail-closed and accepts only a complete HTTPS origin plus the exact route.
  IF endpoint_url IS NULL OR endpoint_url = '' THEN
    RAISE EXCEPTION 'Vault secret canvas_sync_endpoint_url is missing';
  END IF;

  IF endpoint_url !~ '^https://[^/?#]+/api/canvas/background-sync$' THEN
    RAISE EXCEPTION
      'Vault secret canvas_sync_endpoint_url must be an exact HTTPS /api/canvas/background-sync URL';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT settings.user_id
    FROM public.canvas_settings AS settings
    WHERE settings.sync_enabled = true
      AND settings.ical_url IS NOT NULL
      -- Success determines the user's 5/15/30/60-minute cadence. The
      -- one-minute allowance compensates for completion just after a cron
      -- boundary, matching the application scheduler's tolerance.
      AND (
        settings.last_background_sync_at IS NULL
        OR settings.last_background_sync_at
          <= statement_timestamp()
            - make_interval(mins => CASE
                WHEN settings.auto_sync_interval IN (5, 15, 30, 60)
                  THEN settings.auto_sync_interval
                ELSE 15
              END)
            + interval '1 minute'
      )
      -- An unsuccessful request retries on the next five-minute boundary, but
      -- a duplicate cron execution cannot claim the same row immediately.
      AND (
        settings.last_background_attempt_at IS NULL
        OR settings.last_background_attempt_at
          <= statement_timestamp() - interval '4 minutes'
      )
    ORDER BY settings.last_background_attempt_at NULLS FIRST,
             settings.last_background_sync_at NULLS FIRST,
             settings.user_id
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.canvas_settings AS settings
    SET last_background_attempt_at = statement_timestamp()
    FROM due
    WHERE settings.user_id = due.user_id
    RETURNING settings.user_id
  )
  SELECT claimed.user_id,
         net.http_post(
           url := endpoint_url,
           headers := jsonb_build_object(
             'Authorization', 'Bearer ' || cron_secret,
             'Content-Type', 'application/json'
           ),
           body := jsonb_build_object('userId', claimed.user_id),
           timeout_milliseconds := 60000
         )
  FROM claimed;
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_due_canvas_syncs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dispatch_due_canvas_syncs() TO postgres;

DO $schedule$
DECLARE
  existing_job_id BIGINT;
BEGIN
  FOR existing_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'orderly-canvas-background-sync'
  LOOP
    PERFORM cron.unschedule(existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'orderly-canvas-background-sync',
    '*/5 * * * *',
    $command$SELECT public.dispatch_due_canvas_syncs();$command$
  );
END;
$schedule$;

COMMIT;
