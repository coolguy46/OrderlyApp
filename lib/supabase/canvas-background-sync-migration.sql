-- Persist Canvas scheduling preferences for browser and closed-site syncing.
-- Safe to run more than once.

BEGIN;

ALTER TABLE public.canvas_settings
ADD COLUMN IF NOT EXISTS auto_sync_interval INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'UTC';

UPDATE public.canvas_settings
SET auto_sync_interval = COALESCE(auto_sync_interval, 15),
    time_zone = COALESCE(NULLIF(BTRIM(time_zone), ''), 'UTC')
WHERE auto_sync_interval IS NULL
   OR time_zone IS NULL
   OR BTRIM(time_zone) = '';

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.canvas_settings
    WHERE auto_sync_interval NOT IN (5, 15, 30, 60)
  ) THEN
    RAISE EXCEPTION
      'Canvas background settings preflight failed: invalid intervals require manual review';
  END IF;
END;
$preflight$;

ALTER TABLE public.canvas_settings
  ALTER COLUMN auto_sync_interval SET DEFAULT 15,
  ALTER COLUMN auto_sync_interval SET NOT NULL,
  ALTER COLUMN time_zone SET DEFAULT 'UTC',
  ALTER COLUMN time_zone SET NOT NULL,
  DROP CONSTRAINT IF EXISTS canvas_settings_auto_sync_interval_check,
  DROP CONSTRAINT IF EXISTS canvas_settings_time_zone_nonempty;

ALTER TABLE public.canvas_settings
  ADD CONSTRAINT canvas_settings_auto_sync_interval_check
    CHECK (auto_sync_interval IN (5, 15, 30, 60)),
  ADD CONSTRAINT canvas_settings_time_zone_nonempty
    CHECK (BTRIM(time_zone) <> '');

COMMENT ON COLUMN public.canvas_settings.auto_sync_interval IS
  'Requested Canvas background-sync interval in minutes.';

COMMENT ON COLUMN public.canvas_settings.time_zone IS
  'IANA timezone used to place date-only Canvas assignments at 11:59 PM.';

COMMIT;
