import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";

export type AuditEntry = {
  chat_id: number;
  user_id: string | null;
  tool_name: string;
  tool_kind: "read" | "write";
  args_hash: string | null;
  ok: boolean;
  error: string | null;
  duration_ms: number | null;
};

export type ToolStatsRollup = {
  bucket_5min: string; // ISO timestamp truncated to 5 min
  tool_name: string;
  calls: number;
  errors: number;
  avg_duration_ms: number | null;
};

export type ErrorEntry = {
  source: "telegram" | "gemini" | "mcp" | "supabase" | "other";
  severity: "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  ctx: Record<string, unknown> | null;
};

export type PendingConfirmation = {
  chat_id: number;
  user_id: string | null;
  nonce: string;
  tool: string;
  args_hash: string;
  args: Record<string, unknown>;
  summary: string;
  expires_at: string; // ISO
};

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_supabase) return _supabase;
  const cfg = loadConfig();
  _supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

/** Fire-and-forget audit write. Errors are logged but never thrown to the caller. */
export function writeAudit(entry: AuditEntry): void {
  db()
    .from("bot_audit_log")
    .insert(entry)
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, entry }, "audit insert failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "audit insert threw");
    });
}

export function writeToolStats(rollup: ToolStatsRollup): void {
  db()
    .from("bot_tool_stats")
    .upsert(rollup, { onConflict: "bucket_5min,tool_name" })
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, rollup }, "tool stats upsert failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "tool stats threw");
    });
}

export function writeError(entry: ErrorEntry): void {
  db()
    .from("bot_error_feed")
    .insert(entry)
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, entry }, "error feed insert failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "error feed threw");
    });
}

export function upsertPending(p: PendingConfirmation): void {
  db()
    .from("bot_pending_confirmations")
    .upsert(
      {
        chat_id: p.chat_id,
        user_id: p.user_id,
        nonce: p.nonce,
        tool: p.tool,
        args_hash: p.args_hash,
        args: p.args,
        summary: p.summary,
        expires_at: p.expires_at,
      },
      { onConflict: "chat_id" },
    )
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, nonce: p.nonce }, "upsertPending failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "upsertPending threw");
    });
}

export function clearPending(chatId: number): void {
  db()
    .from("bot_pending_confirmations")
    .delete()
    .eq("chat_id", chatId)
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, chatId }, "clearPending failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "clearPending threw");
    });
}

export type HealthSnapshot = {
  source: "bot" | "mcp";
  ts: string; // ISO, truncated to the minute so consecutive inserts from the
              // same service in the same minute upsert into a single row.
  status: "ok" | "degraded" | "down";
  uptime_s: number | null;
  gemini_ok: boolean | null;
  mcp_ok: boolean | null;
  telegram_ok: boolean | null;
};

/** Truncate to the start of the current minute. Lets multiple writes within
 *  the same minute collapse into a single row keyed by (source, ts). */
export function minuteBucket(d: Date = new Date()): string {
  const t = Math.floor(d.getTime() / 60_000) * 60_000;
  return new Date(t).toISOString();
}

export function writeHealthSnapshot(snap: HealthSnapshot): void {
  db()
    .from("bot_health_snapshots")
    .upsert(snap, { onConflict: "source,ts" })
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, snap }, "health snapshot upsert failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "health snapshot threw");
    });
}

/**
 * Truncate an ISO timestamp to the start of its 5-minute bucket.
 * Used to key rollups so multiple rows for the same tool collapse into one.
 */
export function fiveMinBucket(d: Date = new Date()): string {
  const ms = 5 * 60_000;
  const t = Math.floor(d.getTime() / ms) * ms;
  return new Date(t).toISOString();
}
