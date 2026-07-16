import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface BotHealthSnapshot {
  host: string;
  service: 'promed-bot' | 'promed-mcp';
  ts: string;
  up: boolean;
  latency_ms: number | null;
  http_status: number | null;
  body: Record<string, unknown> | null;
  error: string | null;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) return null;
  client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

export async function upsertBotHealth(rows: BotHealthSnapshot[]): Promise<number> {
  if (rows.length === 0) return 0;
  const c = getClient();
  if (!c) {
    logger.debug({ count: rows.length }, 'supabase not configured; dropping health rows');
    return 0;
  }
  const { data, error } = await c
    .from('bot_health_snapshots')
    .upsert(rows, { onConflict: 'host,service,ts' } as never);
  if (error) {
    logger.error({ err: error.message, count: rows.length }, 'upsertBotHealth failed');
    throw error;
  }
  return Array.isArray(data) ? (data as unknown as unknown[]).length : rows.length;
}
