-- =============================================================================
-- Promed: Telegram bot conversation sessions (durable history)
-- =============================================================================
-- The bot previously kept chat history only in process memory, so every
-- systemd restart wiped context ("I can't find your last request").
-- This table stores a capped turn list per Telegram chat_id.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.telegram_sessions (
    chat_id BIGINT PRIMARY KEY,
    turns JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_tool_summary TEXT,
    last_user_intent TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;

-- Bot uses the service role (bypasses RLS). Authenticated users can read their
-- own session only if linked via telegram_links.
DROP POLICY IF EXISTS telegram_sessions_select ON public.telegram_sessions;
CREATE POLICY telegram_sessions_select
    ON public.telegram_sessions
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.telegram_links tl
            WHERE tl.chat_id = telegram_sessions.chat_id
              AND tl.user_id = auth.uid()
        )
    );

COMMENT ON TABLE public.telegram_sessions IS
  'Durable Telegram chat history for the Promed bot (service-role read/write).';
