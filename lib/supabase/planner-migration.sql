-- Orderly deterministic one-week planner.
-- Apply this schema before deploying cross-device planner persistence, then
-- rerun relationship-ownership-migration.sql so optional task/exam/subject
-- links receive ownership triggers.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS planner_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(trim(time_zone)) > 0),
  horizon_days SMALLINT NOT NULL DEFAULT 7 CHECK (horizon_days BETWEEN 1 AND 7),
  slot_minutes SMALLINT NOT NULL DEFAULT 15 CHECK (slot_minutes = 15),
  max_block_minutes SMALLINT NOT NULL DEFAULT 90
    CHECK (max_block_minutes BETWEEN 15 AND 90 AND max_block_minutes % 15 = 0),
  wake_time TIME NOT NULL DEFAULT '07:00',
  school_start_time TIME NOT NULL DEFAULT '08:00',
  school_home_time TIME NOT NULL DEFAULT '16:00',
  bedtime TIME NOT NULL DEFAULT '23:00',
  school_days SMALLINT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::SMALLINT[]
    CHECK (school_days <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]),
  weekend_available_start TIME NOT NULL DEFAULT '09:00',
  weekend_available_end TIME NOT NULL DEFAULT '23:00',
  max_daily_minutes SMALLINT NOT NULL DEFAULT 240
    CHECK (max_daily_minutes BETWEEN 15 AND 960 AND max_daily_minutes % 15 = 0),
  min_break_minutes SMALLINT NOT NULL DEFAULT 15
    CHECK (min_break_minutes BETWEEN 0 AND 60 AND min_break_minutes % 15 = 0),
  estimate_cache JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(estimate_cache) = 'object'),
  feedback_multipliers JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(feedback_multipliers) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recurring_commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_commitment_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT,
  location TEXT,
  kind TEXT NOT NULL DEFAULT 'other'
    CHECK (kind IN ('class', 'school', 'sports', 'work', 'appointment', 'personal', 'other')),
  days_of_week SMALLINT[] NOT NULL
    CHECK (
      cardinality(days_of_week) > 0
      AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]::SMALLINT[]
    ),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  start_date DATE,
  end_date DATE,
  time_zone TEXT NOT NULL DEFAULT 'UTC' CHECK (length(trim(time_zone)) > 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  color TEXT,
  occurrence_overrides JSONB NOT NULL DEFAULT '{}'::JSONB
    CHECK (jsonb_typeof(occurrence_overrides) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_time <> end_time),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS planner_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'archived')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  horizon_start TIMESTAMPTZ NOT NULL,
  horizon_end TIMESTAMPTZ NOT NULL,
  prompt TEXT,
  input_fingerprint TEXT NOT NULL,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(input_snapshot) = 'object'),
  settings_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(settings_snapshot) = 'object'),
  plan_payload JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(plan_payload) = 'object'),
  messages JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(messages) = 'array'),
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(warnings) = 'array'),
  total_scheduled_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_scheduled_minutes >= 0),
  total_unscheduled_minutes INTEGER NOT NULL DEFAULT 0 CHECK (total_unscheduled_minutes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_plan_id),
  UNIQUE (id, user_id),
  CHECK (horizon_end > horizon_start),
  CHECK (horizon_end <= horizon_start + INTERVAL '8 days')
);

CREATE TABLE IF NOT EXISTS planner_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_block_id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('task', 'exam_prep', 'requested_activity')),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  activity_id TEXT,
  commitment_id UUID REFERENCES recurring_commitments(id) ON DELETE SET NULL,
  source_id_snapshot TEXT NOT NULL,
  title_snapshot TEXT NOT NULL CHECK (length(trim(title_snapshot)) > 0),
  description_snapshot TEXT,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  assignment_type TEXT
    CHECK (assignment_type IS NULL OR assignment_type IN ('assignment', 'exam', 'quiz', 'discussion', 'project', 'other')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  deadline_at TIMESTAMPTZ NOT NULL,
  estimated_minutes SMALLINT NOT NULL
    CHECK (estimated_minutes BETWEEN 15 AND 90 AND estimated_minutes % 15 = 0),
  segment_index SMALLINT NOT NULL DEFAULT 0 CHECK (segment_index >= 0),
  segment_count SMALLINT NOT NULL DEFAULT 1 CHECK (segment_count >= 1),
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'completed', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (plan_id, client_block_id),
  CONSTRAINT planner_blocks_owned_plan_fk
    FOREIGN KEY (plan_id, user_id) REFERENCES planner_plans(id, user_id) ON DELETE CASCADE,
  CHECK (end_at > start_at),
  CHECK (end_at - start_at <= INTERVAL '90 minutes'),
  CHECK (mod(extract(epoch FROM start_at)::BIGINT, 900) = 0),
  CHECK (mod(extract(epoch FROM end_at)::BIGINT, 900) = 0)
);

-- Older installs treated the assignment deadline as a hard database boundary.
-- A deadline is now advisory: overdue work remains schedulable and the app
-- surfaces a warning instead. Discover the legacy check by its definition so
-- this stays safe across PostgreSQL-generated or manually renamed constraints.
DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT constraint_name.conname
      FROM pg_constraint AS constraint_name
     WHERE constraint_name.conrelid = 'public.planner_blocks'::regclass
       AND constraint_name.contype = 'c'
       AND (
         regexp_replace(lower(pg_get_constraintdef(constraint_name.oid)), '\s', '', 'g') LIKE '%end_at<=deadline_at%'
         OR regexp_replace(lower(pg_get_constraintdef(constraint_name.oid)), '\s', '', 'g') LIKE '%deadline_at>=end_at%'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.planner_blocks DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS planner_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_feedback_id TEXT NOT NULL,
  plan_id UUID REFERENCES planner_plans(id) ON DELETE SET NULL,
  client_plan_id TEXT,
  block_id UUID REFERENCES planner_blocks(id) ON DELETE SET NULL,
  client_block_id TEXT,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
  activity_id TEXT,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  assignment_type TEXT
    CHECK (assignment_type IS NULL OR assignment_type IN ('assignment', 'exam', 'quiz', 'discussion', 'project', 'other')),
  predicted_minutes SMALLINT NOT NULL CHECK (predicted_minutes > 0),
  actual_minutes SMALLINT CHECK (actual_minutes IS NULL OR actual_minutes >= 0),
  timing_rating TEXT NOT NULL CHECK (timing_rating IN ('too_short', 'accurate', 'too_long')),
  schedule_rating SMALLINT CHECK (schedule_rating IS NULL OR schedule_rating BETWEEN 1 AND 5),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_adjustment_id TEXT NOT NULL,
  plan_id UUID REFERENCES planner_plans(id) ON DELETE SET NULL,
  client_plan_id TEXT NOT NULL,
  block_id UUID REFERENCES planner_blocks(id) ON DELETE SET NULL,
  client_block_id TEXT,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('move', 'resize', 'delete', 'edit')),
  previous_start_at TIMESTAMPTZ,
  previous_end_at TIMESTAMPTZ,
  new_start_at TIMESTAMPTZ,
  new_end_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (previous_end_at IS NULL OR previous_start_at IS NULL OR previous_end_at > previous_start_at),
  CHECK (new_end_at IS NULL OR new_start_at IS NULL OR new_end_at > new_start_at)
);

-- Upgrade databases that already ran an earlier browser-local planner schema.
-- The client IDs preserve the app's stable identifiers without assuming they
-- are database UUIDs, while the canonical payload keeps every plan field
-- needed for lossless cross-device hydration.
ALTER TABLE recurring_commitments
  ADD COLUMN IF NOT EXISTS client_commitment_id TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS occurrence_overrides JSONB NOT NULL DEFAULT '{}'::JSONB;

UPDATE recurring_commitments
SET client_commitment_id = id::TEXT
WHERE client_commitment_id IS NULL;

ALTER TABLE recurring_commitments
  ALTER COLUMN client_commitment_id SET NOT NULL;

ALTER TABLE planner_plans
  ADD COLUMN IF NOT EXISTS plan_payload JSONB NOT NULL DEFAULT '{}'::JSONB;

ALTER TABLE planner_blocks
  ADD COLUMN IF NOT EXISTS activity_id TEXT;

ALTER TABLE planner_preferences
  ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 0;

ALTER TABLE planner_feedback
  ADD COLUMN IF NOT EXISTS client_feedback_id TEXT,
  ADD COLUMN IF NOT EXISTS client_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS client_block_id TEXT,
  ADD COLUMN IF NOT EXISTS activity_id TEXT;

UPDATE planner_feedback AS feedback
SET
  client_feedback_id = COALESCE(feedback.client_feedback_id, feedback.id::TEXT),
  client_plan_id = COALESCE(
    feedback.client_plan_id,
    (SELECT plan_row.client_plan_id FROM planner_plans AS plan_row WHERE plan_row.id = feedback.plan_id)
  ),
  client_block_id = COALESCE(
    feedback.client_block_id,
    (SELECT block_row.client_block_id FROM planner_blocks AS block_row WHERE block_row.id = feedback.block_id)
  )
WHERE (
    feedback.client_feedback_id IS NULL
    OR feedback.client_plan_id IS NULL
    OR (feedback.block_id IS NOT NULL AND feedback.client_block_id IS NULL)
  );

UPDATE planner_feedback
SET client_feedback_id = id::TEXT
WHERE client_feedback_id IS NULL;

ALTER TABLE planner_feedback
  ALTER COLUMN client_feedback_id SET NOT NULL;

ALTER TABLE plan_adjustments
  ADD COLUMN IF NOT EXISTS client_adjustment_id TEXT,
  ADD COLUMN IF NOT EXISTS client_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS client_block_id TEXT;

UPDATE plan_adjustments AS adjustment
SET
  client_adjustment_id = COALESCE(adjustment.client_adjustment_id, adjustment.id::TEXT),
  client_plan_id = COALESCE(
    adjustment.client_plan_id,
    (SELECT plan_row.client_plan_id FROM planner_plans AS plan_row WHERE plan_row.id = adjustment.plan_id),
    adjustment.metadata->>'client_plan_id',
    'legacy-plan-' || adjustment.id::TEXT
  ),
  client_block_id = COALESCE(
    adjustment.client_block_id,
    (SELECT block_row.client_block_id FROM planner_blocks AS block_row WHERE block_row.id = adjustment.block_id)
  )
WHERE (
    adjustment.client_adjustment_id IS NULL
    OR adjustment.client_plan_id IS NULL
    OR (adjustment.block_id IS NOT NULL AND adjustment.client_block_id IS NULL)
  );

UPDATE plan_adjustments
SET
  client_adjustment_id = COALESCE(client_adjustment_id, id::TEXT),
  client_plan_id = COALESCE(client_plan_id, metadata->>'client_plan_id', 'legacy-plan-' || id::TEXT)
WHERE client_adjustment_id IS NULL OR client_plan_id IS NULL;

ALTER TABLE plan_adjustments
  ALTER COLUMN client_adjustment_id SET NOT NULL,
  ALTER COLUMN client_plan_id SET NOT NULL;

ALTER TABLE planner_blocks
  DROP CONSTRAINT IF EXISTS planner_blocks_source_kind_check;
ALTER TABLE planner_blocks
  ADD CONSTRAINT planner_blocks_source_kind_check
  CHECK (source_kind IN ('task', 'exam_prep', 'requested_activity'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.planner_preferences'::regclass
      AND conname = 'planner_preferences_revision_check'
  ) THEN
    ALTER TABLE planner_preferences
      ADD CONSTRAINT planner_preferences_revision_check CHECK (revision >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recurring_commitments'::regclass
      AND conname = 'recurring_commitments_occurrence_overrides_check'
  ) THEN
    ALTER TABLE recurring_commitments
      ADD CONSTRAINT recurring_commitments_occurrence_overrides_check
      CHECK (jsonb_typeof(occurrence_overrides) = 'object');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.planner_plans'::regclass
      AND conname = 'planner_plans_plan_payload_check'
  ) THEN
    ALTER TABLE planner_plans
      ADD CONSTRAINT planner_plans_plan_payload_check
      CHECK (jsonb_typeof(plan_payload) = 'object');
  END IF;
END $$;

-- One editable current plan per user. Archived plans remain available as history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_plans_one_current
  ON planner_plans(user_id)
  WHERE status IN ('active', 'stale');
CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_commitments_user_client_id
  ON recurring_commitments(user_id, client_commitment_id);
CREATE INDEX IF NOT EXISTS idx_recurring_commitments_user ON recurring_commitments(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_planner_plans_user_generated ON planner_plans(user_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_planner_blocks_plan_start ON planner_blocks(plan_id, start_at);
CREATE INDEX IF NOT EXISTS idx_planner_blocks_task ON planner_blocks(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planner_blocks_exam ON planner_blocks(exam_id) WHERE exam_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_feedback_one_per_block
  ON planner_feedback(user_id, block_id)
  WHERE block_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planner_feedback_user_created ON planner_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_adjustments_user_created ON plan_adjustments(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_feedback_user_client_id
  ON planner_feedback(user_id, client_feedback_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_adjustments_user_client_id
  ON plan_adjustments(user_id, client_adjustment_id);

CREATE OR REPLACE FUNCTION planner_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS planner_preferences_touch_updated_at ON planner_preferences;
CREATE TRIGGER planner_preferences_touch_updated_at
  BEFORE UPDATE ON planner_preferences
  FOR EACH ROW EXECUTE FUNCTION planner_touch_updated_at();

DROP TRIGGER IF EXISTS recurring_commitments_touch_updated_at ON recurring_commitments;
CREATE TRIGGER recurring_commitments_touch_updated_at
  BEFORE UPDATE ON recurring_commitments
  FOR EACH ROW EXECUTE FUNCTION planner_touch_updated_at();

DROP TRIGGER IF EXISTS planner_plans_touch_updated_at ON planner_plans;
CREATE TRIGGER planner_plans_touch_updated_at
  BEFORE UPDATE ON planner_plans
  FOR EACH ROW EXECUTE FUNCTION planner_touch_updated_at();

DROP TRIGGER IF EXISTS planner_blocks_touch_updated_at ON planner_blocks;
CREATE TRIGGER planner_blocks_touch_updated_at
  BEFORE UPDATE ON planner_blocks
  FOR EACH ROW EXECUTE FUNCTION planner_touch_updated_at();

ALTER TABLE planner_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE planner_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE planner_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE planner_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own planner preferences" ON planner_preferences;
CREATE POLICY "Users manage own planner preferences" ON planner_preferences
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own recurring commitments" ON recurring_commitments;
CREATE POLICY "Users manage own recurring commitments" ON recurring_commitments
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own planner plans" ON planner_plans;
CREATE POLICY "Users manage own planner plans" ON planner_plans
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage blocks in own plans" ON planner_blocks;
CREATE POLICY "Users manage blocks in own plans" ON planner_blocks
  FOR ALL
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM planner_plans
      WHERE planner_plans.id = planner_blocks.plan_id
        AND planner_plans.user_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM planner_plans
      WHERE planner_plans.id = planner_blocks.plan_id
        AND planner_plans.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users manage own planner feedback" ON planner_feedback;
CREATE POLICY "Users manage own planner feedback" ON planner_feedback
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (plan_id IS NULL OR EXISTS (
      SELECT 1 FROM planner_plans
      WHERE planner_plans.id = planner_feedback.plan_id
        AND planner_plans.user_id = auth.uid()
    ))
    AND (block_id IS NULL OR EXISTS (
      SELECT 1 FROM planner_blocks
      WHERE planner_blocks.id = planner_feedback.block_id
        AND planner_blocks.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Users manage own plan adjustments" ON plan_adjustments;
CREATE POLICY "Users manage own plan adjustments" ON plan_adjustments
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (plan_id IS NULL OR EXISTS (
      SELECT 1 FROM planner_plans
      WHERE planner_plans.id = plan_adjustments.plan_id
        AND planner_plans.user_id = auth.uid()
    ))
    AND (block_id IS NULL OR EXISTS (
      SELECT 1 FROM planner_blocks
      WHERE planner_blocks.id = plan_adjustments.block_id
        AND planner_blocks.user_id = auth.uid()
    ))
  );

-- Replace one user's complete planner snapshot under a row-locked revision.
-- A NULL result is a compare-and-swap conflict. The client then reloads the
-- revision and retries with p_reconcile_deletes = FALSE, which upserts its own
-- entities without deleting work created by another tab or device.
CREATE OR REPLACE FUNCTION replace_planner_snapshot(
  p_expected_revision BIGINT,
  p_snapshot JSONB,
  p_reconcile_deletes BOOLEAN DEFAULT TRUE
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_current_revision BIGINT;
  v_next_revision BIGINT;
  v_preferences JSONB;
  v_item JSONB;
  v_plan JSONB;
  v_row JSONB;
  v_block JSONB;
  v_database_plan_id UUID;
  v_database_block_id UUID;
  v_active_client_plan_id TEXT;
  v_plan_existed BOOLEAN;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision < 0 OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Invalid planner snapshot.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_snapshot->'preferences', '{}'::JSONB)) <> 'object'
    OR jsonb_typeof(COALESCE(p_snapshot->'commitments', '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_snapshot->'plans', '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_snapshot->'feedback', '[]'::JSONB)) <> 'array'
    OR jsonb_typeof(COALESCE(p_snapshot->'adjustments', '[]'::JSONB)) <> 'array'
  THEN
    RAISE EXCEPTION 'Planner snapshot collections are invalid.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO planner_preferences (user_id, revision)
  VALUES (v_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT revision
  INTO v_current_revision
  FROM planner_preferences
  WHERE user_id = v_user_id
  FOR UPDATE;

  IF v_current_revision IS DISTINCT FROM p_expected_revision THEN
    RETURN NULL;
  END IF;

  v_preferences := p_snapshot->'preferences';

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'commitments', '[]'::JSONB))
  LOOP
    INSERT INTO recurring_commitments (
      user_id, client_commitment_id, title, description, location, kind, days_of_week,
      start_time, end_time, start_date, end_date, time_zone, enabled,
      color, occurrence_overrides
    ) VALUES (
      v_user_id,
      v_item->>'client_commitment_id',
      v_item->>'title',
      NULLIF(v_item->>'description', ''),
      NULLIF(v_item->>'location', ''),
      v_item->>'kind',
      ARRAY(
        SELECT value::SMALLINT
        FROM jsonb_array_elements_text(COALESCE(v_item->'days_of_week', '[]'::JSONB))
      ),
      (v_item->>'start_time')::TIME,
      (v_item->>'end_time')::TIME,
      NULLIF(v_item->>'start_date', '')::DATE,
      NULLIF(v_item->>'end_date', '')::DATE,
      v_item->>'time_zone',
      COALESCE((v_item->>'enabled')::BOOLEAN, TRUE),
      NULLIF(v_item->>'color', ''),
      COALESCE(v_item->'occurrence_overrides', '{}'::JSONB)
    )
    ON CONFLICT (user_id, client_commitment_id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      location = EXCLUDED.location,
      kind = EXCLUDED.kind,
      days_of_week = EXCLUDED.days_of_week,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      start_date = EXCLUDED.start_date,
      end_date = EXCLUDED.end_date,
      time_zone = EXCLUDED.time_zone,
      enabled = EXCLUDED.enabled,
      color = EXCLUDED.color,
      occurrence_overrides = EXCLUDED.occurrence_overrides
    WHERE p_reconcile_deletes;
  END LOOP;

  IF p_reconcile_deletes THEN
    DELETE FROM recurring_commitments AS commitment
    WHERE commitment.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_snapshot->'commitments', '[]'::JSONB)) AS wanted(value)
        WHERE wanted.value->>'client_commitment_id' = commitment.client_commitment_id
      );
  END IF;

  SELECT item.value->'row'->>'client_plan_id'
  INTO v_active_client_plan_id
  FROM jsonb_array_elements(COALESCE(p_snapshot->'plans', '[]'::JSONB)) AS item(value)
  WHERE item.value->'row'->>'status' IN ('active', 'stale')
  LIMIT 1;

  IF p_reconcile_deletes AND v_active_client_plan_id IS NOT NULL THEN
    UPDATE planner_plans
    SET status = 'archived', archived_at = COALESCE(archived_at, NOW())
    WHERE user_id = v_user_id
      AND status IN ('active', 'stale')
      AND client_plan_id <> v_active_client_plan_id;
  ELSIF p_reconcile_deletes THEN
    UPDATE planner_plans
    SET status = 'archived', archived_at = COALESCE(archived_at, NOW())
    WHERE user_id = v_user_id AND status IN ('active', 'stale');
  END IF;

  FOR v_plan IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'plans', '[]'::JSONB))
  LOOP
    v_row := v_plan->'row';
    SELECT EXISTS (
      SELECT 1 FROM planner_plans
      WHERE user_id = v_user_id AND client_plan_id = v_row->>'client_plan_id'
    ) INTO v_plan_existed;

    -- In merge mode the server's current plan wins. A new local plan is kept
    -- as archived history instead of hiding the plan created on another tab.
    IF NOT p_reconcile_deletes
      AND v_row->>'status' IN ('active', 'stale')
      AND EXISTS (
        SELECT 1 FROM planner_plans
        WHERE user_id = v_user_id
          AND status IN ('active', 'stale')
          AND client_plan_id <> v_row->>'client_plan_id'
      )
    THEN
      v_row := jsonb_set(v_row, '{status}', '"archived"'::JSONB);
      v_row := jsonb_set(v_row, '{archived_at}', to_jsonb(NOW()::TEXT));
    END IF;
    v_database_plan_id := NULL;
    INSERT INTO planner_plans (
      user_id, client_plan_id, status, generated_at, archived_at,
      horizon_start, horizon_end, prompt, input_fingerprint, input_snapshot,
      settings_snapshot, plan_payload, messages, warnings,
      total_scheduled_minutes, total_unscheduled_minutes
    ) VALUES (
      v_user_id,
      v_row->>'client_plan_id',
      v_row->>'status',
      (v_row->>'generated_at')::TIMESTAMPTZ,
      NULLIF(v_row->>'archived_at', '')::TIMESTAMPTZ,
      (v_row->>'horizon_start')::TIMESTAMPTZ,
      (v_row->>'horizon_end')::TIMESTAMPTZ,
      NULLIF(v_row->>'prompt', ''),
      v_row->>'input_fingerprint',
      COALESCE(v_row->'input_snapshot', '{}'::JSONB),
      COALESCE(v_row->'settings_snapshot', '{}'::JSONB),
      COALESCE(v_row->'plan_payload', '{}'::JSONB),
      COALESCE(v_row->'messages', '[]'::JSONB),
      COALESCE(v_row->'warnings', '[]'::JSONB),
      COALESCE((v_row->>'total_scheduled_minutes')::INTEGER, 0),
      COALESCE((v_row->>'total_unscheduled_minutes')::INTEGER, 0)
    )
    ON CONFLICT (user_id, client_plan_id) DO UPDATE SET
      status = EXCLUDED.status,
      generated_at = EXCLUDED.generated_at,
      archived_at = EXCLUDED.archived_at,
      horizon_start = EXCLUDED.horizon_start,
      horizon_end = EXCLUDED.horizon_end,
      prompt = EXCLUDED.prompt,
      input_fingerprint = EXCLUDED.input_fingerprint,
      input_snapshot = EXCLUDED.input_snapshot,
      settings_snapshot = EXCLUDED.settings_snapshot,
      plan_payload = EXCLUDED.plan_payload,
      messages = EXCLUDED.messages,
      warnings = EXCLUDED.warnings,
      total_scheduled_minutes = EXCLUDED.total_scheduled_minutes,
      total_unscheduled_minutes = EXCLUDED.total_unscheduled_minutes
    WHERE p_reconcile_deletes
    RETURNING id INTO v_database_plan_id;

    IF v_database_plan_id IS NULL THEN
      SELECT id INTO v_database_plan_id
      FROM planner_plans
      WHERE user_id = v_user_id AND client_plan_id = v_row->>'client_plan_id';
    END IF;

    IF p_reconcile_deletes OR NOT v_plan_existed THEN
      FOR v_block IN
        SELECT value FROM jsonb_array_elements(COALESCE(v_plan->'blocks', '[]'::JSONB))
      LOOP
        INSERT INTO planner_blocks (
        plan_id, user_id, client_block_id, source_kind, task_id, exam_id,
        activity_id, commitment_id, source_id_snapshot, title_snapshot,
        description_snapshot, subject_id, assignment_type, priority,
        start_at, end_at, deadline_at, estimated_minutes, segment_index,
        segment_count, locked, status
      ) VALUES (
        v_database_plan_id,
        v_user_id,
        v_block->>'client_block_id',
        v_block->>'source_kind',
        NULLIF(v_block->>'task_id', '')::UUID,
        NULLIF(v_block->>'exam_id', '')::UUID,
        NULLIF(v_block->>'activity_id', ''),
        NULL,
        v_block->>'source_id_snapshot',
        v_block->>'title_snapshot',
        NULLIF(v_block->>'description_snapshot', ''),
        NULLIF(v_block->>'subject_id', '')::UUID,
        NULLIF(v_block->>'assignment_type', ''),
        v_block->>'priority',
        (v_block->>'start_at')::TIMESTAMPTZ,
        (v_block->>'end_at')::TIMESTAMPTZ,
        (v_block->>'deadline_at')::TIMESTAMPTZ,
        (v_block->>'estimated_minutes')::SMALLINT,
        COALESCE((v_block->>'segment_index')::SMALLINT, 0),
        COALESCE((v_block->>'segment_count')::SMALLINT, 1),
        COALESCE((v_block->>'locked')::BOOLEAN, FALSE),
        v_block->>'status'
        )
        ON CONFLICT (plan_id, client_block_id) DO UPDATE SET
        source_kind = EXCLUDED.source_kind,
        task_id = EXCLUDED.task_id,
        exam_id = EXCLUDED.exam_id,
        activity_id = EXCLUDED.activity_id,
        commitment_id = EXCLUDED.commitment_id,
        source_id_snapshot = EXCLUDED.source_id_snapshot,
        title_snapshot = EXCLUDED.title_snapshot,
        description_snapshot = EXCLUDED.description_snapshot,
        subject_id = EXCLUDED.subject_id,
        assignment_type = EXCLUDED.assignment_type,
        priority = EXCLUDED.priority,
        start_at = EXCLUDED.start_at,
        end_at = EXCLUDED.end_at,
        deadline_at = EXCLUDED.deadline_at,
        estimated_minutes = EXCLUDED.estimated_minutes,
        segment_index = EXCLUDED.segment_index,
        segment_count = EXCLUDED.segment_count,
          locked = EXCLUDED.locked,
          status = EXCLUDED.status
        WHERE p_reconcile_deletes;
      END LOOP;
    END IF;

    IF p_reconcile_deletes THEN
      DELETE FROM planner_blocks AS block_row
      WHERE block_row.user_id = v_user_id
        AND block_row.plan_id = v_database_plan_id
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(v_plan->'blocks', '[]'::JSONB)) AS wanted(value)
          WHERE wanted.value->>'client_block_id' = block_row.client_block_id
        );
    END IF;
  END LOOP;

  IF p_reconcile_deletes THEN
    DELETE FROM planner_plans AS plan_row
    WHERE plan_row.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_snapshot->'plans', '[]'::JSONB)) AS wanted(value)
        WHERE wanted.value->'row'->>'client_plan_id' = plan_row.client_plan_id
      );
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'feedback', '[]'::JSONB))
  LOOP
    v_database_plan_id := NULL;
    v_database_block_id := NULL;
    IF NULLIF(v_item->>'client_plan_id', '') IS NOT NULL THEN
      SELECT id INTO v_database_plan_id
      FROM planner_plans
      WHERE user_id = v_user_id AND client_plan_id = v_item->>'client_plan_id';
    END IF;
    IF NULLIF(v_item->>'client_block_id', '') IS NOT NULL THEN
      SELECT block_row.id INTO v_database_block_id
      FROM planner_blocks AS block_row
      JOIN planner_plans AS plan_row ON plan_row.id = block_row.plan_id
      WHERE block_row.user_id = v_user_id
        AND block_row.client_block_id = v_item->>'client_block_id'
        AND (
          NULLIF(v_item->>'client_plan_id', '') IS NULL
          OR plan_row.client_plan_id = v_item->>'client_plan_id'
        )
      ORDER BY plan_row.generated_at DESC
      LIMIT 1;
    END IF;

    -- Keep the first persisted feedback for a block as the duplicate fence.
    IF v_database_block_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM planner_feedback
      WHERE user_id = v_user_id
        AND block_id = v_database_block_id
        AND client_feedback_id <> v_item->>'client_feedback_id'
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO planner_feedback (
      user_id, client_feedback_id, plan_id, client_plan_id, block_id,
      client_block_id, task_id, exam_id, activity_id, subject_id,
      assignment_type, predicted_minutes, actual_minutes, timing_rating,
      schedule_rating, note, created_at
    ) VALUES (
      v_user_id,
      v_item->>'client_feedback_id',
      v_database_plan_id,
      NULLIF(v_item->>'client_plan_id', ''),
      v_database_block_id,
      NULLIF(v_item->>'client_block_id', ''),
      NULLIF(v_item->>'task_id', '')::UUID,
      NULLIF(v_item->>'exam_id', '')::UUID,
      NULLIF(v_item->>'activity_id', ''),
      NULLIF(v_item->>'subject_id', '')::UUID,
      NULLIF(v_item->>'assignment_type', ''),
      (v_item->>'predicted_minutes')::SMALLINT,
      NULLIF(v_item->>'actual_minutes', '')::SMALLINT,
      v_item->>'timing_rating',
      NULLIF(v_item->>'schedule_rating', '')::SMALLINT,
      NULLIF(v_item->>'note', ''),
      (v_item->>'created_at')::TIMESTAMPTZ
    )
    ON CONFLICT (user_id, client_feedback_id) DO NOTHING;
  END LOOP;

  -- Feedback is immutable learning history. Never reconcile-delete rows that
  -- fell out of a browser's bounded cache, and never rewrite the first signal
  -- accepted for a stable client ID.

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_snapshot->'adjustments', '[]'::JSONB))
  LOOP
    v_database_plan_id := NULL;
    v_database_block_id := NULL;
    SELECT id INTO v_database_plan_id
    FROM planner_plans
    WHERE user_id = v_user_id AND client_plan_id = v_item->>'client_plan_id';

    IF NULLIF(v_item->>'client_block_id', '') IS NOT NULL THEN
      SELECT block_row.id INTO v_database_block_id
      FROM planner_blocks AS block_row
      JOIN planner_plans AS plan_row ON plan_row.id = block_row.plan_id
      WHERE block_row.user_id = v_user_id
        AND block_row.client_block_id = v_item->>'client_block_id'
        AND plan_row.client_plan_id = v_item->>'client_plan_id'
      LIMIT 1;
    END IF;

    INSERT INTO plan_adjustments (
      user_id, client_adjustment_id, plan_id, client_plan_id, block_id,
      client_block_id, adjustment_type, previous_start_at, previous_end_at,
      new_start_at, new_end_at, metadata, created_at
    ) VALUES (
      v_user_id,
      v_item->>'client_adjustment_id',
      v_database_plan_id,
      v_item->>'client_plan_id',
      v_database_block_id,
      NULLIF(v_item->>'client_block_id', ''),
      v_item->>'adjustment_type',
      NULLIF(v_item->>'previous_start_at', '')::TIMESTAMPTZ,
      NULLIF(v_item->>'previous_end_at', '')::TIMESTAMPTZ,
      NULLIF(v_item->>'new_start_at', '')::TIMESTAMPTZ,
      NULLIF(v_item->>'new_end_at', '')::TIMESTAMPTZ,
      COALESCE(v_item->'metadata', '{}'::JSONB),
      (v_item->>'created_at')::TIMESTAMPTZ
    )
    ON CONFLICT (user_id, client_adjustment_id) DO NOTHING;
  END LOOP;

  -- Adjustments are also append-only learning history; a snapshot can add a
  -- stable event but cannot erase events learned on another device.

  v_next_revision := v_current_revision + 1;
  IF p_reconcile_deletes THEN
    UPDATE planner_preferences SET
      revision = v_next_revision,
      time_zone = v_preferences->>'time_zone',
      horizon_days = (v_preferences->>'horizon_days')::SMALLINT,
      slot_minutes = 15,
      max_block_minutes = (v_preferences->>'max_block_minutes')::SMALLINT,
      wake_time = (v_preferences->>'wake_time')::TIME,
      school_start_time = (v_preferences->>'school_start_time')::TIME,
      school_home_time = (v_preferences->>'school_home_time')::TIME,
      bedtime = (v_preferences->>'bedtime')::TIME,
      school_days = ARRAY(
        SELECT value::SMALLINT
        FROM jsonb_array_elements_text(COALESCE(v_preferences->'school_days', '[]'::JSONB))
      ),
      weekend_available_start = (v_preferences->>'weekend_available_start')::TIME,
      weekend_available_end = (v_preferences->>'weekend_available_end')::TIME,
      max_daily_minutes = (v_preferences->>'max_daily_minutes')::SMALLINT,
      min_break_minutes = (v_preferences->>'min_break_minutes')::SMALLINT,
      estimate_cache = COALESCE(v_preferences->'estimate_cache', '{}'::JSONB),
      feedback_multipliers = COALESCE(v_preferences->'feedback_multipliers', '{}'::JSONB)
    WHERE user_id = v_user_id;
  ELSE
    UPDATE planner_preferences
    SET revision = v_next_revision
    WHERE user_id = v_user_id;
  END IF;

  RETURN v_next_revision;
END;
$$;

REVOKE ALL ON FUNCTION replace_planner_snapshot(BIGINT, JSONB, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION replace_planner_snapshot(BIGINT, JSONB, BOOLEAN) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON planner_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_commitments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON planner_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON planner_blocks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON planner_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON plan_adjustments TO authenticated;

COMMENT ON TABLE planner_preferences IS 'Cross-device availability and deterministic planning preferences.';
COMMENT ON TABLE recurring_commitments IS 'Weekly fixed events that the planner must schedule around.';
COMMENT ON TABLE planner_plans IS 'Current and archived seven-day plans with input fingerprints for staleness detection.';
COMMENT ON TABLE planner_blocks IS 'Editable 15-minute-grid work blocks; task/exam deletion preserves snapshots.';
COMMENT ON TABLE planner_feedback IS 'Timing accuracy and schedule satisfaction signals used by the local estimator.';
COMMENT ON TABLE plan_adjustments IS 'Drag, resize, edit, and deletion signals used to learn user preferences.';

COMMIT;
