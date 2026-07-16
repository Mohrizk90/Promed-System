import { snmpGet } from '../snmp.js';
import type { Ssh } from '../ssh.js';
import { logger } from '../logger.js';

/** UCD-SNMP-MIB OIDs that are interesting for a small VPS host. */
export const UCD_OIDS = {
  ssCpuRawUser: '.1.3.6.1.4.1.2021.11.50.0',
  ssCpuRawSystem: '.1.3.6.1.4.1.2021.11.10.0',
  ssCpuRawIdle: '.1.3.6.1.4.1.2021.11.11.0',
  ssCpuRawNice: '.1.3.6.1.4.1.2021.11.51.0',
} as const;

export interface SnmpTickResult {
  metric: string;
  value: number | null;
  raw: string | null;
}

/**
 * Run a small batch of UCD-SNMP-MIB queries over SSH. Missing `snmpget`
 * binary or unreachable `snmpd` returns an empty array — the caller logs and
 * continues. The collector never throws on SNMP errors.
 */
export async function collectSnmp(ssh: Ssh, community: string): Promise<SnmpTickResult[]> {
  const oids: Array<[string, string]> = [
    ['snmp_cpu_user', UCD_OIDS.ssCpuRawUser],
    ['snmp_cpu_system', UCD_OIDS.ssCpuRawSystem],
    ['snmp_cpu_idle', UCD_OIDS.ssCpuRawIdle],
  ];

  const results = await Promise.all(
    oids.map(async ([metric, oid]) => {
      const r = await snmpGet(ssh, community, oid);
      if (!r) return null;
      const n = r.value !== null ? Number.parseInt(r.value, 10) : null;
      return { metric, value: Number.isFinite(n) ? n : null, raw: r.raw };
    }),
  );

  const out: SnmpTickResult[] = [];
  for (const r of results) {
    if (r !== null) out.push(r);
  }
  if (out.length === 0) {
    logger.debug('snmp returned no data (snmpd missing or unreachable)');
  }
  return out;
}
