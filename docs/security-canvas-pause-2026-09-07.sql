-- Production rollout prerequisite. Pauses ONLY Orderly's existing Canvas job.
-- Resume with the tested canvas-background-dispatch-migration.sql after the
-- concurrency/provider migrations and exact worker endpoints are installed.
-- If interrupted, restore this named job with cron.alter_job(jobid,active:=true).
BEGIN;
DO $pause$
DECLARE
  existing_job RECORD;
BEGIN
  FOR existing_job IN SELECT jobid FROM cron.job
    WHERE jobname='orderly-canvas-background-sync' AND active
  LOOP
    PERFORM cron.alter_job(existing_job.jobid, active := false);
  END LOOP;
END;
$pause$;
COMMIT;
