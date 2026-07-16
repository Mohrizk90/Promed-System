import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: {
    service: 'vps-collector',
    host: config.sshHost,
    mode: config.localFallback ? 'local-fallback' : 'ssh',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
