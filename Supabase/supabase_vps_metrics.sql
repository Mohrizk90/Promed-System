-- =============================================================================
-- Promed: VPS and service monitoring metrics
-- =============================================================================
-- Stores timestamped host metrics used by the operations dashboard, including
-- resource usage and bot/MCP/Telegram availability. Any authenticated user can
-- read global metrics; the service role used by collectors writes metric rows.
-- Example queries:
--   SELECT * FROM public.vps_metrics WHERE host = 'smops' ORDER BY ts DESC;
--   SELECT metric, value_num FROM public.vps_metrics WHERE host = 'smops' AND ts > now() - interval '1 hour';
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vps_metrics (
    host TEXT NOT NULL,
    metric TEXT NOT NULL CHECK (metric IN (
        'cpu_pct',
        'mem_pct',
        'disk_pct',
        'net_in_bps',
        'net_out_bps',
        'bot_up',
        'mcp_up',
        'telegram_queue_lag',
        'collector_mode'
    )),
    value_num DOUBLE PRECISION,
    value_text TEXT,
    tags JSONB,
    ts TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (host, metric, ts)
);

-- Idempotent in-place migration for older installs (the table was created
-- without a `tags` column; the collector now writes JSON metadata with each
-- metric row; the metric CHECK constraint was missing 'collector_mode').
ALTER TABLE public.vps_metrics ADD COLUMN IF NOT EXISTS tags JSONB;

-- Rewrite the metric CHECK to include every value the collectors emit.
-- We don't rely on CREATE TABLE IF NOT EXISTS here because the table is
-- already there — its CHECK may still be the narrower original.
ALTER TABLE public.vps_metrics
    DROP CONSTRAINT IF EXISTS vps_metrics_metric_check;
ALTER TABLE public.vps_metrics
    ADD CONSTRAINT vps_metrics_metric_check
    CHECK (metric IN (
        'cpu_pct',
        'mem_pct',
        'disk_pct',
        'net_in_bps',
        'net_out_bps',
        'bot_up',
        'mcp_up',
        'telegram_queue_lag',
        'collector_mode'
    ));

CREATE INDEX IF NOT EXISTS idx_vps_metrics_host_metric_ts
    ON public.vps_metrics(host, metric, ts DESC);

ALTER TABLE public.vps_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vps_metrics_select ON public.vps_metrics;
CREATE POLICY vps_metrics_select
    ON public.vps_metrics
    FOR SELECT
    TO authenticated
    USING (TRUE);
