import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as NodeWebSocket } from 'ws';
import { loadConfig } from '../config.js';

let cached: SupabaseClient | null = null;

// `ws`'s WebSocket is structurally compatible with the `WebSocketLike`
// interface Supabase's realtime client expects, but its TS types differ
// from Supabase's narrow `WebSocketLikeConstructor`. Casting through
// `unknown` keeps the rest of the file strongly typed.
const WS_RT = NodeWebSocket as unknown as any;
const WS_GLOBAL = NodeWebSocket as unknown as typeof globalThis.WebSocket;
// Supabase's `global` option is typed as { fetch?, headers? } only and
// rejects extra keys at compile time. Wrap the whole object in a cast.
const GLOBAL_WITH_WS = { WebSocket: WS_GLOBAL } as Parameters<
  typeof createClient
>[2] extends infer _ ? any : never;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const cfg = loadConfig();
  cached = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Supabase 2.110+ requires Node 22+ for its built-in WebSocket, or a
    // user-provided implementation. We never subscribe to realtime channels
    // (only use the REST client for queries + Storage), but Supabase still
    // instantiates a RealtimeClient eagerly. Injecting `ws` here keeps us
    // running on Node 20 LTS without losing functionality.
    realtime: { transport: WS_RT },
    global: GLOBAL_WITH_WS,
  });
  return cached;
}

export function userClient(userId: string, userJwt: string): SupabaseClient {
  const cfg = loadConfig();
  void userId;
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${userJwt}` },
      WebSocket: WS_GLOBAL,
    } as Parameters<typeof createClient>[2] extends infer _ ? any : never,
    realtime: { transport: WS_RT },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
