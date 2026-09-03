-- Normalize the recurrence contract required by the current task UI.
-- Safe to run repeatedly. Invalid non-null historic values fail preflight and
-- must be reviewed rather than silently rewritten.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS due_time TEXT,
  ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_days JSONB;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE recurrence IS NOT NULL
      AND recurrence NOT IN ('none', 'daily', 'weekly', 'monthly')
  ) THEN
    RAISE EXCEPTION
      'tasks recurrence preflight failed: unsupported recurrence values require manual review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE recurrence_days IS NOT NULL
      AND jsonb_typeof(recurrence_days) <> 'array'
  ) THEN
    RAISE EXCEPTION
      'tasks recurrence preflight failed: recurrence_days must be a JSON array or null';
  END IF;
END;
$preflight$;

UPDATE public.tasks SET recurrence = 'none' WHERE recurrence IS NULL;

ALTER TABLE public.tasks
  ALTER COLUMN recurrence SET DEFAULT 'none',
  ALTER COLUMN recurrence SET NOT NULL,
  DROP CONSTRAINT IF EXISTS tasks_recurrence_check,
  DROP CONSTRAINT IF EXISTS tasks_recurrence_days_array;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_recurrence_check
    CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  ADD CONSTRAINT tasks_recurrence_days_array
    CHECK (recurrence_days IS NULL OR jsonb_typeof(recurrence_days) = 'array');

COMMIT;
