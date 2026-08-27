-- Durable timer state used by the current application. This migration is
-- additive/idempotent for a missing or partially-created timer_states table.
-- It deliberately fails rather than guessing how to repair duplicate owners
-- or invalid historic values. Apply relationship-ownership-migration.sql next.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.timer_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  timer_type TEXT NOT NULL DEFAULT 'pomodoro',
  mode TEXT NOT NULL DEFAULT 'focus',
  is_running BOOLEAN NOT NULL DEFAULT false,
  pomodoro_started_at TIMESTAMP WITH TIME ZONE,
  stopwatch_started_at TIMESTAMP WITH TIME ZONE,
  time_left INTEGER NOT NULL DEFAULT 1500,
  stopwatch_time INTEGER NOT NULL DEFAULT 0,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  sessions_completed INTEGER NOT NULL DEFAULT 0,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  pomodoro_started BOOLEAN NOT NULL DEFAULT false,
  stopwatch_started BOOLEAN NOT NULL DEFAULT false,
  pending_session JSONB,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE public.timer_states
  ADD COLUMN IF NOT EXISTS timer_type TEXT NOT NULL DEFAULT 'pomodoro',
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'focus',
  ADD COLUMN IF NOT EXISTS is_running BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pomodoro_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS stopwatch_started_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS time_left INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN IF NOT EXISTS stopwatch_time INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sessions_completed INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sound_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pomodoro_started BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS stopwatch_started BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_session JSONB,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();

DO $preflight$
BEGIN
  IF EXISTS (
    SELECT user_id
    FROM public.timer_states
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'timer_states preflight failed: duplicate user_id rows require backed-up manual review';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.timer_states
    WHERE timer_type NOT IN ('pomodoro', 'stopwatch')
       OR mode NOT IN ('focus', 'shortBreak', 'longBreak')
       OR time_left < 0
       OR stopwatch_time < 0
       OR sessions_completed < 0
  ) THEN
    RAISE EXCEPTION
      'timer_states preflight failed: invalid timer values require manual review';
  END IF;
END;
$preflight$;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.timer_states'::regclass
      AND conname = 'timer_states_user_id_key'
  ) THEN
    ALTER TABLE public.timer_states
      ADD CONSTRAINT timer_states_user_id_key UNIQUE (user_id);
  END IF;
END;
$constraints$;

ALTER TABLE public.timer_states
  DROP CONSTRAINT IF EXISTS timer_states_timer_type_check,
  DROP CONSTRAINT IF EXISTS timer_states_mode_check,
  DROP CONSTRAINT IF EXISTS timer_states_time_left_check,
  DROP CONSTRAINT IF EXISTS timer_states_stopwatch_time_check,
  DROP CONSTRAINT IF EXISTS timer_states_sessions_completed_check;

ALTER TABLE public.timer_states
  ADD CONSTRAINT timer_states_timer_type_check
    CHECK (timer_type IN ('pomodoro', 'stopwatch')),
  ADD CONSTRAINT timer_states_mode_check
    CHECK (mode IN ('focus', 'shortBreak', 'longBreak')),
  ADD CONSTRAINT timer_states_time_left_check CHECK (time_left >= 0),
  ADD CONSTRAINT timer_states_stopwatch_time_check CHECK (stopwatch_time >= 0),
  ADD CONSTRAINT timer_states_sessions_completed_check CHECK (sessions_completed >= 0);

ALTER TABLE public.timer_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own timer state" ON public.timer_states;
CREATE POLICY "Users can manage their own timer state" ON public.timer_states
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Reset is account-fenced inside one database transaction. A client-side
-- DELETE that affects zero rows cannot distinguish "already absent" from an
-- auth/session switch; this RPC verifies the caller before acknowledging it.
CREATE OR REPLACE FUNCTION public.clear_own_timer_state(expected_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM expected_user_id THEN
    RAISE EXCEPTION 'authenticated account does not match timer owner'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.timer_states WHERE user_id = expected_user_id;
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_own_timer_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_own_timer_state(UUID) TO authenticated;

COMMENT ON TABLE public.timer_states IS
  'One durable timer snapshot per account, including failed-session recovery.';
COMMENT ON COLUMN public.timer_states.pending_session IS
  'Exact failed study-session payload and post-save timer outcome for retry recovery.';

COMMIT;
