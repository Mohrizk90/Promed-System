import { pino } from "pino";
import { loadConfig } from "./config.js";

const cfg = loadConfig();

export const logger = pino({
  level: cfg.LOG_LEVEL,
  base: { service: "promed-bot" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
