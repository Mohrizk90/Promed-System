import "dotenv/config";
import { z } from "zod";

const RawEnv = z.object({
  TELEGRAM_BOT_TOKEN: z.string().trim().default(""),
  GEMINI_API_KEY: z.string().trim().min(1, "GEMINI_API_KEY is required"),
  GEMINI_MODEL: z.string().trim().default("gemini-2.5-flash"),
  /** Dedicated Gemini TTS model (speech output). Uses the same GEMINI_API_KEY. */
  GEMINI_TTS_MODEL: z.string().trim().default("gemini-2.5-flash-preview-tts"),
  // Male Gemini TTS voices: Charon, Orus, Fenrir, Puck, Alnilam, …
  // Kore/Aoede/Leda are female — default Charon (informative male).
  GEMINI_TTS_VOICE: z.string().trim().default("Charon"),
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(1, "SUPABASE_SERVICE_ROLE_KEY is required"),
  MCP_SERVER_URL: z.string().url("MCP_SERVER_URL must be a valid URL"),
  MCP_SHARED_SECRET: z.string().trim().min(1, "MCP_SHARED_SECRET is required"),
  BOT_HEALTH_PORT: z.coerce.number().int().positive().default(8081),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  TELEGRAM_WEBHOOK_URL: z.string().trim().default(""),
  TELEGRAM_WEBHOOK_PORT: z.coerce.number().int().positive().default(8443),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
});

export type AppConfig = z.infer<typeof RawEnv> & {
  readonly dryRun: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;
  const parsed = RawEnv.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  cached = Object.freeze({ ...env, dryRun: env.TELEGRAM_BOT_TOKEN.length === 0 });
  return cached;
}
