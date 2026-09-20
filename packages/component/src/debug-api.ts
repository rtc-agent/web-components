/**
 * Debug API for E2E testing and development.
 *
 * Exposes `window.rtcAgentDebug` with state inspection, data manipulation,
 * auth bypass, event simulation, VirtualFS access, and UI control APIs.
 *
 * This module is only injected in dev/test builds (guarded by import.meta.env.DEV).
 * It MUST NOT be included in production bundles.
 */
import {virtualFS, getDatabase} from '@rtc-agent/persistence';
import {createLogger} from '@rtc-agent/client';
import type {RtcAgent} from './components/rtc-agent/rtc-agent.js';

const log = createLogger('DebugAPI');

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
function ensureDatabase(): void {
    try {
        // getDatabase() without args returns the existing singleton if present.
        getDatabase();
    } catch {
        // No database yet — open the debug database.
        log.info(`Initializing debug database: ${DEBUG_DB_NAME}`);
        getDatabase(DEBUG_DB_NAME);
    }
}

/**
 * Ring buffer that captures recent log entries for replay in tests.
 *
 * Shared with the logger wrapper injected by installDebugLogCapture().
 */
const LOG_BUFFER_MAX = 500;
const logBuffer: string[] = [];

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
function installLogCapture(): void {
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

/**
 * The shape of `window.rtcAgentDebug`.
 *
 * All methods are safe to call at any time; they return sensible defaults
 * when the component is not yet connected or persistence is not ready.
 */
export interface RtcAgentDebugAPI {
    // ── State Query ──

    /**
     * Snapshot of the component's internal state.
     *
     * Returns auth, session, messages, window mode, activity, connection,
     * and other controller states as plain objects.
     */
    getState(): Record<string, unknown>;

    // ── Data Manipulation ──

    /**
     * Clear all persistent data and disconnect live connections.
     *
     * Performs a full teardown in the correct order:
     * 1. Disconnect persistence layer (closes SharedWorker, Centrifuge WS, WorkerBridge)
     * 2. Reset auth state (clears tokens, stops refresh timers)
     * 3. Clear localStorage, sessionStorage, and all IndexedDB databases
     *
     * This ensures no stale async callbacks (e.g., Centrifuge token expiry -> handleTokenExpired
     * -> _logout) can corrupt state after clearing. After calling, the component is in a clean
     * initial state and ready for re-login without requiring a page reload.
     */
    clearData(): Promise<void>;

    /**
     * Seed test data into the component.
     *
     * Supported keys:
     * - `tokens`: { accessToken, refreshToken, userId, expiresIn } — bypass auth
     * - `messages`: not directly supported (messages come from server via persistence)
     */
    seedData(data: Record<string, unknown>): Promise<void>;

    // ── Auth Bypass ──

    /**
     * Skip the OAuth2 flow and inject tokens directly.
     *
     * This triggers the same code path as a successful OAuth2 callback,
     * including persistence connection and session loading.
     */
    loginAs(userId: string, tokens?: { accessToken?: string; refreshToken?: string }): void;

    /**
     * Log out the current user (clears tokens, disconnects persistence).
     */
    logout(): void;

    // ── Event Simulation ──

    /**
     * Dispatch a custom event on the <rtc-agent> element.
     *
     * The event bubbles and crosses shadow DOM boundaries (composed: true).
     */
    triggerEvent(name: string, detail?: unknown): void;

    // ── VirtualFS ──

    /**
     * List all files in the virtual file system (recursive).
     */
    listFiles(path?: string): Promise<string[]>;

    /**
     * Read a file from the virtual file system.
     */
    readFile(path: string): Promise<string>;

    /**
     * Write a file to the virtual file system.
     */
    writeFile(path: string, content: string): Promise<void>;

    /**
     * Delete a file from the virtual file system.
     */
    deleteFile(path: string): Promise<void>;

    // ── Logs ──

    /**
     * Recent log entries (ring buffer, newest last).
     *
     * Each entry is formatted as `[ISO-timestamp] [level] message`.
     */
    readonly logs: readonly string[];

    /**
     * Clear the log buffer.
     */
    clearLogs(): void;

    // ── UI Control ──

    /**
     * Click an element matching the given CSS selector (within the component's shadow DOM).
     *
     * Supports deep selectors using `::shadow` or `/deep/` syntax by splitting
     * on those tokens and traversing shadow boundaries.
     */
    click(selector: string): Promise<boolean>;

    /**
     * Scroll an element into view within the component.
     */
    scrollIntoView(selector: string): Promise<boolean>;

    /**
     * Type text into an input element (fires input + change events).
     */
    typeText(selector: string, text: string): Promise<boolean>;

    // ── Component Reference ──

    /**
     * Direct reference to the <rtc-agent> element (for advanced test scenarios).
     */
    readonly element: RtcAgent | null;

    /**
     * Wait for the component to be ready (rtc-agent-ready event fired).
     *
     * Returns immediately if already ready.
     */
    waitForReady(timeoutMs?: number): Promise<RtcAgent>;

    /**
     * Wait for persistence to connect.
     *
     * Returns true if connected within timeout, false otherwise.
     */
    waitForConnected(timeoutMs?: number): Promise<boolean>;
}

/**
 * Query a CSS selector that may cross shadow DOM boundaries.
 *
 * Supports `>>>` as a shadow-piercing combinator.
 * Example: `'rtc-agent >>> rtc-chat-layout >>> rtc-input-area'`
 */
function deepQuerySelector(root: Node, selector: string): Element | null {
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

        // Move to the found element's shadow root for the next part.
        current = (found as Element).shadowRoot ?? found;
    }

    return null;
}

/**
 * Get the <rtc-agent> element from the page.
 */
function getAgentElement(): RtcAgent | null {
    return document.querySelector<RtcAgent>('rtc-agent');
}

/**
 * Build and install the debug API on window.rtcAgentDebug.
 *
 * Should be called once, after the component module is loaded, in dev/test builds only.
 */
export function installDebugAPI(): void {
    if (typeof window === 'undefined') return;
    if ((window as any).rtcAgentDebug) {
        log.warn('Debug API already installed, skipping');
        return;
    }

    // Install log capture first so we capture logs from API construction.
    installLogCapture();

    const api: RtcAgentDebugAPI = {
        // ── State Query ──

        getState(): Record<string, unknown> {
            const el = getAgentElement();
            if (!el) return {error: 'rtc-agent element not found'};

            return {
                auth: {
                    isLoggedIn: el.authController.state.isLoggedIn,
                    userId: el.authController.state.userId,
                    expiresAt: el.authController.state.expiresAt,
                },
                session: {
                    currentSessionId: el.sessionController.value.state.currentSessionId,
                    sessions: el.sessionController.value.state.sessions.map(s => ({
                        clientId: s.clientId,
                        title: s.title,
                        status: s.status,
                        updatedAt: s.updatedAt,
                    })),
                },
                messages: {
                    count: el.messageController.value.state.messages.length,
                    messages: el.messageController.value.state.messages.map(m => ({
                        clientId: m.clientId,
                        role: m.role,
                        streaming: m.streaming,
                        syncStatus: m.syncStatus,
                        timestamp: m.timestamp,
                    })),
                    hasMore: el.messageController.value.state.hasMore,
                },
                window: {
                    mode: el.windowStateController.value.state.mode,
                    position: el.windowStateController.value.state.position,
                    size: el.windowStateController.value.state.size,
                },
                activity: {
                    active: el.activityController.active,
                    sidebarVisible: el.activityController.sidebarVisible,
                },
                connection: {
                    failed: el.connectionFailed,
                    error: el.connectionError,
                },
                tabs: {
                    activeSessionId: el.sessionTabController.value.state.activeSessionId,
                    tabs: el.sessionTabController.value.state.tabs.map(t => ({
                        sessionId: t.sessionId,
                        title: t.title,
                        isUnsaved: t.isUnsaved,
                    })),
                },
                persistence: {
                    isConnected: el.persistenceController.isConnected,
                },
            };
        },

        // ── Data Manipulation ──

        async clearData(): Promise<void> {
            try {
                const el = getAgentElement();

                // Step 1: Disconnect persistence layer FIRST.
                // This closes the SharedWorker's Centrifuge WS and WorkerBridge,
                // preventing stale async callbacks (token expiry -> handleTokenExpired
                // -> _logout) from corrupting state after storage is cleared.
                if (el?.persistenceController?.isConnected) {
                    try {
                        await el.persistenceController.disconnect();
                        log.info('Persistence layer disconnected');
                    } catch (err) {
                        log.warn('Persistence disconnect error (non-fatal):', err);
                    }
                }

                // Step 2: Reset auth state (clear tokens, stop refresh timers).
                // This ensures no pending token refresh can interfere.
                if (el?.authController?.state.isLoggedIn) {
                    el.authController.logout();
                    log.info('Auth state reset');
                }

                // Step 3: Clear localStorage and sessionStorage.
                localStorage.clear();
                sessionStorage.clear();

                // Step 4: Close and delete IndexedDB databases.
                if (typeof indexedDB !== 'undefined' && 'databases' in indexedDB) {
                    const dbs = await (indexedDB as any).databases();
                    for (const dbInfo of dbs) {
                        if (dbInfo.name) {
                            indexedDB.deleteDatabase(dbInfo.name);
                            log.info(`Deleted IndexedDB: ${dbInfo.name}`);
                        }
                    }
                }

                log.info('All persistent data cleared');
            } catch (err) {
                log.error('clearData failed:', err);
                throw err;
            }
        },

        async seedData(data: Record<string, unknown>): Promise<void> {
            if (data.tokens) {
                const tokens = data.tokens as { accessToken?: string; refreshToken?: string; userId?: string; expiresIn?: number };
                const el = getAgentElement();
                if (el) {
                    el.authController.setTokens({
                        accessToken: tokens.accessToken ?? 'debug-access-token',
                        refreshToken: tokens.refreshToken ?? 'debug-refresh-token',
                        userId: tokens.userId ?? 'debug-user',
                        expiresIn: tokens.expiresIn ?? 3600,
                    });
                    log.info('Seeded auth tokens');
                }
            }

            if (data.files) {
                ensureDatabase();
                const files = data.files as Array<{ path: string; content: string }>;
                for (const file of files) {
                    await virtualFS.write(file.path, file.content, 'overwrite');
                }
                log.info(`Seeded ${files.length} files to VirtualFS`);
            }
        },

        // ── Auth Bypass ──

        loginAs(userId: string, tokens?: { accessToken?: string; refreshToken?: string }): void {
            const el = getAgentElement();
            if (!el) {
                log.error('loginAs: rtc-agent element not found');
                return;
            }
            el.authController.setTokens({
                accessToken: tokens?.accessToken ?? `debug-token-${userId}`,
                refreshToken: tokens?.refreshToken ?? `debug-refresh-${userId}`,
                userId,
                expiresIn: 86400, // 24 hours
            });
            log.info(`loginAs: ${userId}`);
        },

        logout(): void {
            const el = getAgentElement();
            if (!el) {
                log.error('logout: rtc-agent element not found');
                return;
            }
            el.authController.logout();
            log.info('logout completed');
        },

        // ── Event Simulation ──

        triggerEvent(name: string, detail?: unknown): void {
            const el = getAgentElement();
            if (!el) {
                log.error('triggerEvent: rtc-agent element not found');
                return;
            }
            el.dispatchEvent(new CustomEvent(name, {
                detail,
                bubbles: true,
                composed: true,
            }));
            log.info(`triggerEvent: ${name}`);
        },

        // ── VirtualFS ──

        async listFiles(path = '/'): Promise<string[]> {
            ensureDatabase();
            try {
                const entries = await virtualFS.ls(path);
                return entries;
            } catch (err) {
                log.error('listFiles failed:', err);
                return [];
            }
        },

        async readFile(path: string): Promise<string> {
            ensureDatabase();
            try {
                return await virtualFS.read(path);
            } catch (err) {
                log.error(`readFile failed for ${path}:`, err);
                return '';
            }
        },

        async writeFile(path: string, content: string): Promise<void> {
            ensureDatabase();
            await virtualFS.write(path, content, 'overwrite');
            log.info(`writeFile: ${path}`);
        },

        async deleteFile(path: string): Promise<void> {
            ensureDatabase();
            await virtualFS.remove(path);
            log.info(`deleteFile: ${path}`);
        },

        // ── Logs ──

        get logs(): readonly string[] {
            return [...logBuffer];
        },

        clearLogs(): void {
            logBuffer.length = 0;
        },

        // ── UI Control ──

        async click(selector: string): Promise<boolean> {
            const el = getAgentElement();
            if (!el) return false;

            const target = deepQuerySelector(el, selector);
            if (!target) {
                log.warn(`click: element not found: ${selector}`);
                return false;
            }

            (target as HTMLElement).click?.();
            log.info(`click: ${selector}`);
            return true;
        },

        async scrollIntoView(selector: string): Promise<boolean> {
            const el = getAgentElement();
            if (!el) return false;

            const target = deepQuerySelector(el, selector);
            if (!target) {
                log.warn(`scrollIntoView: element not found: ${selector}`);
                return false;
            }

            (target as HTMLElement).scrollIntoView?.({behavior: 'smooth', block: 'center'});
            log.info(`scrollIntoView: ${selector}`);
            return true;
        },

        async typeText(selector: string, text: string): Promise<boolean> {
            const el = getAgentElement();
            if (!el) return false;

            const target = deepQuerySelector(el, selector) as HTMLInputElement | HTMLTextAreaElement | null;
            if (!target) {
                log.warn(`typeText: element not found: ${selector}`);
                return false;
            }

            // Set value and dispatch events to trigger Lit/React/Vue reactivity.
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
                'value'
            )?.set;
            nativeInputValueSetter?.call(target, text);

            target.dispatchEvent(new Event('input', {bubbles: true}));
            target.dispatchEvent(new Event('change', {bubbles: true}));

            log.info(`typeText: ${selector} = "${text.slice(0, 50)}..."`);
            return true;
        },

        // ── Component Reference ──

        get element(): RtcAgent | null {
            return getAgentElement();
        },

        async waitForReady(timeoutMs = 10000): Promise<RtcAgent> {
            // Check if already ready by testing if firstUpdated has run
            // (the rtc-agent-ready event is dispatched in firstUpdated).
            const existing = getAgentElement();
            if (existing && existing.isConnected && existing.shadowRoot?.querySelector('*')) {
                return existing;
            }

            return new Promise<RtcAgent>((resolve, reject) => {
                const timer = setTimeout(() => {
                    document.removeEventListener('rtc-agent-ready', handler);
                    reject(new Error(`waitForReady timed out after ${timeoutMs}ms`));
                }, timeoutMs);

                const handler = () => {
                    clearTimeout(timer);
                    const el = getAgentElement();
                    if (el) {
                        resolve(el);
                    } else {
                        reject(new Error('rtc-agent element not found after ready event'));
                    }
                };

                document.addEventListener('rtc-agent-ready', handler, {once: true});
            });
        },

        async waitForConnected(timeoutMs = 15000): Promise<boolean> {
            const el = getAgentElement();
            if (!el) return false;
            if (el.persistenceController.isConnected) return true;

            return new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => {
                    resolve(false);
                }, timeoutMs);

                // Poll connection state.
                const interval = setInterval(() => {
                    if (el.persistenceController.isConnected) {
                        clearInterval(interval);
                        clearTimeout(timer);
                        resolve(true);
                    }
                }, 200);
            });
        },
    };

    Object.defineProperty(window, 'rtcAgentDebug', {
        value: api,
        writable: false,
        configurable: false,
        enumerable: true,
    });

    log.info('Debug API installed on window.rtcAgentDebug');
}
