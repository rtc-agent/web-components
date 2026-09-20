/**
 * Debug API entry point.
 *
 * Composes the debug API from core and extended implementations and installs
 * it on `window.rtcAgentDebug`. Only injected in dev/test builds.
 *
 * Module structure:
 * - `debug-api-types.ts` — Interface definition (RtcAgentDebugAPI)
 * - `debug-api-helpers.ts` — Shared utilities (log capture, CSS selector, DB init)
 * - `debug-api-core.ts` — Core APIs (state, data, auth, events, VFS, logs, UI)
 * - `debug-api-ext.ts` — Extended APIs (session, tools, toast, settings, metrics, network)
 * - `debug-api.ts` — This file: entry point + installDebugAPI()
 */
import {createLogger} from '@rtc-agent/client';
import type {RtcAgentDebugAPI} from './debug-api-types.js';
import {installLogCapture} from './debug-api-helpers.js';
import {buildCoreAPI} from './debug-api-core.js';
import {buildExtAPI} from './debug-api-ext.js';

const log = createLogger('DebugAPI');

export type {RtcAgentDebugAPI} from './debug-api-types.js';

/**
 * Build and install the debug API on window.rtcAgentDebug.
 *
 * Composes core and extended APIs into a single frozen object and assigns it
 * to `window.rtcAgentDebug`. Should be called once, after the component module
 * is loaded, in dev/test builds only.
 */
export function installDebugAPI(): void {
    if (typeof window === 'undefined') return;
    if (window.rtcAgentDebug) {
        log.warn('Debug API already installed, skipping');
        return;
    }

    // Install log capture first so we capture logs from API construction.
    installLogCapture();

    // Compose the API from core and extended implementations.
    // Note: we cannot use simple spread because `isOffline` and `logs` are getters
    // that must remain dynamic. Spreading would evaluate them once and copy static values.
    const coreAPI = buildCoreAPI();
    const extAPI = buildExtAPI();

    // Extract getters before spreading to preserve them
    const {isOffline: _isOfflineGetter, ...extAPIWithoutGetter} = extAPI;
    const {logs: _logsGetter, clearLogs, ...coreAPIWithoutGetters} = coreAPI;

    const api: RtcAgentDebugAPI = {
        ...coreAPIWithoutGetters,
        clearLogs,
        ...extAPIWithoutGetter,
    } as RtcAgentDebugAPI;

    // Re-attach logs as a dynamic getter using Object.defineProperty.
    Object.defineProperty(api, 'logs', {
        get: () => {
            const descriptor = Object.getOwnPropertyDescriptor(coreAPI, 'logs');
            return descriptor?.get?.call(coreAPI) ?? [];
        },
        enumerable: true,
        configurable: false,
    });

    // Re-attach isOffline as a dynamic getter using Object.defineProperty.
    Object.defineProperty(api, 'isOffline', {
        get: () => {
            const descriptor = Object.getOwnPropertyDescriptor(extAPI, 'isOffline');
            return descriptor?.get?.call(extAPI) ?? false;
        },
        enumerable: true,
        configurable: false,
    });

    Object.defineProperty(window, 'rtcAgentDebug', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true,
    });

    log.info('Debug API installed on window.rtcAgentDebug');
}
