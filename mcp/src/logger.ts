import pino from 'pino';

function hasPinoPretty(): boolean {
  try {
    // Resolve from this file's directory, not cwd, so it works whether the
    // service is started via `npm run dev`, `tsx`, or `node dist/...`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve('pino-pretty', { paths: [process.cwd()] });
    return true;
  } catch {
    return false;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV === 'production' || !hasPinoPretty()
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } },
});
