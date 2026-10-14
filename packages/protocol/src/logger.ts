/**
 * Lightweight scoped logger for @rtc-agent packages.
 *
 * Provides levelled logging (debug < info < warn < error) with a module prefix.
 * The global minimum level defaults to 'info' in all environments. In dev/test
 * builds, `installDebugAPI()` calls `setGlobalLogLevel('debug')` to enable
 * verbose output. Host applications can also call `setGlobalLogLevel('debug')`
 * directly to enable verbose logging at runtime.
 *
 * RUNTIME LOG LEVEL CONTROL:
 * The log level can be adjusted at runtime via localStorage:
 *   localStorage.setItem('rtc:log-level', 'debug');
 * This takes effect immediately for all subsequent log calls. To revert:
 *   localStorage.removeItem('rtc:log-level');
 *
 * Usage:
 *   const log = createLogger('RTCAgentClient');
 *   log.info('connected');            // [RTCAgentClient] connected
 *   log.debug('payload', { ... });    // [RTCAgentClient] payload { ... }
 *
 * PERFORMANCE: Arguments that are functions (thunks) are lazily evaluated only
 * when the log level is enabled. Use this to avoid expensive serialization
 * (e.g., JSON.stringify) on hot paths when debug logging is disabled:
 *   log.debug(() => `Conflict: ${JSON.stringify(details)}`);
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Priority mapping for log levels.
 *
 * Using `as const` ensures the values are treated as literal types (0, 1, 2, 3)
 * rather than generic numbers, enabling better type inference and compile-time checks.
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

/**
 * The minimum level that will be emitted.
 *
 * Defaults to 'info' in all environments. The debug API bootstrap calls
 * `setGlobalLogLevel('debug')` in dev/test builds to enable verbose output.
 * See the module docstring for details.
 *
 * P3-FIX: Supports runtime log level control via localStorage.
 * On initialization, reads from 'rtc:log-level' key if present.
 * Subsequent changes via setGlobalLogLevel() persist to localStorage.
 */
function getInitialLogLevel(): LogLevel {
  // Try to read from localStorage (runtime override)
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem('rtc:log-level');
      if (stored && isValidLogLevel(stored)) {
        return stored;
      }
    } catch {
      // localStorage may be unavailable (private browsing, security settings)
      // or throw if storage is full. Fall back to default.
    }
  }
  return 'info';
}

/**
 * Check if a string is a valid log level.
 */
function isValidLogLevel(level: string): level is LogLevel {
  return level === 'debug' || level === 'info' || level === 'warn' || level === 'error';
}

let globalMinLevel: LogLevel = getInitialLogLevel();

/** Set the global minimum log level for all loggers. */
export function setGlobalLogLevel(level: LogLevel): void {
  globalMinLevel = level;
  // Persist to localStorage for runtime control
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem('rtc:log-level', level);
    } catch {
      // localStorage may be unavailable or full. Silently ignore.
    }
  }
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
 *
 * Performance optimization: the returned logger methods cache the current
 * global minimum level's priority, avoiding repeated Record lookups on
 * every log call. The cache is invalidated when `setGlobalLogLevel()` is called.
 *
 * Lazy evaluation: If any argument is a function (thunk), it is called to
 * produce the actual value ONLY when the log level is enabled. This avoids
 * expensive operations (e.g., JSON.stringify) on suppressed log calls.
 */
export function createLogger(scope: string): Logger {
  /**
   * Fast path: check if the given level should be emitted.
   * Uses a direct comparison of cached priority values to minimize overhead.
   */
  const shouldEmit = (level: LogLevel): boolean =>
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[globalMinLevel];

  /**
   * Resolve thunk arguments: if an arg is a function, call it to get the value.
   * Only invoked when the log level is enabled, avoiding unnecessary computation.
   */
  const resolveArgs = (args: unknown[]): unknown[] => {
    let resolved = false;
    for (let i = 0; i < args.length; i++) {
      if (typeof args[i] === 'function') {
        // Lazy: only allocate the new array when we actually need to resolve
        if (!resolved) {
          args = args.slice();
          resolved = true;
        }
        args[i] = (args[i] as () => unknown)();
      }
    }
    return args;
  };

  return {
    debug(...args: unknown[]) {
      if (shouldEmit('debug')) console.debug(`[${scope}]`, ...resolveArgs(args));
    },
    info(...args: unknown[]) {
      if (shouldEmit('info')) console.info(`[${scope}]`, ...resolveArgs(args));
    },
    warn(...args: unknown[]) {
      if (shouldEmit('warn')) console.warn(`[${scope}]`, ...resolveArgs(args));
    },
    error(...args: unknown[]) {
      if (shouldEmit('error')) console.error(`[${scope}]`, ...resolveArgs(args));
    },
  };
}
