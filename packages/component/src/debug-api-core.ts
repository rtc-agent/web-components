/**
 * Debug API — core implementation.
 *
 * Builds the core debug API methods: state query, data manipulation,
 * auth bypass, event simulation, VirtualFS, log capture, UI control,
 * and component reference.
 */
import {virtualFS} from '@rtc-agent/persistence';
import type {RtcAgentDebugAPI} from './debug-api-types.js';
import {
    log,
    ensureDatabase,
    logBuffer,
    deepQuerySelector,
    getAgentElement,
} from './debug-api-helpers.js';
import type {ContentData} from './types/index.js';

/**
 * Build core debug API methods.
 *
 * Returns a partial implementation covering state, data, auth, events,
 * VirtualFS, logs, UI control, and component reference.
 */
export function buildCoreAPI(): Pick<
    RtcAgentDebugAPI,
    | 'getState' | 'clearData' | 'seedData'
    | 'loginAs' | 'logout'
    | 'triggerEvent'
    | 'listFiles' | 'readFile' | 'writeFile' | 'deleteFile'
    | 'logs' | 'clearLogs'
    | 'click' | 'scrollIntoView' | 'typeText'
    | 'element' | 'waitForReady' | 'waitForConnected'
    | 'sendMessage' | 'getMessages' | 'addDemoMessage' | 'clearMessages'
> {
    return {
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
                toolCalls: {
                    pending: el.toolCallController.value.state.pendingCalls.length,
                },
                settings: {
                    ...el.settingsController.value.state,
                },
            };
        },

        // ── Data Manipulation ──

        async clearData(): Promise<void> {
            try {
                const el = getAgentElement();

                // Step 1: Disconnect persistence layer FIRST.
                if (el?.persistenceController?.isConnected) {
                    try {
                        await el.persistenceController.disconnect();
                        log.info('Persistence layer disconnected');
                    } catch (err) {
                        log.warn('Persistence disconnect error (non-fatal):', err);
                    }
                }

                // Step 2: Reset auth state.
                if (el?.authController?.state.isLoggedIn) {
                    el.authController.logout();
                    log.info('Auth state reset');
                }

                // Step 3: Clear storage.
                localStorage.clear();
                sessionStorage.clear();

                // Step 4: Delete IndexedDB databases.
                if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
                    const dbs = await indexedDB.databases();
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
                const tokens = data.tokens as {
                    accessToken?: string;
                    refreshToken?: string;
                    userId?: string;
                    expiresIn?: number;
                };
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
                const files = data.files as Array<{path: string; content: string}>;
                for (const file of files) {
                    await virtualFS.write(file.path, file.content, 'overwrite');
                }
                log.info(`Seeded ${files.length} files to VirtualFS`);
            }
        },

        // ── Auth Bypass ──

        loginAs(userId: string, tokens?: {accessToken?: string; refreshToken?: string}): void {
            const el = getAgentElement();
            if (!el) {
                log.error('loginAs: rtc-agent element not found');
                return;
            }
            el.authController.setTokens({
                accessToken: tokens?.accessToken ?? `debug-token-${userId}`,
                refreshToken: tokens?.refreshToken ?? `debug-refresh-${userId}`,
                userId,
                expiresIn: 86400,
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
                return await virtualFS.ls(path);
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

            const target = deepQuerySelector(el, selector) as
                | HTMLInputElement
                | HTMLTextAreaElement
                | null;
            if (!target) {
                log.warn(`typeText: element not found: ${selector}`);
                return false;
            }

            const proto = target instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            setter?.call(target, text);

            target.dispatchEvent(new Event('input', {bubbles: true}));
            target.dispatchEvent(new Event('change', {bubbles: true}));

            log.info(`typeText: ${selector} = "${text.slice(0, 50)}..."`);
            return true;
        },

        // ── Component Reference ──

        get element() {
            return getAgentElement();
        },

        async waitForReady(timeoutMs = 10000) {
            const existing = getAgentElement();
            if (existing && existing.isConnected && existing.shadowRoot?.querySelector('*')) {
                return existing;
            }

            return new Promise<NonNullable<ReturnType<typeof getAgentElement>>>((resolve, reject) => {
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
                // Single cleanup function prevents timer leaks: all exit paths
                // (connected, timeout) clear BOTH timers before resolving.
                let resolved = false;
                const done = (result: boolean) => {
                    if (resolved) return;
                    resolved = true;
                    clearInterval(interval);
                    clearTimeout(timeout);
                    resolve(result);
                };

                const interval = setInterval(() => {
                    if (el.persistenceController.isConnected) done(true);
                }, 200);
                const timeout = setTimeout(() => done(false), timeoutMs);
            });
        },

        // ── Message Operations ──

        async sendMessage(content: string): Promise<void> {
            const el = getAgentElement();
            if (!el) {
                log.error('sendMessage: rtc-agent element not found');
                return;
            }
            const contentData: ContentData = {type: 'text', data: content};
            await el.messageController.actions.sendMessage(contentData);
            log.info(`sendMessage: "${content.slice(0, 50)}..."`);
        },

        getMessages() {
            const el = getAgentElement();
            if (!el) return [];
            return el.messageController.value.state.messages.map(m => ({
                clientId: m.clientId,
                role: m.role,
                content: m.content,
                timestamp: m.timestamp,
                syncStatus: m.syncStatus,
                streaming: m.streaming ?? false,
            }));
        },

        addDemoMessage(content: string, role: 'user' | 'assistant' = 'assistant'): void {
            const el = getAgentElement();
            if (!el) {
                log.error('addDemoMessage: rtc-agent element not found');
                return;
            }
            if (role === 'assistant') {
                el.messageController.addDemoAssistantMessage(content);
            } else {
                const msg = {
                    clientId: `msg-${Date.now()}-user`,
                    role: 'user' as const,
                    content: {type: 'text' as const, data: content},
                    timestamp: Date.now(),
                    syncStatus: 'synced' as const,
                    streaming: false,
                };
                el.dispatchEvent(new CustomEvent('rtc-debug-add-user-message', {
                    detail: {message: msg},
                    bubbles: true,
                    composed: true,
                }));
            }
            log.info(`addDemoMessage: [${role}] "${content.slice(0, 50)}..."`);
        },

        clearMessages(): void {
            const el = getAgentElement();
            if (!el) {
                log.error('clearMessages: rtc-agent element not found');
                return;
            }
            el.messageController.actions.clearMessages();
            log.info('clearMessages: done');
        },
    };
}
