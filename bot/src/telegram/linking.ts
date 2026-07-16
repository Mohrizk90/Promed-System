import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadConfig } from "../config.js";

let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_db) return _db;
  const cfg = loadConfig();
  _db = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _db;
}

export type LinkCode = {
  code: string;
  user_id: string | null;
  expires_at: string;
};

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // skip 0/O/1/I for legibility

export function generateCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * ALPHABET.length);
    out += ALPHABET.charAt(idx);
  }
  return out;
}

export async function createLinkCode(): Promise<LinkCode> {
  const code = generateCode(6);
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
  const { error } = await db()
    .from("telegram_link_codes")
    .insert({ code, user_id: null, expires_at: expiresAt });
  if (error) throw new Error(`createLinkCode: ${error.message}`);
  return { code, user_id: null, expires_at: expiresAt };
}

export type LinkedUser = {
  chat_id: number;
  user_id: string;
  email: string | null;
  last_seen_at: string | null;
};

/** Resolve a Telegram chat to its linked Supabase user (if any). */
export async function resolveLink(chatId: number): Promise<LinkedUser | null> {
  const { data, error } = await db()
    .from("telegram_links")
    .select("chat_id,user_id,last_seen_at")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (error) {
    throw new Error(`resolveLink: ${error.message}`);
  }
  if (!data) return null;

  // Look up email via the auth admin API (service role only).
  const admin = db().auth.admin;
  let email: string | null = null;
  try {
    const { data: user } = await admin.getUserById(data.user_id);
    email = user?.user?.email ?? null;
  } catch {
    email = null;
  }

  return {
    chat_id: data.chat_id,
    user_id: data.user_id,
    email,
    last_seen_at: data.last_seen_at,
  };
}

export async function touchLastSeen(chatId: number): Promise<void> {
  await db()
    .from("telegram_links")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("chat_id", chatId);
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
