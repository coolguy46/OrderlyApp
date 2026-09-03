-- Base Canvas integration normalization for an existing Orderly database.
-- Do not run this after a fresh schema bootstrap: schema.sql already contains
-- these objects. Safe to rerun only after every preflight below succeeds.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS external_id TEXT,
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS course_name TEXT,
  ADD COLUMN IF NOT EXISTS assignment_type TEXT;

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE source IS NOT NULL
      AND source NOT IN ('manual', 'google_classroom', 'canvas')
  ) THEN
    RAISE EXCEPTION
      'Canvas base preflight failed: unsupported tasks.source values require manual review';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tasks
    WHERE assignment_type IS NOT NULL
      AND assignment_type NOT IN (
        'assignment', 'exam', 'quiz', 'discussion', 'project', 'other'
      )
  ) THEN
    RAISE EXCEPTION
      'Canvas base preflight failed: unsupported assignment_type values require manual review';
  END IF;

  IF EXISTS (
    SELECT user_id, COALESCE(source, 'manual'), external_id
    FROM public.tasks
    WHERE external_id IS NOT NULL
    GROUP BY user_id, COALESCE(source, 'manual'), external_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Canvas base preflight failed: duplicate task external identities require backed-up manual review';
  END IF;
END;
$preflight$;

UPDATE public.tasks SET source = 'manual' WHERE source IS NULL;

ALTER TABLE public.tasks
  ALTER COLUMN source SET DEFAULT 'manual',
  ALTER COLUMN source SET NOT NULL,
  DROP CONSTRAINT IF EXISTS tasks_source_check,
  DROP CONSTRAINT IF EXISTS tasks_assignment_type_check,
  DROP CONSTRAINT IF EXISTS tasks_user_id_source_external_id_key;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_source_check
    CHECK (source IN ('manual', 'google_classroom', 'canvas')),
  ADD CONSTRAINT tasks_assignment_type_check
    CHECK (
      assignment_type IS NULL OR assignment_type IN (
        'assignment', 'exam', 'quiz', 'discussion', 'project', 'other'
      )
    ),
  ADD CONSTRAINT tasks_user_id_source_external_id_key
    UNIQUE (user_id, source, external_id);

CREATE TABLE IF NOT EXISTS public.canvas_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  ical_url TEXT NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_import_assignments BOOLEAN NOT NULL DEFAULT true,
  auto_sync_interval INTEGER NOT NULL DEFAULT 15,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.canvas_settings
  ADD COLUMN IF NOT EXISTS auto_sync_interval INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT 'UTC';

DO $settings_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.canvas_settings
    WHERE auto_sync_interval NOT IN (5, 15, 30, 60)
       OR BTRIM(time_zone) = ''
  ) THEN
    RAISE EXCEPTION
      'Canvas settings preflight failed: invalid interval/timezone values require manual review';
  END IF;
END;
$settings_preflight$;

ALTER TABLE public.canvas_settings
  DROP CONSTRAINT IF EXISTS canvas_settings_auto_sync_interval_check,
  DROP CONSTRAINT IF EXISTS canvas_settings_time_zone_nonempty;

ALTER TABLE public.canvas_settings
  ADD CONSTRAINT canvas_settings_auto_sync_interval_check
    CHECK (auto_sync_interval IN (5, 15, 30, 60)),
  ADD CONSTRAINT canvas_settings_time_zone_nonempty
    CHECK (BTRIM(time_zone) <> '');

ALTER TABLE public.canvas_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own Canvas settings"
  ON public.canvas_settings;
CREATE POLICY "Users can manage their own Canvas settings"
  ON public.canvas_settings
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS update_canvas_settings_updated_at
  ON public.canvas_settings;
CREATE TRIGGER update_canvas_settings_updated_at
  BEFORE UPDATE ON public.canvas_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_tasks_external_id
  ON public.tasks(external_id);
CREATE INDEX IF NOT EXISTS idx_tasks_source
  ON public.tasks(source);
CREATE INDEX IF NOT EXISTS idx_canvas_settings_user_id
  ON public.canvas_settings(user_id);

COMMENT ON TABLE public.canvas_settings IS
  'Stores Canvas LMS integration settings for users.';
COMMENT ON COLUMN public.tasks.source IS
  'Source of the task: manual, legacy Google Classroom, or Canvas.';
COMMENT ON COLUMN public.tasks.external_id IS
  'Stable identifier from an external source.';
COMMENT ON COLUMN public.tasks.external_url IS
  'Link to the assignment in its external source.';
COMMENT ON COLUMN public.tasks.course_name IS
  'External course/class name.';
COMMENT ON COLUMN public.tasks.assignment_type IS
  'assignment, exam, quiz, discussion, project, other, or null.';

COMMIT;
