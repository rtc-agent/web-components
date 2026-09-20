/**
 * Device ID Management
 *
 * Utilities for generating and persisting device identifiers.
 */
import {STORAGE_KEYS} from '../config/auth.js';

/**
 * Get or create a Device ID.
 *
 * Generates a UUID on first call and persists it to localStorage.
 * Subsequent calls return the stored ID.
 *
 * Falls back to an ephemeral UUID if localStorage is unavailable
 * (e.g. private browsing, quota exceeded) — the ID will differ across
 * page loads but the component remains functional.
 */
export function getOrCreateDeviceId(): string {
    try {
        let deviceId = localStorage.getItem(STORAGE_KEYS.deviceId);

        if (!deviceId) {
            deviceId = crypto.randomUUID();
            localStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
        }

        return deviceId;
    } catch {
        // localStorage unavailable — return ephemeral UUID
        return crypto.randomUUID();
    }
}

/**
 * Get device name.
 *
 * Reads from localStorage, or generates a default based on UserAgent.
 */
export function getDeviceName(): string {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.deviceName);
        if (stored) return stored;
    } catch {
        // localStorage unavailable
    }

    return getDefaultDeviceName();
}

/**
 * Set device name.
 */
export function setDeviceName(name: string): void {
    try {
        localStorage.setItem(STORAGE_KEYS.deviceName, name);
    } catch {
        // localStorage may be unavailable (private browsing, quota exceeded)
    }
}

/** Generate default device name from UserAgent */
function getDefaultDeviceName(): string {
    const ua = navigator.userAgent;

    if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux PC';
    if (/iPhone|iPad/.test(ua)) return 'iOS Device';
    if (/Android/.test(ua)) return 'Android Device';

    return 'Unknown Device';
}
