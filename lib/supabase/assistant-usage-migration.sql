-- Durable, per-user DeepSeek request quotas for Orderly Assistant.
-- Additive and idempotent: safe to run more than once in Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS assistant_ai_usage (
  request_id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'completed', 'failed')),
  provider TEXT NOT NULL DEFAULT 'deepseek',
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0 CHECK (prompt_tokens >= 0),
  completion_tokens INTEGER NOT NULL DEFAULT 0 CHECK (completion_tokens >= 0),
  total_tokens INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_assistant_ai_usage_user_created
  ON assistant_ai_usage(user_id, created_at DESC)
  WHERE status IN ('reserved', 'completed');

ALTER TABLE assistant_ai_usage ENABLE ROW LEVEL SECURITY;

-- Usage details and reservation UUIDs are intentionally server-only. The API
-- returns only remaining counts; exposing active request IDs would let a
-- browser mark an in-flight reservation as failed.
DROP POLICY IF EXISTS "Users view own Assistant usage" ON assistant_ai_usage;
REVOKE ALL ON assistant_ai_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION assistant_reserve_ai_request(
  p_request_id UUID,
  p_daily_limit INTEGER DEFAULT 10,
  p_monthly_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  allowed BOOLEAN,
  daily_used INTEGER,
  monthly_used INTEGER,
  daily_limit INTEGER,
  monthly_limit INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_daily_limit INTEGER := LEAST(GREATEST(COALESCE(p_daily_limit, 10), 1), 1000);
  v_monthly_limit INTEGER := LEAST(GREATEST(COALESCE(p_monthly_limit, 100), 1), 20000);
  v_daily_used INTEGER;
  v_monthly_used INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Serialize quota checks for one account so simultaneous requests cannot
  -- both pass the count and overspend the user's allowance.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user_id::TEXT, 0));

  SELECT COUNT(*)::INTEGER
    INTO v_daily_used
    FROM assistant_ai_usage AS usage_row
   WHERE usage_row.user_id = v_user_id
     AND usage_row.status IN ('reserved', 'completed')
     AND usage_row.created_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  SELECT COUNT(*)::INTEGER
    INTO v_monthly_used
    FROM assistant_ai_usage AS usage_row
   WHERE usage_row.user_id = v_user_id
     AND usage_row.status IN ('reserved', 'completed')
     AND usage_row.created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_daily_used >= v_daily_limit OR v_monthly_used >= v_monthly_limit THEN
    RETURN QUERY SELECT FALSE, v_daily_used, v_monthly_used, v_daily_limit, v_monthly_limit;
    RETURN;
  END IF;

  INSERT INTO assistant_ai_usage (request_id, user_id, status)
  VALUES (p_request_id, v_user_id, 'reserved')
  ON CONFLICT (request_id) DO NOTHING;

  -- A duplicate request UUID should never buy a second provider call.
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, v_daily_used, v_monthly_used, v_daily_limit, v_monthly_limit;
    RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, v_daily_used + 1, v_monthly_used + 1, v_daily_limit, v_monthly_limit;
END;
$$;

CREATE OR REPLACE FUNCTION assistant_complete_ai_request(
  p_request_id UUID,
  p_prompt_tokens INTEGER DEFAULT 0,
  p_completion_tokens INTEGER DEFAULT 0,
  p_total_tokens INTEGER DEFAULT 0,
  p_model TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE assistant_ai_usage
     SET status = 'completed',
         prompt_tokens = LEAST(GREATEST(COALESCE(p_prompt_tokens, 0), 0), 10000000),
         completion_tokens = LEAST(GREATEST(COALESCE(p_completion_tokens, 0), 0), 10000000),
         total_tokens = LEAST(GREATEST(COALESCE(p_total_tokens, 0), 0), 20000000),
         model = LEFT(NULLIF(TRIM(p_model), ''), 120),
         completed_at = NOW()
   WHERE request_id = p_request_id
     AND user_id = auth.uid()
     AND status = 'reserved';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION assistant_fail_ai_request(p_request_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  UPDATE assistant_ai_usage
     SET status = 'failed', completed_at = NOW()
   WHERE request_id = p_request_id
     AND user_id = auth.uid()
     AND status = 'reserved';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION assistant_reserve_ai_request(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION assistant_complete_ai_request(UUID, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION assistant_fail_ai_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assistant_reserve_ai_request(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION assistant_complete_ai_request(UUID, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION assistant_fail_ai_request(UUID) TO authenticated;

COMMENT ON TABLE assistant_ai_usage IS
  'Per-request Orderly Assistant quota ledger and provider token usage, reset by UTC day/month.';
