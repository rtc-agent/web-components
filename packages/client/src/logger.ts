/**
 * Lightweight scoped logger for @rtc-agent/client.
 *
 * Provides levelled logging (debug < info < warn < error) with a module prefix.
 * The global minimum level defaults to 'info' in all environments. In dev/test
 * builds, `installDebugAPI()` calls `setGlobalLogLevel('debug')` to enable
 * verbose output. Host applications can also call `setGlobalLogLevel('debug')`
 * directly to enable verbose logging at runtime.
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

/**
 * The minimum level that will be emitted.
 *
 * Defaults to 'info' in all environments. The debug API bootstrap calls
 * `setGlobalLogLevel('debug')` in dev/test builds to enable verbose output.
 * See the module docstring for details.
 */
let globalMinLevel: LogLevel = 'info';

/** Set the global minimum log level for all loggers. */
export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level;
}

/** Get the current global minimum log level. */
export function getGlobalLogLevel(): LogLevel {
  return globalMinLevel;
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
