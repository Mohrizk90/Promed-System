import { logger } from './logger.js';
import { upsertMetrics, reportError } from './writers/metrics.js';
import { config } from './config.js';

export interface LocalFallbackReport {
  wroteRows: number;
}

function jitter(base: number, span: number): number {
  // Deterministic-ish jitter so a single process produces stable dashboards
  // across very short windows; seed by Date.now for variety across restarts.
  const seed = Math.sin(Date.now() / 30_000) * 10_000;
  const frac = seed - Math.floor(seed);
  return Math.round((base + frac * span) * 100) / 100;
}

/**
 * Emit synthetic-but-realistic metrics so the Agent Monitoring dashboard can
 * render during local development without a live VPS connection. All rows
 * are tagged `host='smops-local'` and one synthetic row carries
 * `value_text='(local-fallback)'` for downstream filtering.
 */
export async function collectLocalFallback(): Promise<LocalFallbackReport> {
  const ts = new Date().toISOString();
  const host = 'smops-local';

  const cpu = jitter(10, 5); // 5-15
  const mem = jitter(38, 7); // 30-45
  const disk = jitter(48, 7); // 40-55
  const inBps = jitter(2_500, 1_500);
  const outBps = jitter(3_200, 1_800);

  const rows = [
    { host, metric: 'cpu_pct', ts, value_num: cpu, value_text: null },
    { host, metric: 'mem_pct', ts, value_num: mem, value_text: null },
    { host, metric: 'disk_pct', ts, value_num: disk, value_text: null },
    { host, metric: 'net_in_bps', ts, value_num: inBps, value_text: null },
    { host, metric: 'net_out_bps', ts, value_num: outBps, value_text: null },
    { host, metric: 'bot_up', ts, value_num: 0, value_text: 'not-running-locally' },
    { host, metric: 'mcp_up', ts, value_num: 0, value_text: 'not-running-locally' },
    { host, metric: 'telegram_queue_lag', ts, value_num: 0, value_text: null },
    // Marker row — dashboard consumers can hide or highlight this.
    {
      host,
      metric: 'collector_mode',
      ts,
      value_num: null,
      value_text: '(local-fallback)',
      tags: { interval_s: config.COLLECTOR_INTERVAL_S },
    },
  ];

  try {
    const wrote = await upsertMetrics(rows);
    logger.info({ wrote, host }, 'local-fallback tick wrote metrics');
    return { wroteRows: wrote };
  } catch (err) {
    await reportError({
      source: 'collector',
      severity: 'error',
      message: 'local-fallback upsert failed',
      context: { err: (err as Error).message },
    });
    throw err;
  }
}
