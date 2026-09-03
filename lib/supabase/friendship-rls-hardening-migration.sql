-- Harden friendship request authorization for existing Orderly deployments.
-- Safe to run more than once after the preflight below succeeds.
--
-- IMPORTANT: older versions of this migration automatically deleted inverse
-- A->B / B->A duplicates. This version never deletes application data. Back up
-- the table, inspect the preflight query, and resolve every duplicate/self-row
-- deliberately before running the migration:
--
-- SELECT LEAST(user_id, friend_id) AS first_user,
--        GREATEST(user_id, friend_id) AS second_user,
--        COUNT(*) AS row_count,
--        ARRAY_AGG(id ORDER BY created_at, id) AS friendship_ids
-- FROM public.friendships
-- GROUP BY 1, 2
-- HAVING LEAST(user_id, friend_id) = GREATEST(user_id, friend_id)
--     OR COUNT(*) > 1;

BEGIN;

-- Fail closed instead of choosing which user data to destroy.
DO $preflight$
DECLARE
  invalid_pair_count BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO invalid_pair_count
  FROM (
    SELECT LEAST(user_id, friend_id), GREATEST(user_id, friend_id)
    FROM public.friendships
    GROUP BY 1, 2
    HAVING LEAST(user_id, friend_id) = GREATEST(user_id, friend_id)
       OR COUNT(*) > 1
  ) AS invalid_pairs;

  IF invalid_pair_count > 0 THEN
    RAISE EXCEPTION
      'Friendship preflight failed: % self/duplicate unordered pair(s) require backed-up manual review',
      invalid_pair_count;
  END IF;
END;
$preflight$;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.friendships'::regclass
      AND conname = 'friendships_no_self_request'
  ) THEN
    ALTER TABLE public.friendships
      ADD CONSTRAINT friendships_no_self_request CHECK (user_id <> friend_id);
  END IF;
END;
$constraint$;

CREATE UNIQUE INDEX IF NOT EXISTS friendships_unique_unordered_pair
  ON public.friendships (LEAST(user_id, friend_id), GREATEST(user_id, friend_id));

CREATE OR REPLACE FUNCTION public.enforce_friendship_update_invariants()
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

DROP TRIGGER IF EXISTS enforce_friendship_update_invariants ON public.friendships;
CREATE TRIGGER enforce_friendship_update_invariants
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_friendship_update_invariants();

DROP POLICY IF EXISTS "Users can create friendship requests" ON public.friendships;
DROP POLICY IF EXISTS "Users can update friendships they're part of" ON public.friendships;
DROP POLICY IF EXISTS "Recipients can respond to pending friendship requests" ON public.friendships;
DROP POLICY IF EXISTS "Participants can delete friendships" ON public.friendships;
DROP POLICY IF EXISTS "Users can view friend profiles" ON public.profiles;

-- Full profile statistics are visible only after acceptance. Pending identity
-- is exposed by the narrow function below instead of granting full-row SELECT.
CREATE POLICY "Users can view friend profiles" ON public.profiles
  FOR SELECT USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.friendships
      WHERE (
        user_id = auth.uid()
        AND friend_id = profiles.id
        AND status = 'accepted'
      ) OR (
        friend_id = auth.uid()
        AND user_id = profiles.id
        AND status = 'accepted'
      )
    )
  );

CREATE OR REPLACE FUNCTION public.get_friendships_with_profiles()
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
  FROM public.friendships AS f
  JOIN public.profiles AS p
    ON p.id = CASE WHEN f.user_id = auth.uid() THEN f.friend_id ELSE f.user_id END
  WHERE auth.uid() IS NOT NULL
    AND (f.user_id = auth.uid() OR f.friend_id = auth.uid())
    AND f.status IN ('pending', 'accepted');
$$;

REVOKE ALL ON FUNCTION public.get_friendships_with_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friendships_with_profiles() TO authenticated;

CREATE POLICY "Users can create friendship requests" ON public.friendships
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND friend_id <> auth.uid()
    AND status = 'pending'
  );

CREATE POLICY "Recipients can respond to pending friendship requests" ON public.friendships
  FOR UPDATE
  USING (auth.uid() = friend_id AND status = 'pending')
  WITH CHECK (auth.uid() = friend_id AND status IN ('accepted', 'rejected'));

CREATE POLICY "Participants can delete friendships" ON public.friendships
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

COMMIT;
