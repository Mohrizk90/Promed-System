import type { Ssh } from '../ssh.js';

export interface NetCounters {
  /** Map of iface -> { rxBytes, txBytes } cumulative. */
  byIface: Record<string, { rxBytes: number; txBytes: number }>;
}

/**
 * Parse /proc/net/dev. Format:
 *   Inter-|   Receive                                                |  Transmit
 *    face |bytes    packets errs drop fifo frame compressed multicast|bytes ...
 *     eth0: 1234  567 ...
 */
function parseProcNetDev(output: string): NetCounters {
  const lines = output.split('\n');
  const byIface: Record<string, { rxBytes: number; txBytes: number }> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name) continue;
    const cols = line.slice(colon + 1).trim().split(/\s+/);
    // rxBytes = cols[0], txBytes = cols[8]
    const rxBytes = Number.parseInt(cols[0] ?? '0', 10) || 0;
    const txBytes = Number.parseInt(cols[8] ?? '0', 10) || 0;
    byIface[name] = { rxBytes, txBytes };
  }
  return { byIface };
}

export async function collectNetCounters(ssh: Ssh): Promise<NetCounters> {
  const raw = await ssh.run('cat /proc/net/dev');
  return parseProcNetDev(raw);
}

/** Sum RX/TX bytes across every non-loopback interface. */
function sumNonLoopback(c: NetCounters): { rxBytes: number; txBytes: number } {
  let rxBytes = 0;
  let txBytes = 0;
  for (const [name, v] of Object.entries(c.byIface)) {
    if (name === 'lo') continue;
    rxBytes += v.rxBytes;
    txBytes += v.txBytes;
  }
  return { rxBytes, txBytes };
}

/** Compute bits-per-second between two NetCounters snapshots. deltaSeconds
 *  is the elapsed wall-clock time between samples. */
export function netRateBps(
  prev: NetCounters | null,
  cur: NetCounters,
  deltaSeconds: number,
): { inBps: number; outBps: number } {
  if (!prev || deltaSeconds <= 0) return { inBps: 0, outBps: 0 };
  const a = sumNonLoopback(cur);
  const b = sumNonLoopback(prev);
  const inBps = ((a.rxBytes - b.rxBytes) * 8) / deltaSeconds;
  const outBps = ((a.txBytes - b.txBytes) * 8) / deltaSeconds;
  return {
    inBps: Math.max(0, inBps),
    outBps: Math.max(0, outBps),
  };
}
