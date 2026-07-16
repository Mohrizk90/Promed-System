-- =============================================================================
-- Promed: Telegram chat links
-- =============================================================================
-- Stores the mapping between a Telegram chat and a Supabase account so the bot
-- can identify the signed-in user. Owners can read and update their own link;
-- the service role used by the bot inserts links and updates activity metadata.
-- Example queries:
--   SELECT * FROM public.telegram_links WHERE user_id = auth.uid();
--   UPDATE public.telegram_links SET last_seen_at = now() WHERE chat_id = 123;
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_links (
    chat_id BIGINT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    telegram_username TEXT,
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

-- Idempotent column rename for installs that applied the older schema.
-- The columns are renamed only if they currently exist under the old names;
-- on fresh installs the CREATE TABLE above already has the new names.
DO $$
BEGIN
    -- telegram_chat_id -> chat_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='telegram_links'
              AND column_name='telegram_chat_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='telegram_links'
              AND column_name='chat_id'
    ) THEN
        -- Policies and indexes that reference the old column must come down
        -- before the rename; they are recreated below.
        DROP POLICY IF EXISTS telegram_links_select ON public.telegram_links;
        DROP POLICY IF EXISTS telegram_links_update ON public.telegram_links;
        DROP INDEX IF EXISTS idx_telegram_links_supabase_user_id;
        ALTER TABLE public.telegram_links RENAME COLUMN telegram_chat_id TO chat_id;
    END IF;

    -- supabase_user_id -> user_id
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='telegram_links'
              AND column_name='supabase_user_id'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='telegram_links'
              AND column_name='user_id'
    ) THEN
        -- The FK constraint to auth.users doesn't change in semantics,
        -- but its auto-generated name incorporates the old column name,
        -- so we drop and recreate it explicitly.
        ALTER TABLE public.telegram_links
            DROP CONSTRAINT IF EXISTS telegram_links_supabase_user_id_fkey;
        ALTER TABLE public.telegram_links
            DROP CONSTRAINT IF EXISTS telegram_links_user_id_fkey;
        ALTER TABLE public.telegram_links RENAME COLUMN supabase_user_id TO user_id;
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_telegram_links_user_id
    ON public.telegram_links(user_id);

ALTER TABLE public.telegram_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telegram_links_select ON public.telegram_links;
CREATE POLICY telegram_links_select
    ON public.telegram_links
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS telegram_links_update ON public.telegram_links;
CREATE POLICY telegram_links_update
    ON public.telegram_links
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
