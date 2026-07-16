import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WebSocket as NodeWebSocket } from 'ws';
import { config } from './config.js';

// See mcp/src/supabase/userClient.ts — Supabase 2.110+ requires a
// user-provided WebSocket on Node <22 even though we never subscribe.
const WS_RT = NodeWebSocket as unknown as any;
const WS_GLOBAL = NodeWebSocket as unknown as typeof globalThis.WebSocket;

let cached: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (cached) return cached;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return null;
  cached = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WS_RT },
    global: { WebSocket: WS_GLOBAL } as any,
  });
  return cached;
}
