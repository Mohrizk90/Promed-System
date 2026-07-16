import TelegramBot from "node-telegram-bot-api";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { RateLimiter } from "./ratelimit.js";
import {
  startHealthServer,
  setGeminiOk,
  setMcpOk,
  setTelegramPollingOk,
  setLastError,
} from "./healthz.js";
import { registerHandlers } from "./telegram/handlers.js";
import { getGemini } from "./gemini/client.js";
import { getMcpClient, closeAllMcpClients } from "./mcp/client.js";
import { activeSessionCount } from "./session/store.js";
import { writeHealthSnapshot, minuteBucket } from "./audit.js";
import { getHealthSnapshot } from "./healthz.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info(
    {
      dry_run: cfg.dryRun,
      gemini_model: cfg.GEMINI_MODEL,
      mcp_url: cfg.MCP_SERVER_URL,
      health_port: cfg.BOT_HEALTH_PORT,
    },
    "boot",
  );

  // Always start the health server first so /healthz is up even when deps are down.
  startHealthServer(cfg.BOT_HEALTH_PORT);

  // Eagerly probe Gemini and MCP so healthz reports real state.
  try {
    getGemini();
    setGeminiOk(true);
  } catch (err) {
    setGeminiOk(false);
    setLastError(`gemini init: ${(err as Error).message}`);
    logger.warn({ err }, "gemini init failed");
  }

  try {
    // Tools listing doubles as the MCP liveness probe.
    await getMcpClient(null, null).listTools();
  } catch (err) {
    setMcpOk(false);
    setLastError(`mcp init: ${(err as Error).message}`);
    logger.warn({ err }, "mcp init failed; will retry on demand");
  }

  const rateLimiter = new RateLimiter(cfg.RATE_LIMIT_PER_MIN);

  let bot: TelegramBot | null = null;
  if (cfg.dryRun) {
    logger.warn("BOT_DRY_RUN: TELEGRAM_BOT_TOKEN is empty — bot will not connect to Telegram");
  } else {
    const useWebhook = cfg.TELEGRAM_WEBHOOK_URL.length > 0;
    bot = useWebhook
      ? new TelegramBot(cfg.TELEGRAM_BOT_TOKEN, {
          // node-telegram-bot-api expects `webHook: true` or an options object.
          // We bind only to loopback; nginx frontends us with TLS on the public host.
          webHook: {
            port: cfg.TELEGRAM_WEBHOOK_PORT,
            host: "127.0.0.1",
          },
        })
      : new TelegramBot(cfg.TELEGRAM_BOT_TOKEN, { polling: { autoStart: false } });

    try {
      if (useWebhook) {
        // Order matters: open the local listener FIRST, then tell Telegram where
        // to send updates. If we set the webhook before a server is listening,
        // Telegram's first attempt will get ECONNREFUSED and back off.
        await bot.openWebHook();
        logger.info(
          { port: cfg.TELEGRAM_WEBHOOK_PORT, url: cfg.TELEGRAM_WEBHOOK_URL },
          "telegram webhook listener open",
        );
        await bot.setWebHook(`${cfg.TELEGRAM_WEBHOOK_URL}/bot${cfg.TELEGRAM_BOT_TOKEN}`);
        logger.info({ url: cfg.TELEGRAM_WEBHOOK_URL }, "telegram webhook set");
        setTelegramPollingOk(true);
      } else {
        // Mark polling as OK as soon as startPolling resolves; install a
        // long-lived listener that flips it back off + records an error if
        // Telegram emits a polling_error later. Previously this code awaited
        // a `polling_error` listener that would never resolve on the happy
        // path, so telegram_polling_ok stayed false forever.
        bot.on("polling_error", (err) => {
          setTelegramPollingOk(false);
          setLastError(`telegram polling: ${(err as Error).message}`);
          logger.warn({ err }, "telegram polling error");
        });
        await bot.startPolling();
        setTelegramPollingOk(true);
        logger.info("telegram polling started");
      }
    } catch (err) {
      setTelegramPollingOk(false);
      setLastError(`telegram polling/webhook: ${(err as Error).message}`);
      logger.error({ err }, "telegram init failed");
    }
  }

  registerHandlers({
    bot: bot as TelegramBot, // unused in dry-run but typed non-null in the dispatcher
    rateLimiter,
    dryRun: cfg.dryRun,
  });

  // Periodic session metrics — logs active sessions every 5 min.
  setInterval(() => {
    logger.info({ active_sessions: activeSessionCount() }, "session heartbeat");
  }, 5 * 60_000).unref();

  // Snapshot our health into Supabase every minute so the monitoring
  // dashboard can render a live timeline even when no tool calls are firing.
  function emitHealthSnapshot(): void {
    const h = getHealthSnapshot();
    writeHealthSnapshot({
      source: "bot",
      ts: minuteBucket(),
      status: h.status as "ok" | "degraded" | "down",
      uptimeS: h.uptime_s,
      geminiOk: h.gemini_ok,
      mcpOk: h.mcp_ok,
      telegramOk: h.telegram_polling_ok,
    });
  }
  emitHealthSnapshot(); // immediate snapshot on boot
  setInterval(emitHealthSnapshot, 60_000).unref();

  // Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      if (bot) {
        // Close whichever mode we're in. closeWebHook is a no-op in polling mode
        // and vice versa (both are awaitable in node-telegram-bot-api 0.66+).
        await bot.closeWebHook().catch(() => undefined);
        await bot.stopPolling().catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ err }, "stopPolling/closeWebHook error");
    }
    await closeAllMcpClients().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  if (cfg.dryRun) {
    // Stay alive briefly so health server / logs are observable, then exit cleanly.
    logger.info("dry-run mode: exiting in 2s (no real Telegram connection)");
    setTimeout(() => void shutdown("dry-run-exit"), 2_000);
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "fatal boot error");
  process.exit(1);
});
