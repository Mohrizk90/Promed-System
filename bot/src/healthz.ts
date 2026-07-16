import http from "node:http";
import { logger } from "./logger.js";

export type HealthState = {
  geminiOk: boolean;
  mcpOk: boolean;
  telegramPollingOk: boolean;
  lastError: string | null;
  bootedAt: number;
};

const initial: HealthState = {
  geminiOk: false,
  mcpOk: false,
  telegramPollingOk: false,
  lastError: null,
  bootedAt: Date.now(),
};

const state: HealthState = { ...initial };

export function setGeminiOk(v: boolean): void {
  state.geminiOk = v;
}
export function setMcpOk(v: boolean): void {
  state.mcpOk = v;
}
export function setTelegramPollingOk(v: boolean): void {
  state.telegramPollingOk = v;
}
export function setLastError(msg: string | null): void {
  state.lastError = msg;
}

function snapshot() {
  return {
    status: state.geminiOk && state.mcpOk && state.telegramPollingOk ? "ok" : "degraded",
    uptime_s: Math.floor((Date.now() - state.bootedAt) / 1000),
    gemini_ok: state.geminiOk,
    mcp_ok: state.mcpOk,
    telegram_polling_ok: state.telegramPollingOk,
    last_error: state.lastError,
  };
}

export function getHealthSnapshot(): ReturnType<typeof snapshot> {
  return snapshot();
}

export function startHealthServer(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.end("bad request");
      return;
    }
    const snap = snapshot();
    if (req.url.startsWith("/healthz")) {
      res.setHeader("content-type", "application/json");
      res.statusCode = 200;
      res.end(JSON.stringify(snap));
      return;
    }
    if (req.url.startsWith("/readyz")) {
      const ready = snap.gemini_ok && snap.mcp_ok && snap.telegram_polling_ok;
      res.setHeader("content-type", "application/json");
      res.statusCode = ready ? 200 : 503;
      res.end(JSON.stringify({ ready, ...snap }));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  server.listen(port, () => {
    logger.info({ port }, "health server listening");
  });
  server.on("error", (err) => {
    logger.error({ err }, "health server error");
  });
  return server;
}
