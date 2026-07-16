import type { Ssh } from '../ssh.js';

export interface CpuSample {
  /** Sum of user+nice+system ticks at this sample. */
  busy: number;
  /** Total ticks (busy + idle + iowait + ...). */
  total: number;
}

export interface HostSample {
  cpu: CpuSample;
  memTotalKb: number;
  memAvailableKb: number;
  diskPct: number;
}

/** Parse the first "cpu " line of /proc/stat. */
function parseProcStat(line: string): CpuSample {
  const parts = line.trim().split(/\s+/);
  // parts: ['cpu', user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice]
  const toNum = (i: number) => Number.parseInt(parts[i] ?? '0', 10) || 0;
  const user = toNum(1);
  const nice = toNum(2);
  const system = toNum(3);
  const idle = toNum(4);
  const iowait = toNum(5);
  const irq = toNum(6);
  const softirq = toNum(7);
  const steal = toNum(8);
  const busy = user + nice + system + irq + softirq + steal;
  const total = busy + idle + iowait;
  return { busy, total };
}

/** Parse key kB values from /proc/meminfo. */
function parseProcMeminfo(text: string): { memTotalKb: number; memAvailableKb: number } {
  const lines = text.split('\n');
  let memTotalKb = 0;
  let memAvailableKb = 0;
  for (const line of lines) {
    if (line.startsWith('MemTotal:')) {
      memTotalKb = Number.parseInt(line.split(/\s+/)[1] ?? '0', 10) || 0;
    } else if (line.startsWith('MemAvailable:')) {
      memAvailableKb = Number.parseInt(line.split(/\s+/)[1] ?? '0', 10) || 0;
    }
  }
  return { memTotalKb, memAvailableKb };
}

/** Pull `df -P /` and extract the Use% column for the root filesystem. */
function parseDfPct(output: string): number {
  const lines = output.trim().split('\n');
  if (lines.length < 2) return 0;
  const last = lines[lines.length - 1]!;
  const cols = last.split(/\s+/);
  // Filesystem 1024-blocks Used Available Capacity Mounted-on
  const pct = cols[4] ?? '0';
  return Number.parseInt(pct.replace('%', ''), 10) || 0;
}

/**
 * Collect CPU/memory/disk counters for a single tick. The CPU sample is a
 * counter snapshot; deltas between two ticks are computed by the caller.
 */
export async function collectHostSample(ssh: Ssh): Promise<HostSample> {
  const [statRaw, memRaw, dfRaw] = await Promise.all([
    ssh.run("head -n 1 /proc/stat"),
    ssh.run("grep -E '^(MemTotal|MemAvailable):' /proc/meminfo"),
    ssh.run("df -P / | tail -n 1"),
  ]);

  const cpu = parseProcStat(statRaw);
  const { memTotalKb, memAvailableKb } = parseProcMeminfo(memRaw);
  const diskPct = parseDfPct(dfRaw);

  return { cpu, memTotalKb, memAvailableKb, diskPct };
}

export function memPctFromSample(s: HostSample): number {
  if (s.memTotalKb <= 0) return 0;
  return ((s.memTotalKb - s.memAvailableKb) / s.memTotalKb) * 100;
}

/** Compute CPU % busy between two counter snapshots. Returns 0 if this is
 *  the first sample (no delta available). */
export function cpuPctDelta(prev: CpuSample | null, cur: CpuSample): number {
  if (!prev) return 0;
  const dTotal = cur.total - prev.total;
  const dBusy = cur.busy - prev.busy;
  if (dTotal <= 0) return 0;
  return (dBusy / dTotal) * 100;
}
