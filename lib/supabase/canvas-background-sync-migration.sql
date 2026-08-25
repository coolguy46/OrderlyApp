-- Persist Canvas scheduling preferences for browser and closed-site syncing.
-- Safe to run more than once.

ALTER TABLE canvas_settings
ADD COLUMN IF NOT EXISTS auto_sync_interval INTEGER NOT NULL DEFAULT 15,
ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'UTC';

ALTER TABLE canvas_settings
DROP CONSTRAINT IF EXISTS canvas_settings_auto_sync_interval_check;

ALTER TABLE canvas_settings
ADD CONSTRAINT canvas_settings_auto_sync_interval_check
CHECK (auto_sync_interval IN (5, 15, 30, 60));

COMMENT ON COLUMN canvas_settings.auto_sync_interval IS
  'Requested Canvas background-sync interval in minutes.';

COMMENT ON COLUMN canvas_settings.time_zone IS
  'IANA timezone used to place date-only Canvas assignments at 11:59 PM.';
