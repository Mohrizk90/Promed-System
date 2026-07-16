import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket as NodeWebSocket } from "ws";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";

// See mcp/src/supabase/userClient.ts for the cast rationale.
const WS_RT = NodeWebSocket as unknown as any;
const WS_GLOBAL = NodeWebSocket as unknown as typeof globalThis.WebSocket;

/** Public API (camelCase). Internal writers translate to the snake_case column
 *  names defined in Supabase/supabase_bot_audit.sql. */

export type AuditEntry = {
  chatId: number | null;
  userId: string | null;
  toolName: string;
  toolKind: "read" | "write";
  argsHash: string | null;
  ok: boolean;
  error: string | null;
  durationMs: number | null;
};

export type ToolStatsRollup = {
  bucketStart: string; // ISO timestamp truncated to 5 min
  toolName: string;
  calls: number;
  errors: number;
  avgDurationMs: number | null;
};

/** `severity` is constrained in the DB to `warn | error`. We map everything
 *  noisier than `info` to one of those two. */
export type ErrorEntry = {
  source: "telegram" | "gemini" | "mcp" | "supabase" | "bot" | "other";
  severity: "debug" | "info" | "warn" | "error" | "fatal";
  message: string;
  ctx: Record<string, unknown> | null;
};

export type PendingConfirmation = {
  chatId: number;
  userId: string | null;
  toolName: string;
  argsHash: string;
  args: Record<string, unknown>;
  summary: string;
  expiresAt: string; // ISO
};

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_supabase) return _supabase;
  const cfg = loadConfig();
  _supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // See mcp/src/supabase/userClient.ts — Supabase 2.110+ requires a
    // user-provided WebSocket on Node <22 even though we never subscribe.
    realtime: { transport: WS_RT },
    global: { WebSocket: WS_GLOBAL } as any,
  });
  return _supabase;
}

function severityToDb(s: ErrorEntry["severity"]): "warn" | "error" {
  if (s === "error" || s === "fatal") return "error";
  return "warn";
}

/** Fire-and-forget audit write. Errors are logged but never thrown to the caller. */
export function writeAudit(entry: AuditEntry): void {
  db()
    .from("bot_audit_log")
    .insert({
      telegram_chat_id: entry.chatId,
      user_id: entry.userId,
      tool_name: entry.toolName,
      // The schema doesn't have a separate tool_kind column. We fold it into
      // args_json so the dashboard can distinguish read vs write at query time.
      args_json: { kind: entry.toolKind, args_hash: entry.argsHash },
      result_status: entry.ok ? "ok" : "error",
      error_text: entry.error,
      latency_ms: entry.durationMs,
      source: "bot",
    })
    .then(({ error }) => {
      if (error) logger.warn({ err: error.message, entry }, "audit insert failed");
    })
    .then(undefined, (err: unknown) => {
      logger.warn({ err }, "audit insert threw");
    });
}

export function writeToolStats(rollup: ToolStatsRollup): void {
  // Schema columns: bucket_start (PK), tool_name, calls_total, calls_ok,
  // calls_error, calls_denied, latency_p50, latency_p95, token_in, token_out,
  // cost_usd. We only have a single calls/errors avg — assume all non-error
  // calls were `ok` and bucket `denied` into `error`.
  db()
    .from("bot_tool_stats")
    .upsert(
      {
        bucket_start: rollup.bucketStart,
        tool_name: rollup.toolName,
        calls_total: rollup.calls,
        calls_ok: Math.max(0, rollup.calls - rollup.errors),
        calls_error: rollup.errors,
        calls_denied: 0,
        latency_p50: rollup.avgDurationMs,
        latency_p95: rollup.avgDurationMs,
        token_in: 0,
        token_out: 0,
        cost_usd: 0,
      },
      { onConflict: "bucket_start,tool_name" },
    )
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
    .insert({
      source: entry.source,
      severity: severityToDb(entry.severity),
      message: entry.message,
      context_json: entry.ctx ?? {},
    })
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
        chat_id: p.chatId,
        user_id: p.userId,
        tool_name: p.toolName,
        args_hash: p.argsHash,
        args_json: p.args,
        summary: p.summary,
        expires_at: p.expiresAt,
      },
      { onConflict: "chat_id" },
    )
    .then(({ error }) => {
      if (error)
        logger.warn({ err: error.message, chatId: p.chatId }, "upsertPending failed");
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
  uptimeS: number | null;
  geminiOk: boolean | null;
  mcpOk: boolean | null;
  telegramOk: boolean | null;
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
    .upsert(
      {
        source: snap.source,
        ts: snap.ts,
        status: snap.status,
        uptime_s: snap.uptimeS,
        gemini_ok: snap.geminiOk,
        mcp_ok: snap.mcpOk,
        telegram_ok: snap.telegramOk,
      },
      { onConflict: "source,ts" },
    )
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
