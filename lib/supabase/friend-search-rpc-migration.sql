-- Enable exact-email friend discovery without making the profile directory or
-- partial email addresses enumerable. Safe to run more than once.

CREATE OR REPLACE FUNCTION public.search_profiles_for_friendship(search_query TEXT)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.email, p.full_name, p.avatar_url
  FROM public.profiles AS p
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles AS caller WHERE caller.id = auth.uid())
    AND p.id <> auth.uid()
    AND LENGTH(TRIM(search_query)) >= 5
    AND LOWER(p.email) = LOWER(TRIM(search_query))
    AND NOT EXISTS (
      SELECT 1 FROM public.friendships AS f
      WHERE (f.user_id = auth.uid() AND f.friend_id = p.id)
         OR (f.friend_id = auth.uid() AND f.user_id = p.id)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.search_profiles_for_friendship(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles_for_friendship(TEXT) TO authenticated;
