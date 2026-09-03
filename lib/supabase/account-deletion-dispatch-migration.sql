-- Install the account-deletion worker scheduler only after the application
-- worker endpoint is deployed. Reuses the Canvas cron bearer secret but has a
-- separate, exact endpoint URL in Vault. Safe to run more than once.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.dispatch_account_deletions()
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, vault, net
AS $function$
DECLARE
  cron_secret TEXT;
  endpoint_url TEXT;
  request_id BIGINT;
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
  WHERE name = 'account_deletion_endpoint_url'
  ORDER BY created_at DESC
  LIMIT 1;

  IF endpoint_url IS NULL OR endpoint_url = '' THEN
    RAISE EXCEPTION 'Vault secret account_deletion_endpoint_url is missing';
  END IF;

  IF endpoint_url !~ '^https://[^/?#]+/api/account/deletion/process$' THEN
    RAISE EXCEPTION
      'Vault secret account_deletion_endpoint_url must be an exact HTTPS /api/account/deletion/process URL';
  END IF;

  SELECT net.http_post(
    url := endpoint_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  INTO request_id;

  RETURN request_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_account_deletions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_account_deletions() TO postgres;

DO $schedule$
DECLARE
  existing_job_id BIGINT;
BEGIN
  FOR existing_job_id IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'orderly-account-deletion-worker'
  LOOP
    PERFORM cron.unschedule(existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'orderly-account-deletion-worker',
    '*/5 * * * *',
    $command$SELECT public.dispatch_account_deletions();$command$
  );
END;
$schedule$;

COMMIT;
