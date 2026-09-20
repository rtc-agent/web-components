/**
 * Debug API — extended implementation.
 *
 * Builds the extended debug API methods: session management, tool call
 * simulation, toast notifications, settings, activity control, performance
 * metrics, and network simulation.
 */
import type {RtcAgentDebugAPI} from './debug-api-types.js';
import type {ToolCall} from './types/index.js';
import {
    log,
    logBuffer,
    LOG_BUFFER_MAX,
    getAgentElement,
} from './debug-api-helpers.js';

// Re-export mutable state setters for the network simulation
let _originalFetch: typeof fetch | null = null;
let _originalWebSocket: typeof WebSocket | null = null;
let _isOffline = false;

/**
 * Build extended debug API methods.
 *
 * Returns a partial implementation covering session management, tool calls,
 * toast, settings, activity, metrics, and network simulation.
 */
export function buildExtAPI(): Pick<
    RtcAgentDebugAPI,
    | 'createSession' | 'switchSession' | 'deleteSession' | 'renameSession'
    | 'getSessions' | 'getCurrentSessionId'
    | 'getToolCalls' | 'addPendingToolCall' | 'approveToolCall' | 'denyToolCall' | 'approveAllToolCalls'
    | 'showToast' | 'getToasts'
    | 'getSettings' | 'updateSettings'
    | 'setActivity' | 'getActivity'
    | 'getMetrics'
    | 'simulateOffline' | 'restoreNetwork' | 'isOffline'
> {
    return {
        // ── Session Management ──

        createSession(): string | null {
            const el = getAgentElement();
            if (!el) {
                log.error('createSession: rtc-agent element not found');
                return null;
            }
            const clientId = el.sessionController.actions.createSession();
            log.info(`createSession: ${clientId}`);
            return clientId;
        },

        switchSession(sessionId: string): boolean {
            const el = getAgentElement();
            if (!el) {
                log.error('switchSession: rtc-agent element not found');
                return false;
            }
            const exists = el.sessionController.value.state.sessions.some(
                s => s.clientId === sessionId
            );
            if (!exists) {
                log.warn(`switchSession: session not found: ${sessionId}`);
                return false;
            }
            el.sessionController.actions.switchSession(sessionId);
            log.info(`switchSession: ${sessionId}`);
            return true;
        },

        async deleteSession(sessionId: string): Promise<{ok: boolean; error?: string}> {
            const el = getAgentElement();
            if (!el) return {ok: false, error: 'rtc-agent element not found'};
            const result = await el.sessionController.actions.deleteSession(sessionId);
            log.info(`deleteSession: ${sessionId} -> ${result.ok ? 'ok' : result.error}`);
            return result;
        },

        async renameSession(sessionId: string, title: string): Promise<{ok: boolean; error?: string}> {
            const el = getAgentElement();
            if (!el) return {ok: false, error: 'rtc-agent element not found'};
            const result = await el.sessionController.actions.renameSession(sessionId, title);
            log.info(`renameSession: ${sessionId} -> "${title}" (${result.ok ? 'ok' : result.error})`);
            return result;
        },

        getSessions() {
            const el = getAgentElement();
            if (!el) return [];
            return el.sessionController.value.state.sessions.map(s => ({
                clientId: s.clientId,
                title: s.title,
                status: s.status,
                updatedAt: s.updatedAt,
            }));
        },

        getCurrentSessionId(): string | null {
            const el = getAgentElement();
            if (!el) return null;
            return el.sessionController.value.state.currentSessionId;
        },

        // ── Tool Call Simulation ──

        getToolCalls() {
            const el = getAgentElement();
            if (!el) return [];
            return el.toolCallController.value.state.pendingCalls.map(tc => ({
                id: tc.id,
                toolName: tc.toolName,
                command: tc.command,
                description: tc.description,
                parameters: tc.parameters,
            }));
        },

        addPendingToolCall(call: {
            id?: string;
            toolName: string;
            command?: string;
            description?: string;
            parameters?: Record<string, unknown>;
        }): void {
            const el = getAgentElement();
            if (!el) {
                log.error('addPendingToolCall: rtc-agent element not found');
                return;
            }
            const toolCall: ToolCall = {
                id: call.id ?? `tc-${crypto.randomUUID()}`,
                toolName: call.toolName,
                command: call.command,
                description: call.description,
                parameters: call.parameters,
                status: 'pending',
            };
            el.toolCallController.addPendingCall(toolCall);
            log.info(`addPendingToolCall: ${toolCall.toolName} (${toolCall.id})`);
        },

        approveToolCall(callId: string): boolean {
            const el = getAgentElement();
            if (!el) return false;
            const exists = el.toolCallController.value.state.pendingCalls.some(
                tc => tc.id === callId
            );
            if (!exists) {
                log.warn(`approveToolCall: not found: ${callId}`);
                return false;
            }
            el.toolCallController.actions.approve(callId);
            log.info(`approveToolCall: ${callId}`);
            return true;
        },

        denyToolCall(callId: string): boolean {
            const el = getAgentElement();
            if (!el) return false;
            const exists = el.toolCallController.value.state.pendingCalls.some(
                tc => tc.id === callId
            );
            if (!exists) {
                log.warn(`denyToolCall: not found: ${callId}`);
                return false;
            }
            el.toolCallController.actions.deny(callId);
            log.info(`denyToolCall: ${callId}`);
            return true;
        },

        approveAllToolCalls(toolName: string): void {
            const el = getAgentElement();
            if (!el) return;
            el.toolCallController.actions.approveAll(toolName);
            log.info(`approveAllToolCalls: ${toolName}`);
        },

        // ── Toast / Notification ──

        showToast(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
            const el = getAgentElement();
            if (!el) {
                log.error('showToast: rtc-agent element not found');
                return;
            }
            el.toastController.actions.show(message, type);
            log.info(`showToast: [${type}] "${message}"`);
        },

        getToasts() {
            const el = getAgentElement();
            if (!el) return [];
            return el.toastController.toasts.map(t => ({
                id: t.id,
                message: t.message,
                type: t.type,
            }));
        },

        // ── Settings ──

        getSettings(): Record<string, unknown> {
            const el = getAgentElement();
            if (!el) return {};
            return {...el.settingsController.value.state};
        },

        updateSettings(section: string, patch: Record<string, unknown>): void {
            const el = getAgentElement();
            if (!el) {
                log.error('updateSettings: rtc-agent element not found');
                return;
            }
            const actions = el.settingsController.actions;
            switch (section) {
                case 'appearance':
                    actions.updateAppearance(patch as any);
                    break;
                case 'chat':
                    actions.updateChat(patch as any);
                    break;
                case 'files':
                    actions.updateFiles(patch as any);
                    break;
                case 'notifications':
                    actions.updateNotifications(patch as any);
                    break;
                default:
                    log.warn(`updateSettings: unknown section "${section}"`);
            }
            log.info(`updateSettings: ${section} = ${JSON.stringify(patch)}`);
        },

        // ── Activity / Layout ──

        setActivity(activity: string): void {
            const el = getAgentElement();
            if (!el) {
                log.error('setActivity: rtc-agent element not found');
                return;
            }
            el.activityController.actions.setActivity(activity as any);
            log.info(`setActivity: ${activity}`);
        },

        getActivity(): {active: string; sidebarVisible: boolean} {
            const el = getAgentElement();
            if (!el) return {active: 'chat', sidebarVisible: true};
            return {
                active: el.activityController.active,
                sidebarVisible: el.activityController.sidebarVisible,
            };
        },

        // ── Performance Metrics ──

        getMetrics(): Record<string, unknown> {
            const metrics: Record<string, unknown> = {};

            // DOM metrics
            metrics.dom = {
                nodeCount: document.querySelectorAll('*').length,
                rtcAgentChildren: getAgentElement()?.shadowRoot?.querySelectorAll('*').length ?? 0,
            };

            // Memory (Chrome only)
            if ((performance as any).memory) {
                const mem = (performance as any).memory;
                metrics.memory = {
                    usedJSHeapSize: mem.usedJSHeapSize,
                    totalJSHeapSize: mem.totalJSHeapSize,
                    jsHeapSizeLimit: mem.jsHeapSizeLimit,
                    usedMB: Math.round(mem.usedJSHeapSize / 1024 / 1024),
                    totalMB: Math.round(mem.totalJSHeapSize / 1024 / 1024),
                };
            }

            // Navigation timing
            if (performance.getEntriesByType) {
                const nav = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
                if (nav.length > 0) {
                    metrics.timing = {
                        domContentLoaded: Math.round(nav[0].domContentLoadedEventEnd - nav[0].startTime),
                        loadComplete: Math.round(nav[0].loadEventEnd - nav[0].startTime),
                        domInteractive: Math.round(nav[0].domInteractive - nav[0].startTime),
                    };
                }
            }

            // Resource timing summary
            const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
            metrics.resources = {
                total: resources.length,
                totalTransferSize: resources.reduce((sum, r) => sum + (r.transferSize ?? 0), 0),
            };

            // Component state summary
            const el = getAgentElement();
            if (el) {
                metrics.component = {
                    isConnected: el.isConnected,
                    hasShadowRoot: !!el.shadowRoot,
                    sessionCount: el.sessionController.value.state.sessions.length,
                    messageCount: el.messageController.value.state.messages.length,
                    pendingToolCalls: el.toolCallController.value.state.pendingCalls.length,
                    persistenceConnected: el.persistenceController.isConnected,
                };
            }

            // Log buffer stats
            metrics.logs = {
                bufferLength: logBuffer.length,
                bufferMax: LOG_BUFFER_MAX,
            };

            return metrics;
        },

        // ── Network Simulation ──

        simulateOffline(): void {
            if (_isOffline) {
                log.warn('simulateOffline: already offline');
                return;
            }

            _originalFetch = window.fetch;
            _originalWebSocket = window.WebSocket;

            // Block fetch with a rejecting stub.
            window.fetch = (() => {
                return Promise.reject(
                    new DOMException('Failed to fetch (simulated offline)', 'NetworkError')
                );
            }) as typeof fetch;

            // Block WebSocket with a stub that fires error immediately.
            const OfflineWebSocket = function(this: WebSocket, url: string | URL, _protocols?: string | string[]) {
                log.info(`simulateOffline: blocked WebSocket to ${url}`);
                const ws = new EventTarget() as unknown as WebSocket;
                setTimeout(() => {
                    ws.dispatchEvent(new Event('error'));
                    ws.dispatchEvent(new CloseEvent('close', {code: 1006, reason: 'Simulated offline'}));
                }, 0);
                return ws;
            } as unknown as typeof WebSocket;

            (OfflineWebSocket as any).CONNECTING = 0;
            (OfflineWebSocket as any).OPEN = 1;
            (OfflineWebSocket as any).CLOSING = 2;
            (OfflineWebSocket as any).CLOSED = 3;

            window.WebSocket = OfflineWebSocket;
            _isOffline = true;
            log.info('simulateOffline: network simulation active (fetch + WebSocket blocked)');
        },

        restoreNetwork(): void {
            if (!_isOffline) {
                log.warn('restoreNetwork: not currently offline');
                return;
            }

            if (_originalFetch) {
                window.fetch = _originalFetch;
                _originalFetch = null;
            }
            if (_originalWebSocket) {
                window.WebSocket = _originalWebSocket;
                _originalWebSocket = null;
            }
            _isOffline = false;
            log.info('restoreNetwork: normal network behavior restored');
        },

        get isOffline(): boolean {
            return _isOffline;
        },
    };
}
