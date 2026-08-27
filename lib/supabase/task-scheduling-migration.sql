-- Cross-device task scheduling metadata used by the local-first schedule store.
-- Apply this additive migration before deploying schedule persistence code.

BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS scheduled_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS schedule_recurrence_end_date DATE,
  ADD COLUMN IF NOT EXISTS schedule_occurrence_overrides JSONB NOT NULL DEFAULT '{}'::JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_scheduled_start_requires_date'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_scheduled_start_requires_date
      CHECK (scheduled_start_at IS NULL OR scheduled_date IS NOT NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_duration_seconds_valid'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_duration_seconds_valid
      CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 86400);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_schedule_overrides_object'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_schedule_overrides_object
      CHECK (jsonb_typeof(schedule_occurrence_overrides) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_scheduled_date
  ON public.tasks(user_id, scheduled_date)
  WHERE scheduled_date IS NOT NULL;

COMMENT ON COLUMN public.tasks.scheduled_date IS
  'Local work date used for the untimed shelf and as the wall-date of scheduled_start_at.';
COMMENT ON COLUMN public.tasks.scheduled_start_at IS
  'Exact optional work start; this is separate from the assignment deadline.';
COMMENT ON COLUMN public.tasks.duration_seconds IS
  'Optional expected work duration. End time is derived and never duplicated.';

COMMIT;
