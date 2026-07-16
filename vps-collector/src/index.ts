import http from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { Ssh } from './ssh.js';
import {
  collectHostSample,
  cpuPctDelta,
  memPctFromSample,
  type CpuSample,
  type HostSample,
} from './collectors/host.js';
import {
  collectNetCounters,
  netRateBps,
  type NetCounters,
} from './collectors/net.js';
import {
  collectJournalLineCount,
  collectProcessStatuses,
  type ProcessStatus,
} from './collectors/processes.js';
import { collectSnmp, type SnmpTickResult } from './collectors/snmp.js';
import { upsertMetrics, reportError, type MetricRow } from './writers/metrics.js';
import { upsertBotHealth, type BotHealthSnapshot } from './writers/health.js';
import { collectLocalFallback } from './localFallback.js';

interface TickState {
  lastTickAt: string | null;
  lastTickOk: boolean;
  sshConnected: boolean;
  smopsReachable: boolean;
  consecutiveFailures: number;
  backoffMs: number;
}

const HEALTH_PORT = config.COLLECTOR_HEALTH_PORT;
const INTERVAL_MS = config.COLLECTOR_INTERVAL_S * 1000;
const HEALTH_TICK_MS = 5 * 60 * 1000;

const state: TickState = {
  lastTickAt: null,
  lastTickOk: false,
  sshConnected: false,
  smopsReachable: false,
  consecutiveFailures: 0,
  backoffMs: 0,
};

// In-memory deltas across ticks.
let prevCpu: CpuSample | null = null;
let prevNet: NetCounters | null = null;
let prevSampleAt: number | null = null;

const ssh = new Ssh({});

async function runSshTick(): Promise<void> {
  const connected = await ssh.connect();
  state.sshConnected = true;
  state.smopsReachable = await ssh.ping();
  if (!state.smopsReachable) {
    throw new Error('smops unreachable (ssh ping failed)');
  }
  void connected;

  const now = Date.now();
  const ts = new Date(now).toISOString();

  // Run independent collectors in parallel for one tick.
  const [hostSample, net, promedBot, promedMcp, telegramLag, snmp] = await Promise.all([
    collectHostSample(ssh),
    collectNetCounters(ssh),
    collectSystemdUnitSafe('promed-bot'),
    collectSystemdUnitSafe('promed-mcp'),
    collectJournalLineCount(ssh, 'promed-bot', '1 minute ago').catch(() => 0),
    config.SMOPS_SNMP_COMMUNITY
      ? collectSnmp(ssh, config.SMOPS_SNMP_COMMUNITY).catch((e) => {
          logger.warn({ err: (e as Error).message }, 'snmp collector threw; ignoring');
          return [] as SnmpTickResult[];
        })
      : Promise.resolve([] as SnmpTickResult[]),
  ]);

  const deltaSeconds = prevSampleAt ? (now - prevSampleAt) / 1000 : 0;
  const cpuPct = prevCpu ? cpuPctDelta(prevCpu, hostSample.cpu) : 0;
  const memPct = memPctFromSample(hostSample);
  const netRates = netRateBps(prevNet, net, deltaSeconds);

  prevCpu = hostSample.cpu;
  prevNet = net;
  prevSampleAt = now;

  const rows: MetricRow[] = [
    metricRow('cpu_pct', cpuPct),
    metricRow('mem_pct', memPct),
    metricRow('disk_pct', hostSample.diskPct),
    metricRow('net_in_bps', netRates.inBps),
    metricRow('net_out_bps', netRates.outBps),
    processMetricRow(promedBot, 'bot_up'),
    processMetricRow(promedMcp, 'mcp_up'),
    { host: config.sshHost, metric: 'telegram_queue_lag', ts, value_num: telegramLag, value_text: null },
  ];

  for (const s of snmp) {
    rows.push({
      host: config.sshHost,
      metric: s.metric,
      ts,
      value_num: s.value,
      value_text: s.value === null ? s.raw : null,
    });
  }

  await upsertMetrics(rows);
  logger.info(
    {
      wrote: rows.length,
      cpuPct: round(cpuPct, 2),
      memPct: round(memPct, 2),
      diskPct: hostSample.diskPct,
      netInBps: Math.round(netRates.inBps),
      netOutBps: Math.round(netRates.outBps),
      botUp: promedBot.up,
      mcpUp: promedMcp.up,
    },
    'ssh tick wrote metrics',
  );
}

async function collectSystemdUnitSafe(unit: string): Promise<ProcessStatus> {
  const { collectSystemdUnit } = await import('./collectors/processes.js');
  try {
    return await collectSystemdUnit(ssh, unit);
  } catch (err) {
    logger.warn({ unit, err: (err as Error).message }, 'systemctl is-active failed');
    return { name: unit, up: false, state: 'unknown' };
  }
}

function metricRow(metric: string, value: number | null): MetricRow {
  return {
    host: config.sshHost,
    metric,
    ts: new Date().toISOString(),
    value_num: value,
    value_text: null,
  };
}

function processMetricRow(p: ProcessStatus, metric: string): MetricRow {
  return {
    host: config.sshHost,
    metric,
    ts: new Date().toISOString(),
    value_num: p.up ? 1 : 0,
    value_text: p.state,
  };
}

async function runHealthTick(): Promise<void> {
  const targets: Array<{ service: BotHealthSnapshot['service']; port: number }> = [
    { service: 'promed-bot', port: 8081 },
    { service: 'promed-mcp', port: 8082 },
  ];

  const rows: BotHealthSnapshot[] = [];
  for (const t of targets) {
    const row = await probeHealth(t.service, t.port);
    rows.push(row);
  }

  try {
    await upsertBotHealth(rows);
    logger.info({ wrote: rows.length }, 'health tick wrote snapshots');
  } catch (err) {
    await reportError({
      source: 'collector',
      severity: 'warn',
      message: 'health upsert failed',
      context: { err: (err as Error).message },
    });
  }
}

async function probeHealth(
  service: BotHealthSnapshot['service'],
  port: number,
): Promise<BotHealthSnapshot> {
  const ts = new Date().toISOString();
  const started = Date.now();
  try {
    const raw = await ssh.run(`curl -s --max-time 3 http://127.0.0.1:${port}/healthz`);
    const latency = Date.now() - started;
    let body: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(raw);
      body = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    return {
      host: config.sshHost,
      service,
      ts,
      up: true,
      latency_ms: latency,
      http_status: 200,
      body,
      error: null,
    };
  } catch (err) {
    return {
      host: config.sshHost,
      service,
      ts,
      up: false,
      latency_ms: null,
      http_status: null,
      body: null,
      error: (err as Error).message,
    };
  }
}

async function tick(): Promise<void> {
  const startedAt = Date.now();
  try {
    if (config.localFallback) {
      await collectLocalFallback();
      state.sshConnected = false;
      state.smopsReachable = false;
    } else {
      await runSshTick();
    }
    state.lastTickAt = new Date().toISOString();
    state.lastTickOk = true;
    state.consecutiveFailures = 0;
    state.backoffMs = 0;
  } catch (err) {
    state.lastTickAt = new Date().toISOString();
    state.lastTickOk = false;
    state.consecutiveFailures += 1;
    state.backoffMs = computeBackoff(state.consecutiveFailures);
    logger.error(
      { err: (err as Error).message, consecutive: state.consecutiveFailures, backoffMs: state.backoffMs },
      'tick failed',
    );
    await reportError({
      source: 'collector',
      severity: state.consecutiveFailures >= 3 ? 'error' : 'warn',
      message: `tick failed (attempt ${state.consecutiveFailures})`,
      context: { err: (err as Error).message, durationMs: Date.now() - startedAt },
    });
  }
}

function computeBackoff(attempt: number): number {
  // 0s, 5s, 15s, 60s, 5m
  const table = [0, 5_000, 15_000, 60_000, 5 * 60_000];
  return table[Math.min(attempt, table.length - 1)] ?? 0;
}

function startHttpServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(404).end();
      return;
    }
    const path = req.url.split('?')[0]!;
    if (path === '/healthz') {
      const body = {
        status: state.lastTickOk ? 'ok' : 'degraded',
        uptime_s: Math.round(process.uptime()),
        last_tick_at: state.lastTickAt,
        last_tick_ok: state.lastTickOk,
        ssh_connected: state.sshConnected,
        smops_reachable: state.smopsReachable,
        consecutive_failures: state.consecutiveFailures,
        mode: config.localFallback ? 'local-fallback' : 'ssh',
      };
      res
        .writeHead(state.lastTickOk ? 200 : 503, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(body));
      return;
    }
    if (path === '/readyz') {
      if (!state.lastTickAt || !state.lastTickOk) {
        res.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ready: false }));
        return;
      }
      const ageMs = Date.now() - new Date(state.lastTickAt).getTime();
      const ready = ageMs < 2 * INTERVAL_MS;
      res
        .writeHead(ready ? 200 : 503, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ready, age_ms: ageMs }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(HEALTH_PORT, () => {
    logger.info({ port: HEALTH_PORT }, 'health server listening');
  });
  return server;
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

async function main(): Promise<void> {
  logger.info(
    {
      mode: config.localFallback ? 'local-fallback' : 'ssh',
      sshHost: config.sshHost,
      sshUser: config.sshUser,
      intervalS: config.COLLECTOR_INTERVAL_S,
      healthPort: HEALTH_PORT,
      snmp: Boolean(config.SMOPS_SNMP_COMMUNITY),
    },
    'vps-collector starting',
  );

  const server = startHttpServer();

  // First tick immediately.
  await tick();
  setInterval(() => {
    void tick();
  }, INTERVAL_MS);
  setInterval(() => {
    if (!config.localFallback) void runHealthTick();
  }, HEALTH_TICK_MS);

  const shutdown = async (sig: string) => {
    logger.info({ sig }, 'shutting down');
    server.close();
    await ssh.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Top-level await so we can run async main directly in ESM.
await main();
