-- =============================================================================
-- Promed: Telegram account-link codes and claim RPC
-- =============================================================================
-- Stores short-lived, single-use codes generated for a Supabase user so a
-- Telegram bot can complete account linking. The owner can read their codes;
-- the service role creates them and the SECURITY DEFINER RPC marks them used.
-- Example queries:
--   SELECT code, expires_at FROM public.telegram_link_codes WHERE user_id = auth.uid();
--   SELECT public.claim_telegram_link('A1B2C3');
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_link_codes (
    code TEXT PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9]{6}$'),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_link_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_link_codes_select ON public.telegram_link_codes;
CREATE POLICY telegram_link_codes_select
    ON public.telegram_link_codes
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.claim_telegram_link(p_code TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    ASSERT auth.uid() IS NOT NULL, 'not authenticated';

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'not authenticated';
    END IF;

    UPDATE public.telegram_link_codes
    SET used_at = NOW()
    WHERE code = p_code
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING user_id INTO v_user_id;

    IF v_user_id IS NULL OR v_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'invalid code';
    END IF;

    RETURN 'ok';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_telegram_link(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_telegram_link(TEXT) TO authenticated;
