-- Billing checkout infrastructure. Review/apply explicitly; no existing records rewritten.
BEGIN;
CREATE TABLE IF NOT EXISTS public.billing_accounts (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id text UNIQUE,
  attempt_id uuid NOT NULL DEFAULT gen_random_uuid(),
  attempt_started_at timestamptz NOT NULL DEFAULT now(),
  checkout_session_id text UNIQUE,
  closed boolean NOT NULL DEFAULT false,
  lease_token uuid,
  lease_expires_at timestamptz
);
ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS attempt_trial_days smallint
  CONSTRAINT billing_attempt_trial_days_valid CHECK (attempt_trial_days IN (0, 7));
CREATE TABLE IF NOT EXISTS public.billing_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  stripe_created bigint NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.billing_accounts, public.billing_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.billing_accounts, public.billing_webhook_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_billing_account(p_user_id uuid, p_token uuid)
RETURNS SETOF public.billing_accounts LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF p_user_id IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'Missing billing owner or lease'; END IF;
  IF EXISTS (SELECT 1 FROM public.account_deletion_requests WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Account deletion is in progress';
  END IF;
  INSERT INTO public.billing_accounts(user_id) VALUES(p_user_id) ON CONFLICT DO NOTHING;
  RETURN QUERY UPDATE public.billing_accounts
    SET lease_token = p_token, lease_expires_at = statement_timestamp() + interval '120 seconds'
    WHERE user_id = p_user_id AND (lease_expires_at IS NULL OR lease_expires_at < statement_timestamp())
    RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.claim_billing_account(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_account(uuid, uuid) TO service_role;

-- Protect queued/admin deletion too: the recurring-payment owner must first be
-- closed through the server's Stripe cancellation/checkout reconciliation.
CREATE OR REPLACE FUNCTION public.guard_billing_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.billing_accounts WHERE user_id = OLD.id AND customer_id IS NOT NULL AND NOT closed) THEN
    RAISE EXCEPTION 'Billing must be closed before account deletion';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.guard_billing_account_deletion() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_orderly_billing_deletion ON auth.users;
CREATE TRIGGER guard_orderly_billing_deletion BEFORE DELETE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.guard_billing_account_deletion();
COMMIT;
