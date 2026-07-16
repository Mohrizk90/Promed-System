import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfig } from '../config.js';

let cached: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (cached) return cached;
  const cfg = loadConfig();
  cached = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export function userClient(userId: string, userJwt: string): SupabaseClient {
  const cfg = loadConfig();
  void userId;
  return createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
