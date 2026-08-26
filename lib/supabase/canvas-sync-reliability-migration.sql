-- Durable Canvas identities for exams and a one-time browser interval migration.
-- Safe to run more than once.

BEGIN;

ALTER TABLE public.exams
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS external_id TEXT;

ALTER TABLE public.exams
ALTER COLUMN source SET DEFAULT 'manual';

UPDATE public.exams
SET source = 'manual'
WHERE source IS NULL;

ALTER TABLE public.exams
ALTER COLUMN source SET NOT NULL;

ALTER TABLE public.exams
DROP CONSTRAINT IF EXISTS exams_source_check;

ALTER TABLE public.exams
ADD CONSTRAINT exams_source_check
CHECK (source IN ('manual', 'google_classroom', 'canvas'));

ALTER TABLE public.exams
DROP CONSTRAINT IF EXISTS exams_user_id_source_external_id_key;

-- Older importers wrote the stable integration identity to tasks, but created
-- the corresponding exam as a legacy/manual row. Recover that identity only
-- when the old importer left an exact, one-to-one fingerprint:
--   * same user, prefixed title, due instant, description, and subject
--   * the external task still satisfies the old exam/quiz detector
--   * exactly one external task candidate for the legacy exam
--   * exactly one legacy exam candidate for the external task
-- An already-owned exam with the identity also disqualifies the pair. This is
-- intentionally conservative: ambiguous or user-created rows remain manual.
WITH legacy_exam_task_candidates AS (
  SELECT
    exam.id AS exam_id,
    task.id AS task_id,
    task.user_id,
    task.source,
    task.external_id,
    COUNT(*) OVER (PARTITION BY exam.id) AS task_candidates_for_exam,
    COUNT(*) OVER (PARTITION BY task.id) AS exam_candidates_for_task,
    COUNT(*) OVER (
      PARTITION BY task.user_id, task.source, task.external_id
    ) AS candidates_for_external_identity
  FROM public.exams AS exam
  JOIN public.tasks AS task
    ON task.user_id = exam.user_id
   AND task.title = exam.title
   AND task.due_date = exam.exam_date
   AND task.description IS NOT DISTINCT FROM exam.description
   AND task.subject_id IS NOT DISTINCT FROM exam.subject_id
  WHERE exam.source = 'manual'
    AND exam.external_id IS NULL
    AND task.source IN ('canvas', 'google_classroom')
    AND task.external_id IS NOT NULL
    AND BTRIM(task.external_id) <> ''
    AND (
      (task.source = 'canvas' AND task.title LIKE '[Canvas] %')
      OR
      (task.source = 'google_classroom' AND task.title LIKE '[Classroom] %')
    )
    AND (
      task.assignment_type IN ('exam', 'quiz')
      OR LOWER(task.title) LIKE '%exam%'
      OR LOWER(task.title) LIKE '%test%'
      OR LOWER(task.title) LIKE '%quiz%'
      OR LOWER(task.title) LIKE '%midterm%'
      OR LOWER(task.title) LIKE '%final%'
      OR LOWER(task.title) LIKE '%assessment%'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.exams AS owned_exam
      WHERE owned_exam.user_id = task.user_id
        AND owned_exam.source = task.source
        AND owned_exam.external_id = task.external_id
    )
),
safe_legacy_exam_task_matches AS (
  SELECT exam_id, source, external_id
  FROM legacy_exam_task_candidates
  WHERE task_candidates_for_exam = 1
    AND exam_candidates_for_task = 1
    AND candidates_for_external_identity = 1
)
UPDATE public.exams AS exam
SET
  source = safe_match.source,
  external_id = safe_match.external_id
FROM safe_legacy_exam_task_matches AS safe_match
WHERE exam.id = safe_match.exam_id
  AND exam.source = 'manual'
  AND exam.external_id IS NULL;

ALTER TABLE public.exams
ADD CONSTRAINT exams_user_id_source_external_id_key
UNIQUE (user_id, source, external_id);

CREATE INDEX IF NOT EXISTS idx_exams_source
ON public.exams(source);

CREATE INDEX IF NOT EXISTS idx_exams_external_id
ON public.exams(external_id);

COMMENT ON COLUMN public.exams.source IS
  'Source of the exam: manual, Google Classroom, or Canvas.';

COMMENT ON COLUMN public.exams.external_id IS
  'Stable identifier supplied by the external integration.';

ALTER TABLE public.canvas_settings
ADD COLUMN IF NOT EXISTS sync_interval_migrated BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS last_background_sync_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS last_background_attempt_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.canvas_settings.sync_interval_migrated IS
  'True after the legacy browser-only Canvas interval has been migrated once.';

COMMENT ON COLUMN public.canvas_settings.last_background_sync_at IS
  'Last successful scheduler-owned sync; manual syncs do not change this cadence marker.';

COMMENT ON COLUMN public.canvas_settings.last_background_attempt_at IS
  'Last scheduler dispatch attempt; prevents duplicate work and permits five-minute failure retries.';

COMMIT;
