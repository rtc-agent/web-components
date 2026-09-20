/**
 * Debug API helpers — shared utilities for the debug API implementation.
 *
 * Includes: database initialization, log capture, CSS deep selector,
 * element lookup, and network simulation state.
 */
import {getDatabase} from '@rtc-agent/persistence';
import {createLogger} from '@rtc-agent/client';
import type {RtcAgent} from './components/rtc-agent/rtc-agent.js';

export const log = createLogger('DebugAPI');

/** Default database name used by the debug API when persistence is not connected. */
const DEBUG_DB_NAME = 'rtc-agent-debug';

/**
 * Ensure the database singleton is initialized before VirtualFS operations.
 *
 * VirtualFS methods call `getDatabase()` without a name, which fails if no
 * database has been opened yet. This helper lazily opens a debug-specific
 * database so that VirtualFS operations work even when persistence is not
 * connected (e.g., standalone debug pages without a server).
 *
 * Safe to call multiple times (idempotent).
 */
export function ensureDatabase(): void {
    try {
        getDatabase();
    } catch {
        log.info(`Initializing debug database: ${DEBUG_DB_NAME}`);
        getDatabase(DEBUG_DB_NAME);
    }
}

// ── Log Capture ──

/** Maximum number of log entries retained in the ring buffer. */
export const LOG_BUFFER_MAX = 500;

/** Ring buffer that captures recent log entries for replay in tests. */
export const logBuffer: string[] = [];

/**
 * Format a log entry with timestamp and level.
 */
function formatLogEntry(level: string, args: unknown[]): string {
    const ts = new Date().toISOString();
    const msg = args.map(a => {
        if (typeof a === 'string') return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    return `[${ts}] [${level}] ${msg}`;
}

/**
 * Install log capture: wraps console.debug/info/warn/error to also push
 * entries into the log buffer.
 *
 * Safe to call multiple times (idempotent via a flag on window).
 */
export function installLogCapture(): void {
    if ((window as any).__rtcDebugLogCaptured) return;
    (window as any).__rtcDebugLogCaptured = true;

    const levels = ['debug', 'info', 'warn', 'error'] as const;
    for (const level of levels) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            logBuffer.push(formatLogEntry(level, args));
            if (logBuffer.length > LOG_BUFFER_MAX) {
                logBuffer.splice(0, logBuffer.length - LOG_BUFFER_MAX);
            }
            original(...args);
        };
    }
}

// ── CSS Deep Selector ──

/**
 * Query a CSS selector that may cross shadow DOM boundaries.
 *
 * Supports `>>>` as a shadow-piercing combinator.
 * Example: `'rtc-agent >>> rtc-chat-layout >>> rtc-input-area'`
 */
export function deepQuerySelector(root: Node, selector: string): Element | null {
    const parts = selector.split(/\s*>>>\s*/);
    let current: Node | null = root;

    for (let i = 0; i < parts.length; i++) {
        if (!current) return null;
        const part = parts[i].trim();
        if (!part) continue;

        let searchRoot: ParentNode;
        if (current instanceof ShadowRoot) {
            searchRoot = current;
        } else if (current instanceof Element && current.shadowRoot) {
            searchRoot = current.shadowRoot;
        } else if (current instanceof Element) {
            searchRoot = current.ownerDocument ?? document;
        } else {
            searchRoot = document;
        }

        const found: Element | null = searchRoot.querySelector(part);
        if (!found) return null;

        if (i === parts.length - 1) return found;

        current = (found as Element).shadowRoot ?? found;
    }

    return null;
}

// ── Element Lookup ──

/** Get the <rtc-agent> element from the page. */
export function getAgentElement(): RtcAgent | null {
    return document.querySelector<RtcAgent>('rtc-agent');
}
