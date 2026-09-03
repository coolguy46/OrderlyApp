-- Competitions are not an active product feature yet. Keep the dormant tables
-- inaccessible to browser roles so users cannot enumerate drafts or forge
-- leaderboard scores before a server-managed scoring model is launched.
-- Safe to run more than once.

BEGIN;

DROP POLICY IF EXISTS "Anyone can view competitions" ON public.competitions;
DROP POLICY IF EXISTS "Users can create competitions" ON public.competitions;
DROP POLICY IF EXISTS "Creators can update their competitions" ON public.competitions;

DROP POLICY IF EXISTS "Anyone can view competition participants" ON public.competition_participants;
DROP POLICY IF EXISTS "Users can join competitions" ON public.competition_participants;
DROP POLICY IF EXISTS "Users can update their own participation" ON public.competition_participants;

REVOKE ALL ON TABLE public.competitions FROM anon, authenticated;
REVOKE ALL ON TABLE public.competition_participants FROM anon, authenticated;

COMMENT ON TABLE public.competitions IS
  'Dormant until competition visibility and server-managed scoring are implemented.';
COMMENT ON TABLE public.competition_participants IS
  'Dormant until participant admission and score mutation are server-managed.';

COMMIT;
