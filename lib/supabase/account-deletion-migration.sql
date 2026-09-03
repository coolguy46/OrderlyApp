-- Durable, retryable account deletion. Apply before deploying the application
-- route that enqueues deletion requests. The queue intentionally has no
-- foreign key to auth.users so it survives deletion of the Auth identity.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
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

COMMENT ON TABLE public.account_deletion_requests IS
  'Service-role-only durable queue for bounded Storage cleanup and Auth deletion.';

CREATE INDEX IF NOT EXISTS idx_account_deletion_requests_due
ON public.account_deletion_requests(next_attempt_at, requested_at)
WHERE status IN ('queued', 'retry', 'processing');

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.account_deletion_requests TO service_role;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_requests(
  request_limit INTEGER DEFAULT 3,
  requested_user_id UUID DEFAULT NULL
)
RETURNS SETOF public.account_deletion_requests
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
    FROM public.account_deletion_requests AS request
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
  UPDATE public.account_deletion_requests AS request
  SET status = 'processing',
      attempts = request.attempts + 1,
      lease_token = public.uuid_generate_v4(),
      lease_expires_at = statement_timestamp() + interval '2 minutes',
      updated_at = statement_timestamp()
  FROM candidates
  WHERE request.user_id = candidates.user_id
  RETURNING request.*;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_account_deletion_requests(INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_requests(INTEGER, UUID) TO service_role;

COMMIT;
