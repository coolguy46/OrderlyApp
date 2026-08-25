-- Orderly deterministic one-week planner.
-- This migration is additive and safe to run after the existing base schema.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS planner_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
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
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
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
  source_kind TEXT NOT NULL CHECK (source_kind IN ('task', 'exam_prep')),
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
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
  CHECK (end_at <= deadline_at),
  CHECK (end_at - start_at <= INTERVAL '90 minutes'),
  CHECK (mod(extract(epoch FROM start_at)::BIGINT, 900) = 0),
  CHECK (mod(extract(epoch FROM end_at)::BIGINT, 900) = 0)
);

CREATE TABLE IF NOT EXISTS planner_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id UUID REFERENCES planner_plans(id) ON DELETE SET NULL,
  block_id UUID REFERENCES planner_blocks(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  exam_id UUID REFERENCES exams(id) ON DELETE SET NULL,
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
  plan_id UUID REFERENCES planner_plans(id) ON DELETE SET NULL,
  block_id UUID REFERENCES planner_blocks(id) ON DELETE SET NULL,
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

-- One editable current plan per user. Archived plans remain available as history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_plans_one_current
  ON planner_plans(user_id)
  WHERE status IN ('active', 'stale');
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

CREATE OR REPLACE FUNCTION planner_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
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
