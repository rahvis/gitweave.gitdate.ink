import pino, { type Logger } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';

/**
 * pino-pretty is a dev convenience, not a runtime dependency. Containers ship
 * without it and log structured JSON; if it is absent locally we fall back
 * rather than crashing the process on startup.
 */
function build(): Logger {
  if (process.env.NODE_ENV !== 'production') {
    try {
      return pino({
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
      });
    } catch {
      /* fall through to plain JSON */
    }
  }
  return pino({ level });
}

export const logger = build();
