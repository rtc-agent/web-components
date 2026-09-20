/**
 * Playwright E2E tests for window.rtcAgentDebug API.
 *
 * These tests verify the debug infrastructure that powers E2E testing
 * and development introspection for the <rtc-agent> component.
 *
 * Prerequisites: Vite dev server running (started automatically by Playwright).
 * The debug API is installed automatically in DEV mode when <rtc-agent> renders.
 *
 * Run: npx playwright test --config=packages/component/playwright.config.ts
 */
import {test, expect, type Page} from '@playwright/test';

/** URL of the debug page that hosts <rtc-agent> and installs the debug API. */
const DEBUG_PAGE = '/debug/index.html';

/**
 * Wait for the debug API to become available on the page.
 *
 * The API is installed during <rtc-agent>'s firstUpdated lifecycle,
 * which may complete after Playwright's load event fires.
 */
async function waitForDebugAPI(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        // @ts-expect-error debug API not in default types
        return typeof window.rtcAgentDebug !== 'undefined';
    }, {timeout: 15_000});
}

// ────────────────────────────────────────────────────────────────────────────
// Debug API Installation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Installation', () => {
    test('window.rtcAgentDebug is available on debug page', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const exists = await page.evaluate(() => {
            // @ts-expect-error debug API
            return typeof window.rtcAgentDebug === 'object';
        });
        expect(exists).toBe(true);
    });

    test('debug API exposes all expected methods', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const methods = await page.evaluate(() => {
            // @ts-expect-error debug API
            const api = window.rtcAgentDebug;
            return {
                // State Query
                getState: typeof api.getState,
                // Data Manipulation
                clearData: typeof api.clearData,
                seedData: typeof api.seedData,
                // Auth
                loginAs: typeof api.loginAs,
                logout: typeof api.logout,
                // Events
                triggerEvent: typeof api.triggerEvent,
                // VirtualFS
                listFiles: typeof api.listFiles,
                readFile: typeof api.readFile,
                writeFile: typeof api.writeFile,
                deleteFile: typeof api.deleteFile,
                // UI Control
                click: typeof api.click,
                scrollIntoView: typeof api.scrollIntoView,
                typeText: typeof api.typeText,
                // Component Reference
                waitForReady: typeof api.waitForReady,
                waitForConnected: typeof api.waitForConnected,
                clearLogs: typeof api.clearLogs,
                // Session Management
                createSession: typeof api.createSession,
                switchSession: typeof api.switchSession,
                deleteSession: typeof api.deleteSession,
                renameSession: typeof api.renameSession,
                getSessions: typeof api.getSessions,
                getCurrentSessionId: typeof api.getCurrentSessionId,
                // Message Operations
                sendMessage: typeof api.sendMessage,
                getMessages: typeof api.getMessages,
                addDemoMessage: typeof api.addDemoMessage,
                clearMessages: typeof api.clearMessages,
                // Tool Call Simulation
                getToolCalls: typeof api.getToolCalls,
                addPendingToolCall: typeof api.addPendingToolCall,
                approveToolCall: typeof api.approveToolCall,
                denyToolCall: typeof api.denyToolCall,
                approveAllToolCalls: typeof api.approveAllToolCalls,
                // Toast
                showToast: typeof api.showToast,
                getToasts: typeof api.getToasts,
                // Settings
                getSettings: typeof api.getSettings,
                updateSettings: typeof api.updateSettings,
                // Activity
                setActivity: typeof api.setActivity,
                getActivity: typeof api.getActivity,
                // Performance
                getMetrics: typeof api.getMetrics,
                // Network
                simulateOffline: typeof api.simulateOffline,
                restoreNetwork: typeof api.restoreNetwork,
            };
        });

        for (const [name, type] of Object.entries(methods)) {
            expect(type, `${name} should be a function`).toBe('function');
        }
    });

    test('debug API exposes expected properties', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const properties = await page.evaluate(() => {
            // @ts-expect-error debug API
            const api = window.rtcAgentDebug;
            return {
                logs: Array.isArray(api.logs),
                element: typeof api.element,
                isOffline: typeof api.isOffline,
            };
        });

        expect(properties.logs).toBe(true);
        expect(properties.element).toBe('object');
        expect(properties.isOffline).toBe('boolean');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// State Query
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - State Query', () => {
    test('getState returns structured state object', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const state = await page.evaluate(() => {
            // @ts-expect-error debug API
            return window.rtcAgentDebug.getState() as Record<string, unknown>;
        });

        expect(state).toHaveProperty('auth');
        expect(state).toHaveProperty('session');
        expect(state).toHaveProperty('messages');
        expect(state).toHaveProperty('window');
        expect(state).toHaveProperty('activity');
        expect(state).toHaveProperty('connection');
        expect(state).toHaveProperty('tabs');
        expect(state).toHaveProperty('persistence');
        expect(state).toHaveProperty('toolCalls');
        expect(state).toHaveProperty('settings');
    });

    test('auth state includes required fields', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const auth = await page.evaluate(() => {
            // @ts-expect-error debug API
            return window.rtcAgentDebug.getState().auth as Record<string, unknown>;
        });

        expect(auth).toHaveProperty('isLoggedIn');
        expect(auth).toHaveProperty('userId');
        expect(auth).toHaveProperty('expiresAt');
        expect(auth.isLoggedIn).toBe(false);
    });

    test('window state includes mode, position, and size', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const windowState = await page.evaluate(() => {
            // @ts-expect-error debug API
            return window.rtcAgentDebug.getState().window as Record<string, unknown>;
        });

        expect(windowState).toHaveProperty('mode');
        expect(windowState).toHaveProperty('position');
        expect(windowState).toHaveProperty('size');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Auth Bypass
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Auth Bypass', () => {
    test('loginAs sets logged-in state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(() => {
            // @ts-expect-error debug API
            window.rtcAgentDebug.loginAs('test-user-1');
            return new Promise<Record<string, unknown>>((resolve) => {
                requestAnimationFrame(() => {
                    // @ts-expect-error debug API
                    resolve(window.rtcAgentDebug.getState().auth as Record<string, unknown>);
                });
            });
        });

        expect(result.isLoggedIn).toBe(true);
        expect(result.userId).toBe('test-user-1');
    });

    test('loginAs with custom tokens uses provided values', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(() => {
            // @ts-expect-error debug API
            window.rtcAgentDebug.loginAs('custom-user', {
                accessToken: 'my-access-token',
                refreshToken: 'my-refresh-token',
            });
            return new Promise<boolean>((resolve) => {
                requestAnimationFrame(() => {
                    // @ts-expect-error debug API
                    const auth = window.rtcAgentDebug.getState().auth as Record<string, unknown>;
                    resolve(auth.isLoggedIn === true && auth.userId === 'custom-user');
                });
            });
        });

        expect(result).toBe(true);
    });

    test('logout clears auth state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            // @ts-expect-error debug API
            window.rtcAgentDebug.loginAs('test-user-2');
            await new Promise(r => requestAnimationFrame(r));

            // @ts-expect-error debug API
            window.rtcAgentDebug.logout();
            await new Promise(r => requestAnimationFrame(r));

            // @ts-expect-error debug API
            return window.rtcAgentDebug.getState().auth as Record<string, unknown>;
        });

        expect(result.isLoggedIn).toBe(false);
    });

    test('login then logout cycle produces correct state transitions', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const transitions = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const states: boolean[] = [];

            // Initial state
            states.push(api.getState().auth.isLoggedIn);

            // Login
            api.loginAs('cycle-user');
            await new Promise(r => requestAnimationFrame(r));
            states.push(api.getState().auth.isLoggedIn);

            // Logout
            api.logout();
            await new Promise(r => requestAnimationFrame(r));
            states.push(api.getState().auth.isLoggedIn);

            return states;
        });

        expect(transitions).toEqual([false, true, false]);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// VirtualFS Operations
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - VirtualFS', () => {
    test('writeFile and readFile round-trip', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const content = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const path = `/e2e-test-read-${Date.now()}.txt`;
            await api.writeFile(path, 'hello e2e');
            return api.readFile(path);
        });

        expect(content).toBe('hello e2e');
    });

    test('listFiles includes newly written files', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const files = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const path = `/e2e-test-list-${Date.now()}.txt`;
            await api.writeFile(path, 'test content');
            return api.listFiles('/') as Promise<string[]>;
        });

        expect(Array.isArray(files)).toBe(true);
        expect(files.length).toBeGreaterThan(0);
    });

    test('deleteFile removes the file from VirtualFS', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const path = `/e2e-test-delete-${Date.now()}.txt`;

            await api.writeFile(path, 'to be deleted');
            const before = await api.readFile(path);
            await api.deleteFile(path);
            const after = await api.readFile(path);

            return {before, after};
        });

        expect(result.before).toBe('to be deleted');
        expect(result.after).toBe('');
    });

    test('writeFile overwrites existing content', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const path = `/e2e-test-overwrite-${Date.now()}.txt`;

            await api.writeFile(path, 'version 1');
            const first = await api.readFile(path);
            await api.writeFile(path, 'version 2');
            const second = await api.readFile(path);

            return {first, second};
        });

        expect(result.first).toBe('version 1');
        expect(result.second).toBe('version 2');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Event Simulation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Event Simulation', () => {
    test('triggerEvent dispatches a custom event on <rtc-agent>', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const eventReceived = await page.evaluate(async () => {
            return new Promise<boolean>((resolve) => {
                const agent = document.querySelector('rtc-agent');
                if (!agent) {
                    resolve(false);
                    return;
                }

                agent.addEventListener('test-ping', () => resolve(true), {once: true});

                // @ts-expect-error debug API
                window.rtcAgentDebug.triggerEvent('test-ping', {hello: 'world'});
            });
        });

        expect(eventReceived).toBe(true);
    });

    test('triggerEvent passes detail payload correctly', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const detail = await page.evaluate(async () => {
            return new Promise<unknown>((resolve) => {
                const agent = document.querySelector('rtc-agent');
                if (!agent) {
                    resolve(null);
                    return;
                }

                agent.addEventListener('test-detail', ((e: CustomEvent) => {
                    resolve(e.detail);
                }) as EventListener, {once: true});

                // @ts-expect-error debug API
                window.rtcAgentDebug.triggerEvent('test-detail', {count: 42, label: 'e2e'});
            });
        });

        expect(detail).toEqual({count: 42, label: 'e2e'});
    });

    test('triggerEvent bubbles and crosses shadow DOM boundary', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const receivedAtDocument = await page.evaluate(async () => {
            return new Promise<boolean>((resolve) => {
                document.addEventListener('test-bubble', () => resolve(true), {once: true});

                // @ts-expect-error debug API
                window.rtcAgentDebug.triggerEvent('test-bubble');
            });
        });

        expect(receivedAtDocument).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Log Capture
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Log Capture', () => {
    test('logs array captures console output', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.clearLogs();

            console.info('e2e-test-log-entry');

            // Allow the wrapped console to execute.
            await new Promise(r => setTimeout(r, 50));

            return api.logs as string[];
        });

        expect(result.length).toBeGreaterThan(0);
        expect(result.some((l: string) => l.includes('e2e-test-log-entry'))).toBe(true);
    });

    test('clearLogs empties the buffer', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            console.warn('some noise');
            await new Promise(r => setTimeout(r, 50));

            api.clearLogs();
            return (api.logs as string[]).length;
        });

        expect(result).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Data Manipulation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Data Manipulation', () => {
    test('clearData wipes localStorage', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed localStorage before clearing.
        await page.evaluate(() => {
            localStorage.setItem('e2e-test-key', 'should-be-cleared');
        });

        const result = await page.evaluate(async () => {
            // @ts-expect-error debug API
            await window.rtcAgentDebug.clearData();
            return localStorage.getItem('e2e-test-key');
        });

        expect(result).toBeNull();
    });

    test('seedData with tokens triggers auth state change', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const auth = await page.evaluate(async () => {
            // @ts-expect-error debug API
            await window.rtcAgentDebug.seedData({
                tokens: {userId: 'seeded-user', accessToken: 'seeded-token'},
            });
            await new Promise(r => requestAnimationFrame(r));
            // @ts-expect-error debug API
            return window.rtcAgentDebug.getState().auth as Record<string, unknown>;
        });

        expect(auth.isLoggedIn).toBe(true);
        expect(auth.userId).toBe('seeded-user');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Component Reference
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Component Reference', () => {
    test('element returns the rtc-agent DOM node', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const tagName = await page.evaluate(() => {
            // @ts-expect-error debug API
            const el = window.rtcAgentDebug.element;
            return el?.tagName?.toLowerCase();
        });

        expect(tagName).toBe('rtc-agent');
    });

    test('waitForReady resolves to the component', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const tagName = await page.evaluate(async () => {
            // @ts-expect-error debug API
            const el = await window.rtcAgentDebug.waitForReady(5000);
            return el.tagName.toLowerCase();
        });

        expect(tagName).toBe('rtc-agent');
    });

    test('waitForConnected returns boolean within timeout', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const connected = await page.evaluate(async () => {
            // @ts-expect-error debug API
            return window.rtcAgentDebug.waitForConnected(3000) as Promise<boolean>;
        });

        // In test env without a real backend, connection may or may not succeed.
        // We just verify the API resolves without throwing.
        expect(typeof connected).toBe('boolean');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Session Management
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Session Management', () => {
    test('createSession returns a clientId and adds to session list', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const before = api.getSessions() as any[];
            const clientId = api.createSession() as string;
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getSessions() as any[];
            const currentId = api.getCurrentSessionId();
            return {clientId, beforeCount: before.length, afterCount: after.length, currentId};
        });

        expect(result.clientId).toBeTruthy();
        expect(result.afterCount).toBe(result.beforeCount + 1);
        expect(result.currentId).toBe(result.clientId);
    });

    test('switchSession changes the current session', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const id1 = api.createSession();
            await new Promise(r => requestAnimationFrame(r));
            const id2 = api.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Should be on id2 now
            const currentBefore = api.getCurrentSessionId();

            // Switch back to id1
            const switched = api.switchSession(id1);
            await new Promise(r => requestAnimationFrame(r));
            const currentAfter = api.getCurrentSessionId();

            return {currentBefore, currentAfter, switched};
        });

        expect(result.currentBefore).not.toBe(result.currentAfter);
        expect(result.switched).toBe(true);
        expect(result.currentAfter).toBeTruthy();
    });

    test('switchSession returns false for non-existent session', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.switchSession('non-existent-id');
        });

        expect(result).toBe(false);
    });

    test('renameSession updates the session title', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const id = api.createSession();
            await new Promise(r => requestAnimationFrame(r));
            const renameResult = await api.renameSession(id, 'New Title');
            await new Promise(r => requestAnimationFrame(r));
            const sessions = api.getSessions() as any[];
            const session = sessions.find((s: any) => s.clientId === id);
            return {renameResult, title: session?.title};
        });

        expect(result.renameResult.ok).toBe(true);
        expect(result.title).toBe('New Title');
    });

    test('deleteSession removes the session', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const id = api.createSession();
            await new Promise(r => requestAnimationFrame(r));
            const beforeCount = api.getSessions().length;
            const deleteResult = await api.deleteSession(id);
            await new Promise(r => requestAnimationFrame(r));
            const afterCount = api.getSessions().length;
            return {deleteResult, beforeCount, afterCount};
        });

        expect(result.deleteResult.ok).toBe(true);
        expect(result.afterCount).toBe(result.beforeCount - 1);
    });

    test('getSessions returns session list', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const sessions = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.createSession();
            await new Promise(r => requestAnimationFrame(r));
            return api.getSessions() as any[];
        });

        expect(Array.isArray(sessions)).toBe(true);
        expect(sessions.length).toBeGreaterThan(0);
        expect(sessions[0]).toHaveProperty('clientId');
        expect(sessions[0]).toHaveProperty('title');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Message Operations
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Message Operations', () => {
    test('getMessages returns an array', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const messages = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getMessages() as any[];
        });

        expect(Array.isArray(messages)).toBe(true);
    });

    test('addDemoMessage adds an assistant message', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const before = api.getMessages().length;
            api.addDemoMessage('Hello from debug API');
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getMessages().length;
            const lastMsg = api.getMessages().pop();
            return {before, after, lastRole: lastMsg?.role};
        });

        expect(result.after).toBe(result.before + 1);
        expect(result.lastRole).toBe('assistant');
    });

    test('clearMessages empties the message list', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.addDemoMessage('message to clear');
            await new Promise(r => requestAnimationFrame(r));
            const before = api.getMessages().length;
            api.clearMessages();
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getMessages().length;
            return {before, after};
        });

        expect(result.before).toBeGreaterThan(0);
        expect(result.after).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Tool Call Simulation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Tool Call Simulation', () => {
    test('addPendingToolCall adds a tool call to the pending list', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            const before = api.getToolCalls().length;
            api.addPendingToolCall({
                toolName: 'bash',
                command: 'echo hello',
                description: 'Run echo command',
            });
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getToolCalls().length;
            const lastCall = api.getToolCalls().pop();
            return {before, after, lastCall};
        });

        expect(result.after).toBe(result.before + 1);
        expect(result.lastCall.toolName).toBe('bash');
        expect(result.lastCall.command).toBe('echo hello');
    });

    test('approveToolCall removes the call from pending', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.addPendingToolCall({id: 'tc-test-approve', toolName: 'read'});
            await new Promise(r => requestAnimationFrame(r));
            const before = api.getToolCalls().length;
            const approved = api.approveToolCall('tc-test-approve');
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getToolCalls().length;
            return {approved, before, after};
        });

        expect(result.approved).toBe(true);
        expect(result.after).toBe(result.before - 1);
    });

    test('denyToolCall removes the call from pending', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.addPendingToolCall({id: 'tc-test-deny', toolName: 'write'});
            await new Promise(r => requestAnimationFrame(r));
            const before = api.getToolCalls().length;
            const denied = api.denyToolCall('tc-test-deny');
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getToolCalls().length;
            return {denied, before, after};
        });

        expect(result.denied).toBe(true);
        expect(result.after).toBe(result.before - 1);
    });

    test('approveToolCall returns false for non-existent call', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.approveToolCall('non-existent-id');
        });

        expect(result).toBe(false);
    });

    test('approveAllToolCalls clears all calls for a tool name', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.addPendingToolCall({id: 'tc-bash-1', toolName: 'bash'});
            api.addPendingToolCall({id: 'tc-bash-2', toolName: 'bash'});
            api.addPendingToolCall({id: 'tc-read-1', toolName: 'read'});
            await new Promise(r => requestAnimationFrame(r));
            const before = api.getToolCalls().length;
            api.approveAllToolCalls('bash');
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getToolCalls().length;
            const remaining = api.getToolCalls() as any[];
            return {before, after, remaining};
        });

        expect(result.before).toBe(3);
        expect(result.after).toBe(1);
        expect(result.remaining[0].toolName).toBe('read');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Toast / Notification
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Toast', () => {
    test('showToast adds a toast notification', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.showToast('Test notification', 'success');
            await new Promise(r => requestAnimationFrame(r));
            const toasts = api.getToasts() as any[];
            return {count: toasts.length, lastToast: toasts[toasts.length - 1]};
        });

        expect(result.count).toBeGreaterThan(0);
        expect(result.lastToast.message).toBe('Test notification');
        expect(result.lastToast.type).toBe('success');
    });

    test('getToasts returns array of toast objects', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const toasts = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getToasts() as any[];
        });

        expect(Array.isArray(toasts)).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Settings
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Settings', () => {
    test('getSettings returns settings state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const settings = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getSettings() as Record<string, unknown>;
        });

        expect(typeof settings).toBe('object');
        expect(settings).not.toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Activity / Layout
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Activity', () => {
    test('getActivity returns current activity state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const activity = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getActivity() as {active: string; sidebarVisible: boolean};
        });

        expect(activity).toHaveProperty('active');
        expect(activity).toHaveProperty('sidebarVisible');
    });

    test('setActivity changes the active panel', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.setActivity('chat');
            await new Promise(r => requestAnimationFrame(r));
            const after = api.getActivity() as {active: string};
            return after;
        });

        expect(result.active).toBe('chat');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Performance Metrics
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Performance Metrics', () => {
    test('getMetrics returns structured metrics', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const metrics = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getMetrics() as Record<string, unknown>;
        });

        expect(metrics).toHaveProperty('dom');
        expect(metrics).toHaveProperty('resources');
        expect(metrics).toHaveProperty('component');
        expect(metrics).toHaveProperty('logs');

        const dom = metrics.dom as Record<string, unknown>;
        expect(typeof dom.nodeCount).toBe('number');
        expect((dom.nodeCount as number)).toBeGreaterThan(0);
    });

    test('getMetrics includes component state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const metrics = await page.evaluate(() => {
            const api = (window as any).rtcAgentDebug;
            return api.getMetrics() as Record<string, unknown>;
        });

        const component = metrics.component as Record<string, unknown>;
        expect(component).toHaveProperty('isConnected');
        expect(component).toHaveProperty('hasShadowRoot');
        expect(component).toHaveProperty('sessionCount');
        expect(component).toHaveProperty('messageCount');
        expect(component).toHaveProperty('persistenceConnected');
        expect(component.isConnected).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Network Simulation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Debug API - Network Simulation', () => {
    test('simulateOffline sets isOffline to true', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            expect(api.isOffline).toBe(false);
            api.simulateOffline();
            const offline = api.isOffline;
            api.restoreNetwork();
            return offline;
        });

        expect(result).toBe(true);
    });

    test('restoreNetwork resets isOffline to false', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.simulateOffline();
            api.restoreNetwork();
            return api.isOffline;
        });

        expect(result).toBe(false);
    });

    test('simulateOffline blocks fetch requests', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.simulateOffline();
            try {
                await fetch('/some-endpoint');
                api.restoreNetwork();
                return {blocked: false};
            } catch (err) {
                api.restoreNetwork();
                return {blocked: true, error: (err as Error).message};
            }
        });

        expect(result.blocked).toBe(true);
        expect(result.error).toContain('offline');
    });

    test('restoreNetwork re-enables fetch', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            api.simulateOffline();
            api.restoreNetwork();

            // Fetch should work again (even if 404, it shouldn't throw NetworkError)
            try {
                const resp = await fetch('/debug/index.html');
                return {ok: resp.ok || resp.status < 500};
            } catch (err) {
                return {ok: false, error: (err as Error).message};
            }
        });

        expect(result.ok).toBe(true);
    });
});
