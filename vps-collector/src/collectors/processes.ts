import type { Ssh } from '../ssh.js';

export interface ProcessStatus {
  name: string;
  up: boolean;
  /** "active", "inactive", "failed", "unit-missing" or "unknown". */
  state: string;
}

const UNIT_STATES: Record<string, string> = {
  active: 'active',
  inactive: 'inactive',
  failed: 'failed',
  activating: 'activating',
  deactivating: 'deactivating',
};

/**
 * `systemctl is-active <unit>` returns "active", "inactive", "failed", or
 * "unknown" / "inactive\n\nNo such file or directory" when the unit is missing.
 * We classify the missing case explicitly as "unit-missing".
 */
export async function collectSystemdUnit(ssh: Ssh, unit: string): Promise<ProcessStatus> {
  let raw = '';
  try {
    raw = await ssh.run(`systemctl is-active ${unit}`, 5_000);
  } catch (err) {
    // Non-zero exit often means "inactive" or "No such file or directory".
    const msg = (err as Error).message ?? '';
    if (/No such file or directory/i.test(msg)) {
      return { name: unit, up: false, state: 'unit-missing' };
    }
    // Try to recover the actual status from the stderr embedded in the
    // error message — ssh2 surfaces stderr in the rejection text.
    const m = msg.match(/stderr:\s*([^\n]+)/);
    if (m && m[1]) raw = m[1]!;
  }
  const trimmed = raw.trim();
  // systemctl prints the unit name + "No such file or directory" when missing.
  if (!trimmed || /no such file/i.test(trimmed)) {
    return { name: unit, up: false, state: 'unit-missing' };
  }
  const state = UNIT_STATES[trimmed] ?? trimmed;
  return { name: unit, up: state === 'active', state };
}

/** Count of journal lines for a unit in the last `since` window. Returns 0
 *  when the journal is empty or the unit has no logs. */
export async function collectJournalLineCount(
  ssh: Ssh,
  unit: string,
  since = '1 minute ago',
): Promise<number> {
  // Use `wc -l` on the tail; -n 0 is sufficient for our lag metric and avoids
  // transferring the whole journal entry body.
  const sinceEscaped = since.replace(/'/g, `'\\''`);
  try {
    const out = await ssh.run(
      `journalctl -u ${unit} --since '${sinceEscaped}' -q 2>/dev/null | wc -l`,
      5_000,
    );
    const n = Number.parseInt(out.trim(), 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Convenience helper used by index.ts for the bot + mcp pair. */
export async function collectProcessStatuses(
  ssh: Ssh,
  units: string[],
): Promise<ProcessStatus[]> {
  return Promise.all(units.map((u) => collectSystemdUnit(ssh, u)));
}
