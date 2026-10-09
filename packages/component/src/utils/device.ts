/**
 * Device ID Management
 *
 * Utilities for generating and persisting device identifiers.
 *
 * SECURITY: Device ID is used for RTC (Remote Tool Call) filtering at execution time.
 * Only RTCs whose session_device_id matches the local Device ID are executed.
 * This prevents cross-device script execution attacks.
 *
 * MULTI-TAB COORDINATION: Device ID is stored in localStorage for cross-Tab sharing.
 * If localStorage is unavailable (e.g., private browsing), each Tab generates an
 * ephemeral UUID, which may cause RTC filtering to fail across Tabs. In production
 * environments, ensure localStorage is available for consistent Device ID.
 */
import { STORAGE_KEYS } from '../config/auth.js';
import {
  safeLocalStorageGet,
  safeLocalStorageSet,
} from './safe-local-storage.js';

/**
 * Save Device ID to localStorage.
 *
 * Centralized helper to ensure consistent error handling across all Device ID writes.
 * Exported for use by AuthController to store server-issued Device IDs.
 *
 * @param deviceId - The Device ID to save
 */
export function saveDeviceIdToStorage(deviceId: string): void {
  safeLocalStorageSet(STORAGE_KEYS.deviceId, deviceId);
}

/**
 * Get or create a Device ID.
 *
 * Generates a UUID on first call and persists it to localStorage.
 * Subsequent calls return the stored ID.
 *
 * Falls back to an ephemeral UUID if localStorage is unavailable
 * (e.g. private browsing, quota exceeded) — the ID will differ across
 * page loads but the component remains functional.
 *
 * SECURITY: Uses crypto.randomUUID() for cryptographically strong random UUIDs.
 */
export function getOrCreateDeviceId(): string {
  let deviceId = safeLocalStorageGet(STORAGE_KEYS.deviceId);

  if (!deviceId) {
    deviceId = crypto.randomUUID();
    saveDeviceIdToStorage(deviceId);
  }

  return deviceId;
}

/**
 * Get device name.
 *
 * Reads from localStorage, or generates a default based on UserAgent.
 */
export function getDeviceName(): string {
  const stored = safeLocalStorageGet(STORAGE_KEYS.deviceName);
  if (stored) return stored;

  return getDefaultDeviceName();
}

/**
 * Set device name.
 */
export function setDeviceName(name: string): void {
  safeLocalStorageSet(STORAGE_KEYS.deviceName, name);
}

/**
 * Generate default device name from UserAgent.
 *
 * Uses modern RegExp match groups (match[1]) instead of deprecated RegExp.$1.
 */
function getDefaultDeviceName(): string {
  const ua = navigator.userAgent;

  // Extract browser name and version
  // Order matters: check more specific browsers first
  let match: RegExpMatchArray | null;

  match = ua.match(/Edg\/(\d+)/);
  if (match) return `Edge ${match[1]}`;

  match = ua.match(/Chrome\/(\d+)/);
  if (match) return `Chrome ${match[1]}`;

  match = ua.match(/Firefox\/(\d+)/);
  if (match) return `Firefox ${match[1]}`;

  match = ua.match(/Safari\/(\d+)/);
  if (match && /Version\/(\d+)/.test(ua)) {
    const versionMatch = ua.match(/Version\/(\d+)/);
    return `Safari ${versionMatch ? versionMatch[1] : 'Unknown'}`;
  }

  return 'Unknown Browser';
}
