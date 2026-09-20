/**
 * Lightweight scoped logger for @rtc-agent/client.
 *
 * Provides levelled logging (debug < info < warn < error) with a module prefix.
 * In production builds the min level defaults to 'info'; in dev it defaults to 'debug'.
 *
 * Usage:
 *   const log = createLogger('RTCAgentClient');
 *   log.info('connected');            // [RTCAgentClient] connected
 *   log.debug('payload', { ... });    // [RTCAgentClient] payload { ... }
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** The minimum level that will be emitted. Defaults to 'debug'. */
let globalMinLevel: LogLevel = 'debug';

/** Set the global minimum log level for all loggers. */
export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * Create a scoped logger that prefixes every message with `[scope]`.
 */
export function createLogger(scope: string): Logger {
  const shouldEmit = (level: LogLevel): boolean =>
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalMinLevel];

  return {
    debug(...args: unknown[]) {
      if (shouldEmit('debug')) console.debug(`[${scope}]`, ...args);
    },
    info(...args: unknown[]) {
      if (shouldEmit('info')) console.info(`[${scope}]`, ...args);
    },
    warn(...args: unknown[]) {
      if (shouldEmit('warn')) console.warn(`[${scope}]`, ...args);
    },
    error(...args: unknown[]) {
      if (shouldEmit('error')) console.error(`[${scope}]`, ...args);
    },
  };
}
