-- =============================================================================
-- Promed: Telegram bot and MCP audit/monitoring tables
-- =============================================================================
-- These tables record tool calls, aggregate tool statistics, pending bot
-- confirmations, errors, and service health snapshots. Owners read their own
-- audit rows; authenticated users read global monitoring rows; the service
-- role used by the bot/MCP service writes and upserts operational data.
-- Pending confirmations currently allow authenticated reads for internal
-- monitoring; tighten this with an is_admin column if a stricter boundary is
-- needed later.
-- Example queries:
--   SELECT * FROM public.bot_audit_log WHERE user_id = auth.uid() ORDER BY created_at DESC;
--   SELECT * FROM public.bot_tool_stats ORDER BY bucket_start DESC;
--   SELECT * FROM public.bot_error_feed ORDER BY created_at DESC;
--   SELECT * FROM public.bot_health_snapshots ORDER BY ts DESC;
-- =============================================================================

-- Individual bot and MCP tool executions.
CREATE TABLE IF NOT EXISTS public.bot_audit_log (
    id BIGSERIAL PRIMARY KEY,
    telegram_chat_id BIGINT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    tool_name TEXT NOT NULL,
    args_json JSONB,
    result_status TEXT NOT NULL CHECK (result_status IN ('ok', 'error', 'denied')),
    error_text TEXT,
    latency_ms INTEGER,
    token_in INTEGER,
    token_out INTEGER,
    cost_usd NUMERIC(10, 6),
    source TEXT NOT NULL DEFAULT 'bot' CHECK (source IN ('bot', 'mcp')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_audit_log_user_created
    ON public.bot_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_audit_log_tool_created
    ON public.bot_audit_log(tool_name, created_at DESC);

ALTER TABLE public.bot_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_audit_log_select ON public.bot_audit_log;
CREATE POLICY bot_audit_log_select
    ON public.bot_audit_log
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Time-bucketed global tool metrics for dashboards.
CREATE TABLE IF NOT EXISTS public.bot_tool_stats (
    bucket_start TIMESTAMPTZ NOT NULL,
    tool_name TEXT NOT NULL,
    calls_total INTEGER NOT NULL DEFAULT 0,
    calls_ok INTEGER NOT NULL DEFAULT 0,
    calls_error INTEGER NOT NULL DEFAULT 0,
    calls_denied INTEGER NOT NULL DEFAULT 0,
    latency_p50 INTEGER,
    latency_p95 INTEGER,
    token_in BIGINT NOT NULL DEFAULT 0,
    token_out BIGINT NOT NULL DEFAULT 0,
    cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, tool_name)
);

ALTER TABLE public.bot_tool_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_tool_stats_select ON public.bot_tool_stats;
CREATE POLICY bot_tool_stats_select
    ON public.bot_tool_stats
    FOR SELECT
    TO authenticated
    USING (TRUE);

-- Pending tool confirmations awaiting a Telegram response.
CREATE TABLE IF NOT EXISTS public.bot_pending_confirmations (
    chat_id BIGINT PRIMARY KEY,
    user_id UUID,
    tool_name TEXT NOT NULL,
    args_json JSONB NOT NULL,
    summary TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.bot_pending_confirmations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_pending_confirmations_select ON public.bot_pending_confirmations;
CREATE POLICY bot_pending_confirmations_select
    ON public.bot_pending_confirmations
    FOR SELECT
    TO authenticated
    USING (TRUE);

-- Global warning and error events from the bot, MCP, and collectors.
CREATE TABLE IF NOT EXISTS public.bot_error_feed (
    id BIGSERIAL PRIMARY KEY,
    source TEXT NOT NULL CHECK (source IN ('bot', 'mcp', 'collector', 'telegram')),
    severity TEXT NOT NULL CHECK (severity IN ('warn', 'error')),
    message TEXT NOT NULL,
    context_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_error_feed_created
    ON public.bot_error_feed(created_at DESC);

ALTER TABLE public.bot_error_feed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_error_feed_select ON public.bot_error_feed;
CREATE POLICY bot_error_feed_select
    ON public.bot_error_feed
    FOR SELECT
    TO authenticated
    USING (TRUE);

-- Periodic health readings for the bot and MCP services.
CREATE TABLE IF NOT EXISTS public.bot_health_snapshots (
    source TEXT NOT NULL CHECK (source IN ('bot', 'mcp')),
    ts TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'down')),
    uptime_s INTEGER,
    gemini_ok BOOLEAN,
    mcp_ok BOOLEAN,
    telegram_ok BOOLEAN,
    PRIMARY KEY (source, ts)
);

ALTER TABLE public.bot_health_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_health_snapshots_select ON public.bot_health_snapshots;
CREATE POLICY bot_health_snapshots_select
    ON public.bot_health_snapshots
    FOR SELECT
    TO authenticated
    USING (TRUE);
