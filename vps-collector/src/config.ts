import 'dotenv/config';
import { z } from 'zod';

const RawSchema = z.object({
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SMOPS_SSH_HOST: z.string().min(1).optional(),
  SMOPS_SSH_USER: z.string().min(1).default('root'),
  SMOPS_SNMP_COMMUNITY: z.string().min(1).optional(),
  COLLECTOR_INTERVAL_S: z.coerce.number().int().positive().default(30),
  COLLECTOR_HEALTH_PORT: z.coerce.number().int().positive().default(8083),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Config = ReturnType<typeof RawSchema.parse> & {
  /** True when no real VPS is configured; emit synthetic metrics. */
  localFallback: boolean;
  /** SSH config alias used by ssh2; resolved from ~/.ssh/config. */
  sshHost: string;
  sshUser: string;
};

const parsed = RawSchema.parse(process.env);

const localFallback = !parsed.SMOPS_SSH_HOST || parsed.SMOPS_SSH_HOST.length === 0;

export const config: Config = Object.freeze({
  ...parsed,
  localFallback,
  sshHost: parsed.SMOPS_SSH_HOST ?? 'smops',
  sshUser: parsed.SMOPS_SSH_USER,
});

export type { Config as AppConfig };
