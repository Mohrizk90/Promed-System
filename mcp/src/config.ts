import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MCP_PORT: z.coerce.number().int().positive().default(8082),
  MCP_SHARED_SECRET: z.string().min(16),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid MCP environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
