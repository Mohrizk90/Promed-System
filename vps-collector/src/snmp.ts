import type { Ssh } from './ssh.js';

/** Build a v2c snmpget command line. The OID string is not quoted because the
 *  caller must pass a syntactically-valid OID (digits and dots only). */
export function buildSnmpGet(community: string, oid: string, host = 'localhost'): string {
  // Escape any single quotes inside the community just in case.
  const safeCommunity = community.replace(/'/g, `'\\''`);
  return `snmpget -v2c -c '${safeCommunity}' -t 2 -r 1 ${host} ${oid} 2>/dev/null`;
}

/**
 * Parse textual snmpget output. Examples of valid output:
 *   iso.3.6.1.4.1.2021.11.10.0 = INTEGER: 5
 *   .1.3.6.1.4.1.2021.11.10.0 = STRING: hello
 * Returns the right-hand value stripped of its ASN.1 type tag, or null on
 * parse failure.
 */
export function parseSnmpGet(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf('=');
  if (idx === -1) return null;
  const rhs = trimmed.slice(idx + 1).trim();
  // Strip leading ASN.1 type tag like "INTEGER:", "STRING:", "Gauge32:", etc.
  const colon = rhs.indexOf(':');
  const value = colon === -1 ? rhs : rhs.slice(colon + 1).trim();
  return value || null;
}

export interface SnmpResult {
  oid: string;
  raw: string;
  value: string | null;
}

/** Run a v2c snmpget via SSH and parse the response. Returns null if the
 *  binary is missing or the host rejected the request — the caller is
 *  expected to log and continue. */
export async function snmpGet(
  ssh: Ssh,
  community: string,
  oid: string,
  host = 'localhost',
): Promise<SnmpResult | null> {
  const cmd = buildSnmpGet(community, oid, host);
  try {
    const raw = await ssh.run(cmd, 8_000);
    return { oid, raw, value: parseSnmpGet(raw) };
  } catch (err) {
    // snmpget missing (127) or timeout are both "skip silently" cases.
    return null;
  }
}
