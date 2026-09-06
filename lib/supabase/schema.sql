-- Student Time Management Platform Schema
-- FRESH BOOTSTRAP ONLY: run only against an empty application schema. This is
-- not an upgrade migration and is intentionally not idempotent. Existing
-- deployments must follow README.md's ordered incremental rollout instead.

BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  total_study_time INTEGER NOT NULL DEFAULT 0,
  tasks_completed INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Compatibility only. No timezone-aware streak maintenance job exists in the
-- current release; clients must not present these as live statistics.
COMMENT ON COLUMN profiles.current_streak IS
  'Legacy compatibility value; not maintained by the current application.';
COMMENT ON COLUMN profiles.longest_streak IS
  'Legacy compatibility value; not maintained by the current application.';

-- Service-role-only durable account deletion queue. This deliberately has no
-- foreign key to auth.users so the final completion record survives Auth
-- identity deletion and can be retried idempotently.
CREATE TABLE account_deletion_requests (
  user_id UUID PRIMARY KEY,
  phase TEXT NOT NULL DEFAULT 'storage'
    CHECK (phase IN ('storage', 'auth', 'completed')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'retry', 'completed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  next_attempt_at TIMESTAMP WITH TIME ZONE DEFAULT statement_timestamp(),
  lease_token UUID,
  lease_expires_at TIMESTAMP WITH TIME ZONE,
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT statement_timestamp(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT statement_timestamp(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_account_deletion_requests_due
ON account_deletion_requests(next_attempt_at, requested_at)
WHERE status IN ('queued', 'retry', 'processing');

CREATE OR REPLACE FUNCTION claim_account_deletion_requests(
  request_limit INTEGER DEFAULT 3,
  requested_user_id UUID DEFAULT NULL
)
RETURNS SETOF account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF request_limit IS NULL OR request_limit < 1 OR request_limit > 5 THEN
    RAISE EXCEPTION 'request_limit must be between 1 and 5';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT request.user_id
    FROM account_deletion_requests AS request
    WHERE (requested_user_id IS NULL OR request.user_id = requested_user_id)
      AND (
        (
          request.status IN ('queued', 'retry')
          AND COALESCE(request.next_attempt_at, statement_timestamp()) <= statement_timestamp()
        )
        OR (
          request.status = 'processing'
          AND COALESCE(request.lease_expires_at, '-infinity'::timestamptz)
            <= statement_timestamp()
        )
      )
    ORDER BY request.next_attempt_at NULLS FIRST, request.requested_at, request.user_id
    FOR UPDATE SKIP LOCKED
    LIMIT request_limit
  )
  UPDATE account_deletion_requests AS request
  SET status = 'processing',
      attempts = request.attempts + 1,
      lease_token = uuid_generate_v4(),
      lease_expires_at = statement_timestamp() + interval '2 minutes',
      updated_at = statement_timestamp()
  FROM candidates
  WHERE request.user_id = candidates.user_id
  RETURNING request.*;
END;
$function$;

REVOKE ALL ON FUNCTION claim_account_deletion_requests(INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_account_deletion_requests(INTEGER, UUID) TO service_role;

-- Subjects/Classes table
CREATE TABLE subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  due_date TIMESTAMP WITH TIME ZONE,
  due_time TEXT, -- Optional specific time e.g. '17:30'
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  recurrence_days JSONB DEFAULT NULL CHECK (recurrence_days IS NULL OR jsonb_typeof(recurrence_days) = 'array'),
  completed_at TIMESTAMP WITH TIME ZONE,
  -- Integration fields
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google_classroom', 'canvas')),
  external_id TEXT, -- ID from external system (Canvas UID, Google Classroom ID)
  external_url TEXT, -- Link to the assignment in Canvas/Google Classroom
  course_name TEXT, -- Name of the course/class
  assignment_type TEXT CHECK (assignment_type IN ('assignment', 'exam', 'quiz', 'discussion', 'project', 'other')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  -- Ensure external assignments are unique per user
  UNIQUE(user_id, source, external_id)
);

-- Goals table
CREATE TABLE goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  target_value INTEGER NOT NULL,
  current_value INTEGER DEFAULT 0,
  unit TEXT NOT NULL,
  goal_type TEXT NOT NULL DEFAULT 'short_term' CHECK (goal_type IN ('short_term', 'long_term')),
  deadline TIMESTAMP WITH TIME ZONE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Study Sessions table
CREATE TABLE study_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 1 AND duration_minutes <= 1440),
  session_type TEXT NOT NULL DEFAULT 'pomodoro' CHECK (session_type IN ('pomodoro', 'free_study')),
  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Exams table
CREATE TABLE exams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  exam_date TIMESTAMP WITH TIME ZONE NOT NULL,
  location TEXT,
  preparation_progress INTEGER DEFAULT 0 CHECK (preparation_progress >= 0 AND preparation_progress <= 100),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google_classroom', 'canvas')),
  external_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, source, external_id)
);

-- Friendships table
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (user_id <> friend_id),
  UNIQUE(user_id, friend_id)
);

-- Competitions table
CREATE TABLE competitions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  competition_type TEXT NOT NULL CHECK (competition_type IN ('study_time', 'tasks_completed', 'streak')),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Competition Participants table
CREATE TABLE competition_participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competition_id UUID NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(competition_id, user_id)
);

-- Achievements table
CREATE TABLE achievements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Canvas Integration Settings table
CREATE TABLE canvas_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  ical_url TEXT NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  last_background_sync_at TIMESTAMP WITH TIME ZONE,
  last_background_attempt_at TIMESTAMP WITH TIME ZONE,
  course_count INTEGER NOT NULL DEFAULT 0 CHECK (course_count >= 0),
  sync_lease_token UUID,
  sync_lease_expires_at TIMESTAMP WITH TIME ZONE,
  sync_revision BIGINT NOT NULL DEFAULT 0,
  sync_enabled BOOLEAN DEFAULT true,
  auto_import_assignments BOOLEAN DEFAULT true,
  auto_sync_interval INTEGER NOT NULL DEFAULT 15 CHECK (auto_sync_interval IN (5, 15, 30, 60)),
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  sync_interval_migrated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- No browser table privileges or RLS policies are granted. Authenticated
-- users can only claim/release their own expiring provider-request guard via
-- the SECURITY DEFINER RPCs below.
CREATE TABLE canvas_provider_request_limits (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  validation_last_started_at TIMESTAMP WITH TIME ZONE,
  validation_claim_token UUID,
  validation_claim_expires_at TIMESTAMP WITH TIME ZONE,
  manual_sync_last_started_at TIMESTAMP WITH TIME ZONE,
  manual_sync_claim_token UUID,
  manual_sync_claim_expires_at TIMESTAMP WITH TIME ZONE
);

-- Durable one-row-per-account timer snapshot.
CREATE TABLE timer_states (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  timer_type TEXT NOT NULL DEFAULT 'pomodoro' CHECK (timer_type IN ('pomodoro', 'stopwatch')),
  mode TEXT NOT NULL DEFAULT 'focus' CHECK (mode IN ('focus', 'shortBreak', 'longBreak')),
  is_running BOOLEAN NOT NULL DEFAULT false,
  pomodoro_started_at TIMESTAMP WITH TIME ZONE,
  stopwatch_started_at TIMESTAMP WITH TIME ZONE,
  time_left INTEGER NOT NULL DEFAULT 1500 CHECK (time_left >= 0),
  stopwatch_time INTEGER NOT NULL DEFAULT 0 CHECK (stopwatch_time >= 0),
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  sessions_completed INTEGER NOT NULL DEFAULT 0 CHECK (sessions_completed >= 0),
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  pomodoro_started BOOLEAN NOT NULL DEFAULT false,
  stopwatch_started BOOLEAN NOT NULL DEFAULT false,
  pending_session JSONB,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_tasks_user_id ON tasks(user_id);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_study_sessions_user_id ON study_sessions(user_id);
CREATE INDEX idx_study_sessions_started_at ON study_sessions(started_at);
CREATE INDEX idx_exams_user_id ON exams(user_id);
CREATE INDEX idx_exams_exam_date ON exams(exam_date);
CREATE INDEX idx_exams_source ON exams(source);
CREATE INDEX idx_exams_external_id ON exams(external_id);
CREATE INDEX idx_goals_user_id ON goals(user_id);
CREATE INDEX idx_friendships_user_id ON friendships(user_id);
CREATE INDEX idx_friendships_friend_id ON friendships(friend_id);
CREATE UNIQUE INDEX friendships_unique_unordered_pair
  ON friendships (LEAST(user_id, friend_id), GREATEST(user_id, friend_id));

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE competition_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_provider_request_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE timer_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE account_deletion_requests TO service_role;
REVOKE ALL ON TABLE canvas_provider_request_limits FROM PUBLIC, anon, authenticated;

-- RLS Policies for profiles
-- The SECURITY DEFINER auth.users trigger below is the only profile creator.
REVOKE INSERT ON profiles FROM anon, authenticated;

CREATE POLICY "Users can view their own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can view friend profiles" ON profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friendships 
      WHERE (user_id = auth.uid() AND friend_id = profiles.id AND status = 'accepted')
      OR (friend_id = auth.uid() AND user_id = profiles.id AND status = 'accepted')
    )
  );

-- RLS Policies for subjects
CREATE POLICY "Users can manage their own subjects" ON subjects
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for tasks
CREATE POLICY "Users can manage their own tasks" ON tasks
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for goals
CREATE POLICY "Users can manage their own goals" ON goals
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for study_sessions
CREATE POLICY "Users can manage their own study sessions" ON study_sessions
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for exams
CREATE POLICY "Users can manage their own exams" ON exams
  FOR ALL USING (auth.uid() = user_id);

-- RLS Policies for friendships
CREATE POLICY "Users can view their friendships" ON friendships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

CREATE POLICY "Users can create friendship requests" ON friendships
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND friend_id <> auth.uid()
    AND status = 'pending'
  );

CREATE POLICY "Recipients can respond to pending friendship requests" ON friendships
  FOR UPDATE
  USING (auth.uid() = friend_id AND status = 'pending')
  WITH CHECK (auth.uid() = friend_id AND status IN ('accepted', 'rejected'));

CREATE POLICY "Participants can delete friendships" ON friendships
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Competitions are deliberately dormant in the UI. Browser roles receive no
-- table privileges until visibility, admission, and score changes are backed
-- by server-managed operations rather than client-writable leaderboard data.
REVOKE ALL ON TABLE competitions FROM anon, authenticated;
REVOKE ALL ON TABLE competition_participants FROM anon, authenticated;

-- RLS Policies for achievements
CREATE POLICY "Users can view their own achievements" ON achievements
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "System can insert achievements" ON achievements
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- RLS Policies for canvas_settings
CREATE POLICY "Users can manage their own Canvas settings" ON canvas_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can manage their own timer state" ON timer_states
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Timer reset verifies the active auth identity atomically, so a zero-row
-- client DELETE caused by an account transition is never acknowledged.
CREATE OR REPLACE FUNCTION clear_own_timer_state(expected_user_id UUID)
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

REVOKE ALL ON FUNCTION clear_own_timer_state(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION clear_own_timer_state(UUID) TO authenticated;

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, NEW.raw_user_meta_data->>'email', ''),
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name'
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'avatar_url',
      NEW.raw_user_meta_data->>'picture'
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
    avatar_url = COALESCE(profiles.avatar_url, EXCLUDED.avatar_url),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Authenticated friend discovery exposes only the fields needed to identify a
-- recipient. Direct profile SELECT remains limited to self/accepted friends.
CREATE OR REPLACE FUNCTION search_profiles_for_friendship(search_query TEXT)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name, p.avatar_url
  FROM profiles AS p
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM profiles AS caller WHERE caller.id = auth.uid())
    AND p.id <> auth.uid()
    AND LENGTH(TRIM(search_query)) >= 5
    AND LOWER(p.email) = LOWER(TRIM(search_query))
    AND NOT EXISTS (
      SELECT 1 FROM friendships AS f
      WHERE (f.user_id = auth.uid() AND f.friend_id = p.id)
         OR (f.friend_id = auth.uid() AND f.user_id = p.id)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION search_profiles_for_friendship(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_profiles_for_friendship(TEXT) TO authenticated;

-- Return the minimum identity fields needed to render pending requests. Study
-- statistics remain private until both people have accepted the friendship.
CREATE OR REPLACE FUNCTION get_friendships_with_profiles()
RETURNS TABLE (
  friendship_id UUID,
  friendship_status TEXT,
  friendship_created_at TIMESTAMPTZ,
  direction TEXT,
  profile_id UUID,
  profile_email TEXT,
  profile_full_name TEXT,
  profile_avatar_url TEXT,
  profile_total_study_time INTEGER,
  profile_tasks_completed INTEGER,
  profile_current_streak INTEGER,
  profile_longest_streak INTEGER,
  profile_created_at TIMESTAMPTZ,
  profile_updated_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    f.id,
    f.status,
    f.created_at,
    CASE WHEN f.user_id = auth.uid() THEN 'sent' ELSE 'received' END,
    p.id,
    p.email,
    p.full_name,
    p.avatar_url,
    CASE WHEN f.status = 'accepted' THEN p.total_study_time ELSE 0 END,
    CASE WHEN f.status = 'accepted' THEN p.tasks_completed ELSE 0 END,
    CASE WHEN f.status = 'accepted' THEN p.current_streak ELSE 0 END,
    CASE WHEN f.status = 'accepted' THEN p.longest_streak ELSE 0 END,
    p.created_at,
    p.updated_at
  FROM friendships AS f
  JOIN profiles AS p
    ON p.id = CASE WHEN f.user_id = auth.uid() THEN f.friend_id ELSE f.user_id END
  WHERE auth.uid() IS NOT NULL
    AND (f.user_id = auth.uid() OR f.friend_id = auth.uid())
    AND f.status IN ('pending', 'accepted');
$$;

REVOKE ALL ON FUNCTION get_friendships_with_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_friendships_with_profiles() TO authenticated;

-- Trigger to automatically create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Friendship participants are immutable, and only a pending request may be
-- accepted/rejected. This complements RLS so an UPDATE cannot swap identities
-- or revive an already-resolved request.
CREATE OR REPLACE FUNCTION enforce_friendship_update_invariants()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.friend_id IS DISTINCT FROM OLD.friend_id THEN
    RAISE EXCEPTION 'Friendship identity and participants cannot be changed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'Invalid friendship status transition' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Identity and leaderboard counters are server-managed. Users may update only
-- their display fields directly; the nested task/session triggers maintain
-- counters atomically from the source tables.
CREATE OR REPLACE FUNCTION protect_profile_managed_fields()
RETURNS TRIGGER AS $$
BEGIN
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
$$ LANGUAGE plpgsql SET search_path = public;

CREATE OR REPLACE FUNCTION adjust_completed_task_count()
RETURNS TRIGGER AS $$
DECLARE
  old_delta INTEGER := 0;
  new_delta INTEGER := 0;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.status = 'completed' THEN old_delta := 1; END IF;
  IF TG_OP <> 'DELETE' AND NEW.status = 'completed' THEN new_delta := 1; END IF;

  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE profiles SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT - old_delta))::INTEGER
      WHERE id = OLD.user_id;
    UPDATE profiles SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT + new_delta))::INTEGER
      WHERE id = NEW.user_id;
  ELSE
    UPDATE profiles SET tasks_completed = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, tasks_completed::BIGINT + new_delta - old_delta))::INTEGER
      WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION adjust_total_study_time()
RETURNS TRIGGER AS $$
DECLARE
  old_minutes INTEGER := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE GREATEST(0, OLD.duration_minutes) END;
  new_minutes INTEGER := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE GREATEST(0, NEW.duration_minutes) END;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
    UPDATE profiles SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT - old_minutes))::INTEGER
      WHERE id = OLD.user_id;
    UPDATE profiles SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT + new_minutes))::INTEGER
      WHERE id = NEW.user_id;
  ELSE
    UPDATE profiles SET total_study_time = LEAST(2147483647::BIGINT, GREATEST(0::BIGINT, total_study_time::BIGINT + new_minutes - old_minutes))::INTEGER
      WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Account-owned relationship guards. Child-row RLS alone does not prevent a
-- user-owned row from pointing at another user's subject/task UUID.
CREATE OR REPLACE FUNCTION enforce_owned_subject_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.subject_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.subjects parent
       WHERE parent.id = NEW.subject_id AND parent.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'subject_id must belong to the row owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog;

CREATE OR REPLACE FUNCTION enforce_owned_task_reference()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.task_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.tasks parent
       WHERE parent.id = NEW.task_id AND parent.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'task_id must belong to the row owner'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog;

-- Add updated_at triggers
CREATE TRIGGER protect_profile_managed_fields BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION protect_profile_managed_fields();

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER adjust_completed_task_count
  AFTER INSERT OR UPDATE OF status, user_id OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION adjust_completed_task_count();

CREATE TRIGGER adjust_total_study_time
  AFTER INSERT OR UPDATE OF duration_minutes, user_id OR DELETE ON study_sessions
  FOR EACH ROW EXECUTE FUNCTION adjust_total_study_time();

CREATE TRIGGER tasks_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION enforce_owned_subject_reference();

CREATE TRIGGER exams_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON exams
  FOR EACH ROW EXECUTE FUNCTION enforce_owned_subject_reference();

CREATE TRIGGER study_sessions_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON study_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_owned_subject_reference();

CREATE TRIGGER study_sessions_enforce_owned_task
  BEFORE INSERT OR UPDATE OF user_id, task_id ON study_sessions
  FOR EACH ROW EXECUTE FUNCTION enforce_owned_task_reference();

CREATE TRIGGER timer_states_enforce_owned_subject
  BEFORE INSERT OR UPDATE OF user_id, subject_id ON timer_states
  FOR EACH ROW EXECUTE FUNCTION enforce_owned_subject_reference();

CREATE TRIGGER update_goals_updated_at BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exams_updated_at BEFORE UPDATE ON exams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_friendships_updated_at BEFORE UPDATE ON friendships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER enforce_friendship_update_invariants
  BEFORE UPDATE ON friendships
  FOR EACH ROW EXECUTE FUNCTION enforce_friendship_update_invariants();

CREATE TRIGGER update_canvas_settings_updated_at BEFORE UPDATE ON canvas_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_timer_states_updated_at BEFORE UPDATE ON timer_states
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Canvas synchronization is serialized per account. The two-minute lease is
-- twice the serverless route budget; the monotonic revision fences stale
-- owners from completing or releasing a newer invocation.
CREATE OR REPLACE FUNCTION protect_canvas_sync_internal_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF auth.uid() IS NOT NULL
       AND OLD.sync_lease_token IS NOT NULL
       AND OLD.sync_lease_expires_at > statement_timestamp() THEN
      RAISE EXCEPTION 'Canvas settings are temporarily locked by an active sync'
        USING ERRCODE = '55P03';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NOT NULL AND (
      NEW.sync_lease_token IS NOT NULL
      OR NEW.sync_lease_expires_at IS NOT NULL
      OR NEW.sync_revision <> 0
      OR NEW.last_sync_at IS NOT NULL
      OR NEW.last_background_sync_at IS NOT NULL
      OR NEW.last_background_attempt_at IS NOT NULL
      OR NEW.course_count <> 0
    ) THEN
      RAISE EXCEPTION 'Canvas sync state is server-managed' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND (
    NEW.sync_lease_token IS DISTINCT FROM OLD.sync_lease_token
    OR NEW.sync_lease_expires_at IS DISTINCT FROM OLD.sync_lease_expires_at
    OR NEW.sync_revision IS DISTINCT FROM OLD.sync_revision
    OR NEW.last_sync_at IS DISTINCT FROM OLD.last_sync_at
    OR NEW.last_background_sync_at IS DISTINCT FROM OLD.last_background_sync_at
    OR NEW.last_background_attempt_at IS DISTINCT FROM OLD.last_background_attempt_at
    OR NEW.course_count IS DISTINCT FROM OLD.course_count
  ) THEN
    RAISE EXCEPTION 'Canvas sync state is server-managed' USING ERRCODE = '42501';
  END IF;

  IF OLD.sync_lease_token IS NOT NULL
     AND OLD.sync_lease_expires_at > statement_timestamp()
     AND (
       NEW.ical_url IS DISTINCT FROM OLD.ical_url
       OR NEW.time_zone IS DISTINCT FROM OLD.time_zone
       OR NEW.sync_enabled IS DISTINCT FROM OLD.sync_enabled
     ) THEN
    RAISE EXCEPTION 'Canvas settings are temporarily locked by an active sync'
      USING ERRCODE = '55P03';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_canvas_sync_internal_state
  BEFORE INSERT OR UPDATE OR DELETE ON canvas_settings
  FOR EACH ROW EXECUTE FUNCTION protect_canvas_sync_internal_state();

CREATE OR REPLACE FUNCTION claim_canvas_sync(target_user_id UUID)
RETURNS TABLE(lease_token UUID, sync_revision BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.canvas_settings AS settings
  SET
    sync_lease_token = gen_random_uuid(),
    sync_lease_expires_at = statement_timestamp() + interval '2 minutes',
    sync_revision = settings.sync_revision + 1
  WHERE settings.user_id = target_user_id
    AND settings.ical_url IS NOT NULL
    AND (
      settings.sync_lease_token IS NULL
      OR settings.sync_lease_expires_at IS NULL
      OR settings.sync_lease_expires_at <= statement_timestamp()
    )
  RETURNING settings.sync_lease_token, settings.sync_revision;
END;
$$;

CREATE OR REPLACE FUNCTION renew_canvas_sync_lease(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.canvas_settings AS settings
  SET sync_lease_expires_at = statement_timestamp() + interval '2 minutes'
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision
    AND settings.sync_lease_expires_at > statement_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION claim_canvas_provider_request(requested_kind TEXT)
RETURNS TABLE(claim_token UUID, retry_after_seconds INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id UUID := auth.uid();
  granted_token UUID;
  available_at TIMESTAMP WITH TIME ZONE;
  claim_time TIMESTAMP WITH TIME ZONE := statement_timestamp();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF requested_kind NOT IN ('validate', 'manual_sync') THEN
    RAISE EXCEPTION 'Invalid Canvas provider request kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.canvas_provider_request_limits(user_id)
  VALUES (actor_id)
  ON CONFLICT (user_id) DO NOTHING;

  IF requested_kind = 'validate' THEN
    UPDATE public.canvas_provider_request_limits AS limits
    SET validation_last_started_at = claim_time,
        validation_claim_token = gen_random_uuid(),
        validation_claim_expires_at = claim_time + interval '30 seconds'
    WHERE limits.user_id = actor_id
      AND (
        limits.validation_claim_token IS NULL
        OR limits.validation_claim_expires_at IS NULL
        OR limits.validation_claim_expires_at <= claim_time
      )
      AND (
        limits.validation_last_started_at IS NULL
        OR limits.validation_last_started_at <= claim_time - interval '30 seconds'
      )
    RETURNING limits.validation_claim_token INTO granted_token;

    IF granted_token IS NOT NULL THEN
      RETURN QUERY SELECT granted_token, 0;
      RETURN;
    END IF;

    SELECT GREATEST(
      COALESCE(limits.validation_last_started_at + interval '30 seconds', claim_time),
      CASE WHEN limits.validation_claim_token IS NOT NULL
        AND limits.validation_claim_expires_at > claim_time
        THEN limits.validation_claim_expires_at ELSE claim_time END
    ) INTO available_at
    FROM public.canvas_provider_request_limits AS limits
    WHERE limits.user_id = actor_id;
  ELSE
    UPDATE public.canvas_provider_request_limits AS limits
    SET manual_sync_last_started_at = claim_time,
        manual_sync_claim_token = gen_random_uuid(),
        manual_sync_claim_expires_at = claim_time + interval '2 minutes'
    WHERE limits.user_id = actor_id
      AND (
        limits.manual_sync_claim_token IS NULL
        OR limits.manual_sync_claim_expires_at IS NULL
        OR limits.manual_sync_claim_expires_at <= claim_time
      )
      AND (
        limits.manual_sync_last_started_at IS NULL
        OR limits.manual_sync_last_started_at <= claim_time - interval '60 seconds'
      )
    RETURNING limits.manual_sync_claim_token INTO granted_token;

    IF granted_token IS NOT NULL THEN
      RETURN QUERY SELECT granted_token, 0;
      RETURN;
    END IF;

    SELECT GREATEST(
      COALESCE(limits.manual_sync_last_started_at + interval '60 seconds', claim_time),
      CASE WHEN limits.manual_sync_claim_token IS NOT NULL
        AND limits.manual_sync_claim_expires_at > claim_time
        THEN limits.manual_sync_claim_expires_at ELSE claim_time END
    ) INTO available_at
    FROM public.canvas_provider_request_limits AS limits
    WHERE limits.user_id = actor_id;
  END IF;

  RETURN QUERY SELECT NULL::UUID, GREATEST(
    1,
    CEIL(EXTRACT(EPOCH FROM (
      COALESCE(available_at, claim_time + interval '1 second') - claim_time
    )))::INTEGER
  );
END;
$$;

CREATE OR REPLACE FUNCTION release_canvas_provider_request(
  requested_kind TEXT,
  expected_claim_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id UUID := auth.uid();
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF requested_kind NOT IN ('validate', 'manual_sync') THEN
    RAISE EXCEPTION 'Invalid Canvas provider request kind' USING ERRCODE = '22023';
  END IF;

  IF requested_kind = 'validate' THEN
    UPDATE public.canvas_provider_request_limits AS limits
    SET validation_claim_token = NULL, validation_claim_expires_at = NULL
    WHERE limits.user_id = actor_id
      AND limits.validation_claim_token = expected_claim_token;
  ELSE
    UPDATE public.canvas_provider_request_limits AS limits
    SET manual_sync_claim_token = NULL, manual_sync_claim_expires_at = NULL
    WHERE limits.user_id = actor_id
      AND limits.manual_sync_claim_token = expected_claim_token;
  END IF;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION complete_canvas_sync(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT,
  requested_mode TEXT,
  completed_sync_at TIMESTAMP WITH TIME ZONE,
  completed_course_count INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF requested_mode NOT IN ('manual', 'background') THEN
    RAISE EXCEPTION 'Invalid Canvas sync mode' USING ERRCODE = '22023';
  END IF;
  IF completed_course_count IS NOT NULL AND completed_course_count < 0 THEN
    RAISE EXCEPTION 'Invalid Canvas course count' USING ERRCODE = '22023';
  END IF;

  UPDATE public.canvas_settings AS settings
  SET
    last_sync_at = completed_sync_at,
    last_background_sync_at = CASE
      WHEN requested_mode = 'background' THEN completed_sync_at
      ELSE settings.last_background_sync_at
    END,
    course_count = CASE
      WHEN completed_course_count IS NULL THEN settings.course_count
      ELSE completed_course_count
    END,
    sync_lease_token = NULL,
    sync_lease_expires_at = NULL
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision
    AND settings.sync_lease_expires_at > statement_timestamp();
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION release_canvas_sync_lease(
  target_user_id UUID,
  expected_lease_token UUID,
  expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  UPDATE public.canvas_settings AS settings
  SET sync_lease_token = NULL, sync_lease_expires_at = NULL
  WHERE settings.user_id = target_user_id
    AND settings.sync_lease_token = expected_lease_token
    AND settings.sync_revision = expected_revision;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION protect_canvas_sync_internal_state() FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_profile_managed_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION adjust_completed_task_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION adjust_total_study_time() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_owned_subject_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_owned_task_reference() FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_canvas_sync(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION renew_canvas_sync_lease(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_canvas_provider_request(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION release_canvas_provider_request(TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION complete_canvas_sync(UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_canvas_sync_lease(UUID, UUID, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_canvas_sync(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION renew_canvas_sync_lease(UUID, UUID, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION claim_canvas_provider_request(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION release_canvas_provider_request(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_canvas_sync(UUID, UUID, BIGINT, TEXT, TIMESTAMP WITH TIME ZONE, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_canvas_sync_lease(UUID, UUID, BIGINT) TO service_role;

-- Complete a task and create its next repeating occurrence atomically. The
-- invoker's task RLS policy remains in force and the row lock prevents two
-- tabs from forking the series.
CREATE OR REPLACE FUNCTION public.complete_task_with_successor(
  p_task_id UUID,
  p_successor JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  current_task public.tasks%ROWTYPE;
  completed_task public.tasks%ROWTYPE;
  successor_task public.tasks%ROWTYPE;
  successor_subject_id UUID;
BEGIN
  SELECT * INTO current_task
  FROM public.tasks
  WHERE id = p_task_id AND user_id = auth.uid()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;

  IF current_task.status = 'completed' THEN
    RETURN jsonb_build_object(
      'changed', FALSE,
      'completed', to_jsonb(current_task),
      'successor', NULL
    );
  END IF;

  UPDATE public.tasks
  SET status = 'completed', completed_at = statement_timestamp()
  WHERE id = current_task.id
  RETURNING * INTO completed_task;

  IF p_successor IS NOT NULL THEN
    IF NULLIF(BTRIM(p_successor->>'title'), '') IS NULL THEN
      RAISE EXCEPTION 'A recurring successor requires a title'
        USING ERRCODE = '22023';
    END IF;

    successor_subject_id := CASE
      WHEN NULLIF(p_successor->>'subject_id', '') IS NULL THEN NULL
      ELSE (p_successor->>'subject_id')::UUID
    END;

    IF successor_subject_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.subjects AS subject
         WHERE subject.id = successor_subject_id
           AND subject.user_id = current_task.user_id
       ) THEN
      RAISE EXCEPTION 'Recurring successor subject is not owned by the task owner'
        USING ERRCODE = '23503';
    END IF;

    INSERT INTO public.tasks (
      user_id, subject_id, title, description, priority, status, due_date,
      due_time, recurrence, recurrence_days, completed_at
    ) VALUES (
      current_task.user_id,
      successor_subject_id,
      BTRIM(p_successor->>'title'),
      p_successor->>'description',
      COALESCE(NULLIF(p_successor->>'priority', ''), 'medium'),
      'pending',
      CASE
        WHEN NULLIF(p_successor->>'due_date', '') IS NULL THEN NULL
        ELSE (p_successor->>'due_date')::TIMESTAMP WITH TIME ZONE
      END,
      NULLIF(p_successor->>'due_time', ''),
      COALESCE(NULLIF(p_successor->>'recurrence', ''), 'none'),
      NULLIF(p_successor->'recurrence_days', 'null'::JSONB),
      NULL
    )
    RETURNING * INTO successor_task;
  END IF;

  RETURN jsonb_build_object(
    'changed', TRUE,
    'completed', to_jsonb(completed_task),
    'successor', CASE
      WHEN successor_task.id IS NULL THEN NULL
      ELSE to_jsonb(successor_task)
    END
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_task_with_successor(UUID, JSONB)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_task_with_successor(UUID, JSONB)
TO authenticated;

COMMIT;
