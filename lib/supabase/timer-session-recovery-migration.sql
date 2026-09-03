-- Preserve an exact, idempotent study-session payload when a timer finishes
-- but the study_sessions write cannot be confirmed. Safe to run repeatedly.
ALTER TABLE public.timer_states
  ADD COLUMN IF NOT EXISTS pending_session JSONB;

COMMENT ON COLUMN public.timer_states.pending_session IS
  'Exact failed study-session payload and post-save timer outcome for retry recovery.';
