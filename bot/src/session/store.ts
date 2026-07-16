import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { promises as fs } from "node:fs";
import path from "node:path";
import { WebSocket as NodeWebSocket } from "ws";
import { loadConfig } from "../config.js";
import { logger } from "../logger.js";

const IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (durable context)
const MAX_TURNS = 24; // ~12 user/model exchanges
const FILE_PATH = process.env.BOT_SESSION_FILE || "/var/lib/promed-bot/sessions.json";

export type ChatTurn =
  | { role: "user"; parts: Array<{ text: string }> }
  | { role: "model"; parts: Array<{ text: string }> }
  | { role: "function"; name: string; response: unknown };

export type PendingConfirmation = {
  tool: string;
  args: Record<string, unknown>;
  argsHash: string;
  summary: string;
  expiresAt: number;
  nonce: string;
};

export type Session = {
  chatId: number;
  turns: ChatTurn[];
  lastToolSummary?: string;
  lastUserIntent?: string;
  pendingConfirmation?: PendingConfirmation;
  lastActivity: number;
};

type PersistedBlob = {
  sessions: Record<
    string,
    {
      turns: ChatTurn[];
      lastToolSummary?: string;
      lastUserIntent?: string;
      lastActivity: number;
    }
  >;
};

const store = new Map<number, Session>();
const loadedFromDisk = new Set<number>();

const WS_RT = NodeWebSocket as unknown as any;
const WS_GLOBAL = NodeWebSocket as unknown as typeof globalThis.WebSocket;

let _supabase: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_supabase) return _supabase;
  const cfg = loadConfig();
  _supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WS_RT },
    global: { WebSocket: WS_GLOBAL } as any,
  });
  return _supabase;
}

function now(): number {
  return Date.now();
}

function trimTurns(turns: ChatTurn[]): ChatTurn[] {
  if (turns.length <= MAX_TURNS) return turns;
  return turns.slice(turns.length - MAX_TURNS);
}

function evictExpired(): void {
  const t = now();
  for (const [chatId, s] of store) {
    if (t - s.lastActivity > IDLE_TTL_MS) store.delete(chatId);
  }
}

async function readFileBlob(): Promise<PersistedBlob> {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as PersistedBlob;
    if (!parsed || typeof parsed !== "object" || !parsed.sessions) return { sessions: {} };
    return parsed;
  } catch {
    return { sessions: {} };
  }
}

async function writeFileBlob(blob: PersistedBlob): Promise<void> {
  try {
    await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
    await fs.writeFile(FILE_PATH, JSON.stringify(blob), "utf8");
  } catch (err) {
    logger.warn({ err }, "session file write failed");
  }
}

/** Hydrate one chat from disk + Supabase (disk wins if newer). */
async function hydrate(chatId: number): Promise<void> {
  if (loadedFromDisk.has(chatId)) return;
  loadedFromDisk.add(chatId);

  let fileTurns: ChatTurn[] = [];
  let fileSummary: string | undefined;
  let fileIntent: string | undefined;
  let fileActivity = 0;

  const blob = await readFileBlob();
  const fileRow = blob.sessions[String(chatId)];
  if (fileRow) {
    fileTurns = Array.isArray(fileRow.turns) ? fileRow.turns : [];
    fileSummary = fileRow.lastToolSummary;
    fileIntent = fileRow.lastUserIntent;
    fileActivity = fileRow.lastActivity || 0;
  }

  let dbTurns: ChatTurn[] = [];
  let dbSummary: string | undefined;
  let dbIntent: string | undefined;
  let dbActivity = 0;
  try {
    const { data, error } = await db()
      .from("telegram_sessions")
      .select("turns,last_tool_summary,last_user_intent,updated_at")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (!error && data) {
      dbTurns = Array.isArray(data.turns) ? (data.turns as ChatTurn[]) : [];
      dbSummary = data.last_tool_summary ?? undefined;
      dbIntent = data.last_user_intent ?? undefined;
      dbActivity = data.updated_at ? Date.parse(data.updated_at) : 0;
    }
  } catch (err) {
    logger.warn({ err }, "session supabase load failed (table may be missing)");
  }

  // Prefer whichever store is more recent.
  const useFile = fileActivity >= dbActivity && fileTurns.length > 0;
  const turns = trimTurns(useFile ? fileTurns : dbTurns.length ? dbTurns : fileTurns);
  const lastToolSummary = useFile ? fileSummary : dbSummary ?? fileSummary;
  const lastUserIntent = useFile ? fileIntent : dbIntent ?? fileIntent;
  const lastActivity = Math.max(fileActivity, dbActivity, now());

  if (turns.length || lastToolSummary || lastUserIntent) {
    const existing = store.get(chatId);
    if (!existing || existing.turns.length === 0) {
      store.set(chatId, {
        chatId,
        turns,
        lastToolSummary,
        lastUserIntent,
        lastActivity,
      });
    }
  }
}

export async function getSession(chatId: number): Promise<Session> {
  evictExpired();
  await hydrate(chatId);
  let s = store.get(chatId);
  if (!s) {
    s = { chatId, turns: [], lastActivity: now() };
    store.set(chatId, s);
  }
  s.lastActivity = now();
  if (s.pendingConfirmation && s.pendingConfirmation.expiresAt < now()) {
    delete s.pendingConfirmation;
  }
  return s;
}

/** Persist after each completed turn. Fire-and-forget safe. */
export function persistSession(session: Session): void {
  session.turns = trimTurns(session.turns);
  session.lastActivity = now();
  store.set(session.chatId, session);

  void (async () => {
    // File fallback (survives restarts even before SQL migration).
    const blob = await readFileBlob();
    blob.sessions[String(session.chatId)] = {
      turns: session.turns,
      lastToolSummary: session.lastToolSummary,
      lastUserIntent: session.lastUserIntent,
      lastActivity: session.lastActivity,
    };
    await writeFileBlob(blob);

    try {
      const { error } = await db()
        .from("telegram_sessions")
        .upsert(
          {
            chat_id: session.chatId,
            turns: session.turns,
            last_tool_summary: session.lastToolSummary ?? null,
            last_user_intent: session.lastUserIntent ?? null,
            updated_at: new Date(session.lastActivity).toISOString(),
          },
          { onConflict: "chat_id" },
        );
      if (error) {
        // Table may not exist yet — file persistence still works.
        logger.warn({ err: error.message }, "session supabase upsert failed");
      }
    } catch (err) {
      logger.warn({ err }, "session supabase upsert threw");
    }
  })();
}

export function clearPendingFor(chatId: number): void {
  const s = store.get(chatId);
  if (s) delete s.pendingConfirmation;
}

export function forget(chatId: number): void {
  store.delete(chatId);
  loadedFromDisk.delete(chatId);
  void (async () => {
    const blob = await readFileBlob();
    delete blob.sessions[String(chatId)];
    await writeFileBlob(blob);
    await db().from("telegram_sessions").delete().eq("chat_id", chatId);
  })();
}

export function activeSessionCount(): number {
  return store.size;
}

/** Build a compact context block for the system prompt / user preamble. */
export function formatSessionContext(session: Session): string {
  const lines: string[] = [];
  if (session.lastUserIntent) {
    lines.push(`LAST_USER_INTENT: ${session.lastUserIntent}`);
  }
  if (session.lastToolSummary) {
    lines.push(`LAST_TOOL_SUMMARY: ${session.lastToolSummary}`);
  }
  const recent = session.turns.slice(-6);
  if (recent.length) {
    lines.push("RECENT_TURNS:");
    for (const t of recent) {
      if (t.role === "user") {
        lines.push(`- user: ${t.parts.map((p) => p.text).join(" ")}`);
      } else if (t.role === "model") {
        lines.push(`- assistant: ${t.parts.map((p) => p.text).join(" ").slice(0, 200)}`);
      }
    }
  }
  return lines.join("\n");
}
