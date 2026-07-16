-- =============================================================================
-- Promed: Telegram chat links
-- =============================================================================
-- Stores the mapping between a Telegram chat and a Supabase account so the bot
-- can identify the signed-in user. Owners can read and update their own link;
-- the service role used by the bot inserts links and updates activity metadata.
-- Example queries:
--   SELECT * FROM public.telegram_links WHERE supabase_user_id = auth.uid();
--   UPDATE public.telegram_links SET last_seen_at = now() WHERE telegram_chat_id = 123;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_links (
    telegram_chat_id BIGINT PRIMARY KEY,
    supabase_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    telegram_username TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_telegram_links_supabase_user_id
    ON public.telegram_links(supabase_user_id);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_links_select ON public.telegram_links;
CREATE POLICY telegram_links_select
    ON public.telegram_links
    FOR SELECT
    TO authenticated
    USING (auth.uid() = supabase_user_id);

DROP POLICY IF EXISTS telegram_links_update ON public.telegram_links;
CREATE POLICY telegram_links_update
    ON public.telegram_links
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = supabase_user_id)
    WITH CHECK (auth.uid() = supabase_user_id);
