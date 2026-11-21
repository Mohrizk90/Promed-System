-- 0002 Remove the Telegram bot, its MCP server and the VPS metrics collector (owner's decision,
-- 2026-11-21). The new in-app agent replaces them.
drop function if exists public.claim_telegram_link(text);
drop table if exists public.telegram_sessions cascade;
drop table if exists public.telegram_link_codes cascade;
drop table if exists public.telegram_links cascade;
drop table if exists public.bot_pending_confirmations cascade;
drop table if exists public.bot_tool_stats cascade;
drop table if exists public.bot_error_feed cascade;
drop table if exists public.bot_audit_log cascade;
drop table if exists public.bot_health_snapshots cascade;
drop table if exists public.vps_metrics cascade;
