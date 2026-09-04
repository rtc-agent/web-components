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
 */
export function getOrCreateDeviceId(): string {
    let deviceId = localStorage.getItem(STORAGE_KEYS.deviceId);

    if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEYS.deviceId, deviceId);
    }

    return deviceId;
}

/**
 * Get device name.
 *
 * Reads from localStorage, or generates a default based on UserAgent.
 */
export function getDeviceName(): string {
    const stored = localStorage.getItem(STORAGE_KEYS.deviceName);
    if (stored) return stored;

    return getDefaultDeviceName();
}

/**
 * Set device name.
 */
export function setDeviceName(name: string): void {
    localStorage.setItem(STORAGE_KEYS.deviceName, name);
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
