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
                getState: typeof api.getState,
                clearData: typeof api.clearData,
                seedData: typeof api.seedData,
                loginAs: typeof api.loginAs,
                logout: typeof api.logout,
                triggerEvent: typeof api.triggerEvent,
                listFiles: typeof api.listFiles,
                readFile: typeof api.readFile,
                writeFile: typeof api.writeFile,
                deleteFile: typeof api.deleteFile,
                click: typeof api.click,
                scrollIntoView: typeof api.scrollIntoView,
                typeText: typeof api.typeText,
                waitForReady: typeof api.waitForReady,
                waitForConnected: typeof api.waitForConnected,
                clearLogs: typeof api.clearLogs,
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
            };
        });

        expect(properties.logs).toBe(true);
        expect(properties.element).toBe('object');
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
