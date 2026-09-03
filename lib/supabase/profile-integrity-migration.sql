-- Protect public profile identity/statistics and maintain counters from source
-- tables. Apply before deploying the matching application revision.
-- Safe to run more than once.

BEGIN;

-- Profiles are provisioned only by the SECURITY DEFINER auth.users trigger.
-- Remove every historic INSERT policy instead of retaining the old
-- `WITH CHECK (true)` policy, and revoke direct browser INSERT privileges.
DO $policies$
DECLARE
  insert_policy RECORD;
BEGIN
  FOR insert_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd = 'INSERT'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.profiles',
      insert_policy.policyname
    );
  END LOOP;
END;
$policies$;

REVOKE INSERT ON public.profiles FROM anon, authenticated;

-- Sessions are user-authored source rows, so bound them before using them in a
-- denormalized INTEGER counter. Do not silently rewrite historic sessions:
-- inspect `SELECT * FROM public.study_sessions WHERE duration_minutes NOT
-- BETWEEN 1 AND 1440` and repair/back up each invalid row deliberately.
DO $preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.study_sessions
    WHERE duration_minutes < 1 OR duration_minutes > 1440
  ) THEN
    RAISE EXCEPTION
      'Profile-integrity preflight failed: invalid study-session durations require backed-up manual review';
  END IF;
END;
$preflight$;

ALTER TABLE public.study_sessions
DROP CONSTRAINT IF EXISTS study_sessions_duration_minutes_check;

ALTER TABLE public.study_sessions
ADD CONSTRAINT study_sessions_duration_minutes_check
CHECK (duration_minutes >= 1 AND duration_minutes <= 1440);

CREATE OR REPLACE FUNCTION public.protect_profile_managed_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Top-level browser updates may edit display fields only. Nested updates from
  -- the trusted task/session triggers below run at trigger depth 2.
  IF auth.uid() IS NOT NULL
     AND pg_trigger_depth() = 1
     AND (
       NEW.email IS DISTINCT FROM OLD.email
       OR NEW.total_study_time IS DISTINCT FROM OLD.total_study_time
       OR NEW.tasks_completed IS DISTINCT FROM OLD.tasks_completed
       OR NEW.current_streak IS DISTINCT FROM OLD.current_streak
       OR NEW.longest_streak IS DISTINCT FROM OLD.longest_streak
     ) THEN
    RAISE EXCEPTION 'Profile identity and statistics are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_managed_fields ON public.profiles;
CREATE TRIGGER protect_profile_managed_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_managed_fields();

CREATE OR REPLACE FUNCTION public.adjust_completed_task_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_delta INTEGER := 0;
  new_delta INTEGER := 0;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'completed' THEN old_delta := 1; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'completed' THEN new_delta := 1; END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE public.profiles
      SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT - old_delta))::INTEGER
      WHERE id = OLD.user_id;
    UPDATE public.profiles
      SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT + new_delta))::INTEGER
      WHERE id = NEW.user_id;
  ELSE
    UPDATE public.profiles
      SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT + new_delta - old_delta))::INTEGER
      WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adjust_completed_task_count ON public.tasks;
CREATE TRIGGER adjust_completed_task_count
  AFTER INSERT OR UPDATE OF status, user_id OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.adjust_completed_task_count();

CREATE OR REPLACE FUNCTION public.adjust_total_study_time()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_minutes INTEGER := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE GREATEST(0, OLD.duration_minutes) END;
  new_minutes INTEGER := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE GREATEST(0, NEW.duration_minutes) END;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE public.profiles
      SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT - old_minutes))::INTEGER
      WHERE id = OLD.user_id;
    UPDATE public.profiles
      SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT + new_minutes))::INTEGER
      WHERE id = NEW.user_id;
  ELSE
    UPDATE public.profiles
      SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT + new_minutes - old_minutes))::INTEGER
      WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS adjust_total_study_time ON public.study_sessions;
CREATE TRIGGER adjust_total_study_time
  AFTER INSERT OR UPDATE OF duration_minutes, user_id OR DELETE ON public.study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.adjust_total_study_time();

-- Repair any counters that predate these triggers.
UPDATE public.profiles AS p
SET tasks_completed = (
      SELECT LEAST(COUNT(*), 2147483647)::INTEGER FROM public.tasks AS t
      WHERE t.user_id = p.id AND t.status = 'completed'
    ),
    total_study_time = (
      SELECT LEAST(COALESCE(SUM(GREATEST(0, s.duration_minutes)), 0), 2147483647)::INTEGER
      FROM public.study_sessions AS s WHERE s.user_id = p.id
    );

-- Compatibility only: no trustworthy timezone-aware streak-maintenance job
-- exists in this repository. Keep the columns protected from browser writes,
-- but do not describe or present them as live statistics until one is added.
COMMENT ON COLUMN public.profiles.current_streak IS
  'Legacy compatibility value; not maintained by the current application.';
COMMENT ON COLUMN public.profiles.longest_streak IS
  'Legacy compatibility value; not maintained by the current application.';

REVOKE ALL ON FUNCTION public.protect_profile_managed_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_completed_task_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.adjust_total_study_time() FROM PUBLIC;

COMMIT;
