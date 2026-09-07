-- OPERATIONAL CONFIGURATION: Orderly production only.
-- Verified project: xsisgvqsvsbpvvvzucqx; public origin: www.myorderlyapp.com.
-- Creates missing NON-CREDENTIAL endpoint settings; does not read out, copy,
-- replace, or rotate the existing Canvas cron bearer secret.
-- Abort if an endpoint already points elsewhere. Do not force-overwrite it.
BEGIN;
DO $configure$
DECLARE
  endpoint RECORD;
BEGIN
  IF (SELECT count(*) FROM vault.secrets WHERE name='canvas_sync_cron_secret') <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one existing Canvas cron secret; review configuration';
  END IF;
  FOR endpoint IN SELECT * FROM (VALUES
    ('canvas_sync_endpoint_url','https://www.myorderlyapp.com/api/canvas/background-sync'),
    ('account_deletion_endpoint_url','https://www.myorderlyapp.com/api/account/deletion/process')
  ) AS endpoints(name,url)
  LOOP
    IF EXISTS (SELECT 1 FROM vault.decrypted_secrets s WHERE s.name=endpoint.name
      AND BTRIM(s.decrypted_secret) IS DISTINCT FROM endpoint.url) THEN
      RAISE EXCEPTION 'Worker endpoint differs from the approved production origin; no changes applied';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault.secrets s WHERE s.name=endpoint.name) THEN
      PERFORM vault.create_secret(endpoint.url,endpoint.name,'Orderly production worker endpoint; not a credential');
    END IF;
  END LOOP;
END;
$configure$;
COMMIT;
