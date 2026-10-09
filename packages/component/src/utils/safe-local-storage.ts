/**
 * Safe localStorage Wrapper
 *
 * Centralizes the try-catch pattern for localStorage operations.
 * Many places in the codebase read/write localStorage with identical
 * error handling (private browsing, quota exceeded). This module
 * provides a single, consistent implementation.
 *
 * @module utils/safe-local-storage
 */
import { createLogger } from '@rtc-agent/client';

const log = createLogger('SafeLocalStorage');

/**
 * Safely read a value from localStorage.
 *
 * Returns null if the key does not exist or localStorage is unavailable.
 * Logs a debug message on failure (e.g., private browsing mode).
 *
 * @param key localStorage key
 * @returns Stored string value, or null
 */
export function safeLocalStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    log.debug('localStorage unavailable for reading key:', key, err);
    return null;
  }
}

/**
 * Safely write a value to localStorage.
 *
 * Silently ignores failures (e.g., quota exceeded, private browsing).
 * Logs a debug message on failure.
 *
 * @param key localStorage key
 * @param value String value to store
 */
export function safeLocalStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    log.debug('localStorage unavailable for writing key:', key, err);
  }
}

/**
 * Safely remove a value from localStorage.
 *
 * Silently ignores failures.
 *
 * @param key localStorage key
 */
export function safeLocalStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    log.debug('localStorage unavailable for removing key:', key, err);
  }
}

/**
 * Safely read and parse a JSON value from localStorage.
 *
 * Returns the parsed value, or the provided default if:
 * - The key does not exist
 * - localStorage is unavailable
 * - The stored value is not valid JSON
 *
 * @param key localStorage key
 * @param defaultValue Default value if read/parse fails
 * @returns Parsed value, or defaultValue
 */
export function safeLocalStorageGetJSON<T>(key: string, defaultValue: T): T {
  const raw = safeLocalStorageGet(key);
  if (raw === null) return defaultValue;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    log.debug('Failed to parse JSON from localStorage key:', key, err);
    return defaultValue;
  }
}

/**
 * Safely serialize and write a JSON value to localStorage.
 *
 * @param key localStorage key
 * @param value Value to serialize and store
 */
export function safeLocalStorageSetJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    log.debug('localStorage unavailable for writing JSON key:', key, err);
  }
}
