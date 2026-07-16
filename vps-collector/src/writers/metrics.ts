import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface MetricRow {
  host: string;
  metric: string;
  ts: string;
  value_num: number | null;
  value_text: string | null;
  tags?: Record<string, unknown> | null;
}

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  if (!config.SUPABASE_URL || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  client = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

/** Upsert a batch of metric rows into `vps_metrics`. Returns the number of
 *  rows the server confirmed, or 0 if Supabase isn't configured (local
 *  fallback still logs the rows so the dashboard renders eventually). */
export async function upsertMetrics(rows: MetricRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const c = getClient();
  if (!c) {
    logger.debug({ count: rows.length }, 'supabase not configured; dropping metric rows');
    return 0;
  }
  const { data, error } = await c
    .from('vps_metrics')
    .upsert(rows, { onConflict: 'host,metric,ts' } as never);
  if (error) {
    logger.error({ err: error.message, count: rows.length }, 'upsertMetrics failed');
    throw error;
  }
  return Array.isArray(data) ? (data as unknown as unknown[]).length : rows.length;
}

/** Insert a single error/warning entry into `bot_error_feed`. */
export async function reportError(opts: {
  source: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  const c = getClient();
  if (!c) {
    logger.warn({ ...opts }, 'supabase not configured; error not persisted');
    return;
  }
  const row = {
    source: opts.source,
    severity: opts.severity,
    message: opts.message,
    context: opts.context ?? {},
    created_at: new Date().toISOString(),
  };
  const { error } = await c.from('bot_error_feed').insert(row);
  if (error) {
    logger.error({ err: error.message, ...opts }, 'reportError insert failed');
  }
}
