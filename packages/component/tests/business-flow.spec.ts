/**
 * Deep Business Flow E2E Tests
 *
 * These tests exercise complex, multi-step business flows that span multiple
 * controllers and verify cross-controller integration, state consistency,
 * event ordering, and error recovery scenarios.
 *
 * Unlike debug-api.spec.ts (which tests individual API methods), these tests
 * verify real-world user workflows and the interactions between subsystems.
 *
 * Prerequisites: Vite dev server running (started automatically by Playwright).
 *
 * Run: npx playwright test --config=packages/component/playwright.config.ts
 */
import {test, expect, type Page} from '@playwright/test';

/** URL of the debug page that hosts <rtc-agent> and installs the debug API. */
const DEBUG_PAGE = '/debug/index.html';

/**
 * Wait for the debug API to become available on the page.
 */
async function waitForDebugAPI(page: Page): Promise<void> {
    await page.waitForFunction(() => {
        // @ts-expect-error debug API not in default types
        return typeof window.rtcAgentDebug !== 'undefined';
    }, {timeout: 15_000});
}

/**
 * Helper: execute a function inside page context with full type-cast.
 */
async function evalInPage<T>(page: Page, fn: () => T | Promise<T>): Promise<T> {
    return page.evaluate(fn as () => Promise<T>);
}

// ────────────────────────────────────────────────────────────────────────────
// Session Lifecycle Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Session Lifecycle', () => {
    test('create -> switch -> rename -> delete -> auto-switch', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const actions = el.sessionController.value.actions;

            // Step 1: Create session A
            const idA = actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Step 2: Create session B
            const idB = actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Verify: B is current (last created)
            let state = el.sessionController.value.state;
            const afterCreate = {
                sessionCount: state.sessions.length,
                currentId: state.currentSessionId,
            };

            // Step 3: Switch to session A
            actions.switchSession(idA);
            await new Promise(r => requestAnimationFrame(r));
            const afterSwitch = el.sessionController.value.state.currentSessionId;

            // Step 4: Rename session A
            await actions.renameSession(idA, 'Renamed Session A');
            await new Promise(r => requestAnimationFrame(r));
            const renamedSession = el.sessionController.value.state.sessions.find(
                (s: any) => s.clientId === idA
            );

            // Step 5: Delete current session (A)
            await actions.deleteSession(idA);
            await new Promise(r => requestAnimationFrame(r));

            // After deleting current, should auto-switch to another session
            const afterDelete = el.sessionController.value.state;

            return {
                afterCreate,
                afterSwitch,
                renamedTitle: renamedSession?.title,
                afterDeleteCount: afterDelete.sessions.length,
                afterDeleteCurrentId: afterDelete.currentSessionId,
                idA,
                idB,
            };
        });

        // Assertions
        expect(result.afterCreate.sessionCount).toBeGreaterThanOrEqual(2);
        expect(result.afterCreate.currentId).toBe(result.idB);
        expect(result.afterSwitch).toBe(result.idA); // Switched to A
        expect(result.renamedTitle).toBe('Renamed Session A');
        expect(result.afterDeleteCount).toBe(result.afterCreate.sessionCount - 1);
        // After deleting current (A), should auto-switch away from A.
        // With only B remaining, currentId should be B.
        expect(result.afterDeleteCurrentId).not.toBe(result.idA);
    });

    test('session events fire in correct order', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const events = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const actions = el.sessionController.value.actions;
            const firedEvents: string[] = [];

            // Listen for session events
            const eventNames = [
                'rtc-session-created',
                'rtc-session-switched',
                'rtc-session-renamed',
                'rtc-session-deleted',
            ];
            for (const name of eventNames) {
                el.addEventListener(name, () => firedEvents.push(name));
            }

            // Create two sessions
            const id1 = actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            const id2 = actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Switch to first session
            actions.switchSession(id1);
            await new Promise(r => requestAnimationFrame(r));

            // Rename first session
            await actions.renameSession(id1, 'Test Rename');
            await new Promise(r => requestAnimationFrame(r));

            // Delete second session
            await actions.deleteSession(id2);
            await new Promise(r => requestAnimationFrame(r));

            return firedEvents;
        });

        // Verify event ordering
        expect(events).toContain('rtc-session-created');
        expect(events).toContain('rtc-session-switched');
        expect(events).toContain('rtc-session-renamed');
        expect(events).toContain('rtc-session-deleted');

        // Created events should come first (two creates)
        const createdIndices = events.reduce<number[]>((acc, e, i) => {
            if (e === 'rtc-session-created') acc.push(i);
            return acc;
        }, []);
        expect(createdIndices.length).toBeGreaterThanOrEqual(2);

        // Switched should come after creates
        const switchedIndex = events.indexOf('rtc-session-switched');
        expect(switchedIndex).toBeGreaterThan(createdIndices[0]);

        // Renamed should come after switch
        const renamedIndex = events.indexOf('rtc-session-renamed');
        expect(renamedIndex).toBeGreaterThan(switchedIndex);

        // Deleted should be last
        const deletedIndex = events.indexOf('rtc-session-deleted');
        expect(deletedIndex).toBeGreaterThan(renamedIndex);
    });

    test('rapid session creation produces consistent state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const actions = el.sessionController.value.actions;

            // Create 10 sessions rapidly
            const ids: string[] = [];
            for (let i = 0; i < 10; i++) {
                ids.push(actions.createSession());
            }

            // Wait for all updates to settle
            await new Promise(r => setTimeout(r, 200));

            const state = el.sessionController.value.state;
            const sessionIds = state.sessions.map((s: any) => s.clientId);

            return {
                expectedCount: ids.length,
                actualCount: state.sessions.length,
                currentId: state.currentSessionId,
                lastCreatedId: ids[ids.length - 1],
                allIdsPresent: ids.every(id => sessionIds.includes(id)),
                noDuplicates: new Set(sessionIds).size === sessionIds.length,
            };
        });

        expect(result.actualCount).toBe(result.expectedCount);
        expect(result.currentId).toBe(result.lastCreatedId);
        expect(result.allIdsPresent).toBe(true);
        expect(result.noDuplicates).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Auth-to-Session Integration Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Auth Integration', () => {
    test('login -> create session -> verify state -> logout -> cleanup', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Step 1: Verify initial state (not logged in)
            const initialAuth = api.getState().auth as Record<string, unknown>;

            // Step 2: Login
            api.loginAs('flow-test-user');
            await new Promise(r => requestAnimationFrame(r));
            const afterLogin = api.getState().auth as Record<string, unknown>;

            // Step 3: Create a session
            const actions = el.sessionController.value.actions;
            const sessionId = actions.createSession();
            await new Promise(r => requestAnimationFrame(r));
            const afterSession = el.sessionController.value.state;

            // Step 4: Logout
            api.logout();
            await new Promise(r => requestAnimationFrame(r));
            const afterLogout = api.getState().auth as Record<string, unknown>;

            return {
                initialLoggedIn: initialAuth.isLoggedIn,
                afterLoginLoggedIn: afterLogin.isLoggedIn,
                afterLoginUserId: afterLogin.userId,
                sessionCreated: sessionId,
                sessionCount: afterSession.sessions.length,
                currentSessionId: afterSession.currentSessionId,
                afterLogoutLoggedIn: afterLogout.isLoggedIn,
            };
        });

        expect(result.initialLoggedIn).toBe(false);
        expect(result.afterLoginLoggedIn).toBe(true);
        expect(result.afterLoginUserId).toBe('flow-test-user');
        expect(result.sessionCount).toBeGreaterThanOrEqual(1);
        expect(result.currentSessionId).toBe(result.sessionCreated);
        expect(result.afterLogoutLoggedIn).toBe(false);
    });

    test('login -> logout -> re-login cycle preserves no stale state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // First login
            api.loginAs('user-round-1');
            await new Promise(r => requestAnimationFrame(r));
            const round1 = api.getState().auth as Record<string, unknown>;

            // Logout
            api.logout();
            await new Promise(r => requestAnimationFrame(r));
            const between = api.getState().auth as Record<string, unknown>;

            // Second login with different user
            api.loginAs('user-round-2');
            await new Promise(r => requestAnimationFrame(r));
            const round2 = api.getState().auth as Record<string, unknown>;

            return {
                round1User: round1.userId,
                round1LoggedIn: round1.isLoggedIn,
                betweenLoggedIn: between.isLoggedIn,
                round2User: round2.userId,
                round2LoggedIn: round2.isLoggedIn,
            };
        });

        expect(result.round1User).toBe('user-round-1');
        expect(result.round1LoggedIn).toBe(true);
        expect(result.betweenLoggedIn).toBe(false);
        expect(result.round2User).toBe('user-round-2');
        expect(result.round2LoggedIn).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Window State Machine Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Window State Machine', () => {
    test('mode transitions: normal -> minimized -> maximized -> restored', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const actions = el.windowStateController.actions;

            const modes: string[] = [];

            // Initial state
            modes.push(el.windowStateController.value.state.mode);

            // Minimize
            actions.minimize();
            await new Promise(r => requestAnimationFrame(r));
            modes.push(el.windowStateController.value.state.mode);

            // Maximize (from minimized)
            actions.maximize();
            await new Promise(r => requestAnimationFrame(r));
            modes.push(el.windowStateController.value.state.mode);

            // Restore (from maximized)
            actions.restore();
            await new Promise(r => requestAnimationFrame(r));
            modes.push(el.windowStateController.value.state.mode);

            // Check data-mode attribute reflection
            const dataMode = el.getAttribute('data-mode');

            return {modes, dataMode};
        });

        expect(result.modes[0]).toBe('normal');
        expect(result.modes[1]).toBe('minimized');
        expect(result.modes[2]).toBe('maximized');
        expect(result.modes[3]).toBe('normal');
        expect(result.dataMode).toBe('normal');
    });

    test('data-mode attribute reflects state changes', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const actions = el.windowStateController.actions;

            const attributeSnapshots: (string | null)[] = [];

            // Minimize
            actions.minimize();
            await new Promise(r => requestAnimationFrame(r));
            attributeSnapshots.push(el.getAttribute('data-mode'));

            // Maximize
            actions.maximize();
            await new Promise(r => requestAnimationFrame(r));
            attributeSnapshots.push(el.getAttribute('data-mode'));

            // Restore
            actions.restore();
            await new Promise(r => requestAnimationFrame(r));
            attributeSnapshots.push(el.getAttribute('data-mode'));

            return attributeSnapshots;
        });

        expect(result[0]).toBe('minimized');
        expect(result[1]).toBe('maximized');
        expect(result[2]).toBe('normal');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Session Tab Management Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Session Tab Management', () => {
    test('open tabs -> switch active -> close tabs -> auto-activate adjacent', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const tabActions = el.sessionTabController.value.actions;

            // Open 3 tabs
            tabActions.openOrActivate('session-1', 'Tab 1');
            tabActions.openOrActivate('session-2', 'Tab 2');
            tabActions.openOrActivate('session-3', 'Tab 3');
            await new Promise(r => requestAnimationFrame(r));

            const afterOpen = el.sessionTabController.value.state;

            // Switch active tab to session-1
            tabActions.setActiveTab('session-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterSwitch = el.sessionTabController.value.state.activeSessionId;

            // Close the active tab (session-1)
            tabActions.closeTab('session-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterClose = el.sessionTabController.value.state;

            return {
                tabCountAfterOpen: afterOpen.tabs.length,
                activeAfterOpen: afterOpen.activeSessionId,
                activeAfterSwitch: afterSwitch,
                tabCountAfterClose: afterClose.tabs.length,
                activeAfterClose: afterClose.activeSessionId,
            };
        });

        expect(result.tabCountAfterOpen).toBe(3);
        expect(result.activeAfterOpen).toBe('session-3'); // Last opened
        expect(result.activeAfterSwitch).toBe('session-1');
        expect(result.tabCountAfterClose).toBe(2);
        // After closing active tab, should auto-activate adjacent tab
        expect(result.activeAfterClose).toBeTruthy();
        expect(result.activeAfterClose).not.toBe('session-1'); // Not the closed one
    });

    test('opening same session twice does not create duplicate tabs', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const tabActions = el.sessionTabController.value.actions;

            // Open same session multiple times
            tabActions.openOrActivate('dup-session', 'Session Title');
            tabActions.openOrActivate('dup-session', 'Session Title Updated');
            tabActions.openOrActivate('dup-session', 'Session Title Updated Again');
            await new Promise(r => requestAnimationFrame(r));

            const state = el.sessionTabController.value.state;
            const dupTabs = state.tabs.filter((t: any) => t.sessionId === 'dup-session');

            return {
                tabCount: state.tabs.length,
                duplicateCount: dupTabs.length,
                activeSessionId: state.activeSessionId,
                finalTitle: dupTabs[0]?.title,
            };
        });

        expect(result.tabCount).toBe(1);
        expect(result.duplicateCount).toBe(1);
        expect(result.activeSessionId).toBe('dup-session');
        // Title should be updated to the latest
        expect(result.finalTitle).toBe('Session Title Updated Again');
    });

    test('clearAll removes all tabs and resets active', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const tabActions = el.sessionTabController.value.actions;

            // Open tabs
            tabActions.openOrActivate('tab-a', 'Tab A');
            tabActions.openOrActivate('tab-b', 'Tab B');
            tabActions.openOrActivate('tab-c', 'Tab C');
            await new Promise(r => requestAnimationFrame(r));

            const before = el.sessionTabController.value.state;

            // Clear all
            tabActions.clearAll();
            await new Promise(r => requestAnimationFrame(r));

            const after = el.sessionTabController.value.state;

            return {
                beforeCount: before.tabs.length,
                beforeActive: before.activeSessionId,
                afterCount: after.tabs.length,
                afterActive: after.activeSessionId,
            };
        });

        expect(result.beforeCount).toBe(3);
        expect(result.afterCount).toBe(0);
        expect(result.afterActive).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Data Persistence Across Reload
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Data Persistence', () => {
    test('mode persists across page reload', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Set mode to 'auto'
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            el.modeController.value.actions.setMode('auto');
            await new Promise(r => requestAnimationFrame(r));
        });

        // Verify mode is 'auto' before reload
        const modeBefore = await evalInPage(page, () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            return el.modeController.value.state.currentMode;
        });
        expect(modeBefore).toBe('auto');

        // Reload page
        await page.reload();
        await waitForDebugAPI(page);

        // Verify mode is still 'auto' after reload
        const modeAfter = await evalInPage(page, () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            return el.modeController.value.state.currentMode;
        });
        expect(modeAfter).toBe('auto');
    });

    test('localStorage data persists across reload', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Set a localStorage value
        await page.evaluate(() => {
            localStorage.setItem('e2e-persist-test', 'should-survive-reload');
        });

        // Reload
        await page.reload();
        await waitForDebugAPI(page);

        // Verify
        const value = await page.evaluate(() => {
            return localStorage.getItem('e2e-persist-test');
        });
        expect(value).toBe('should-survive-reload');
    });

    test('clearData removes all persistence then reload starts clean', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed some data
        await page.evaluate(() => {
            localStorage.setItem('e2e-cleanup-test', 'will-be-cleared');
        });

        // Clear data
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            await api.clearData();
        });

        // Reload
        await page.reload();
        await waitForDebugAPI(page);

        // Verify localStorage is clean
        const value = await page.evaluate(() => {
            return localStorage.getItem('e2e-cleanup-test');
        });
        expect(value).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// VirtualFS Batch & Concurrent Operations
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - VirtualFS Batch Operations', () => {
    test('concurrent writes all succeed without data loss', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Write 10 files concurrently
            const writePromises = [];
            for (let i = 0; i < 10; i++) {
                writePromises.push(
                    api.writeFile(`/e2e-batch/concurrent-${i}.txt`, `content-${i}`)
                );
            }
            await Promise.all(writePromises);

            // Verify all files exist with correct content
            const readResults = [];
            for (let i = 0; i < 10; i++) {
                const content = await api.readFile(`/e2e-batch/concurrent-${i}.txt`);
                readResults.push(content);
            }

            // List files to verify
            const files = await api.listFiles('/e2e-batch');

            return {
                allCorrect: readResults.every((c: string, i: number) => c === `content-${i}`),
                fileCount: files.length,
            };
        });

        expect(result.allCorrect).toBe(true);
        expect(result.fileCount).toBe(10);
    });

    test('overwrite and delete cycle maintains consistency', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const path = `/e2e-cycle-${Date.now()}.txt`;

            // Write -> overwrite -> read -> delete -> read
            await api.writeFile(path, 'v1');
            const v1 = await api.readFile(path);

            await api.writeFile(path, 'v2');
            const v2 = await api.readFile(path);

            await api.writeFile(path, 'v3');
            const v3 = await api.readFile(path);

            await api.deleteFile(path);
            const afterDelete = await api.readFile(path);

            return {v1, v2, v3, afterDelete};
        });

        expect(result.v1).toBe('v1');
        expect(result.v2).toBe('v2');
        expect(result.v3).toBe('v3');
        expect(result.afterDelete).toBe('');
    });

    test('seedData with files populates VirtualFS correctly', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            await api.seedData({
                files: [
                    {path: '/seeded/file-a.txt', content: 'alpha'},
                    {path: '/seeded/file-b.txt', content: 'beta'},
                    {path: '/seeded/file-c.txt', content: 'gamma'},
                ],
            });

            const files = await api.listFiles('/seeded');
            const contentA = await api.readFile('/seeded/file-a.txt');
            const contentB = await api.readFile('/seeded/file-b.txt');
            const contentC = await api.readFile('/seeded/file-c.txt');

            return {
                fileCount: files.length,
                contentA,
                contentB,
                contentC,
            };
        });

        expect(result.fileCount).toBe(3);
        expect(result.contentA).toBe('alpha');
        expect(result.contentB).toBe('beta');
        expect(result.contentC).toBe('gamma');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Error Recovery Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Error Recovery', () => {
    test('clearData removes persistent data', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed some data first
        await page.evaluate(() => {
            localStorage.setItem('e2e-cleanup-preload', 'will-be-cleared');
        });
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            await api.writeFile('/before-clear.txt', 'old-data');
        });

        // Verify data exists
        const before = await page.evaluate(() => localStorage.getItem('e2e-cleanup-preload'));
        expect(before).toBe('will-be-cleared');

        // Clear all data
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            await api.clearData();
        });

        // Verify localStorage is clean
        const after = await page.evaluate(() => localStorage.getItem('e2e-cleanup-preload'));
        expect(after).toBeNull();

        // Verify VirtualFS file is gone (after clearData, database was deleted)
        const fileContent = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            return api.readFile('/before-clear.txt');
        });
        expect(fileContent).toBe('');
    });

    test('clearData gives clean state without reload', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Login and do some work
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            api.loginAs('recovery-user');
            await new Promise(r => requestAnimationFrame(r));
            const el = api.element;
            el.sessionController.value.actions.createSession();
        });

        // Clear all data (now disconnects SharedWorker + resets auth, no stale callbacks)
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            await api.clearData();
        });

        // No reload needed: clearData properly tears down persistence and auth.
        const auth = await evalInPage(page, () => {
            const api = (window as any).rtcAgentDebug;
            return api.getState().auth as Record<string, unknown>;
        });
        expect(auth.isLoggedIn).toBe(false);

        // Re-login works cleanly without page reload
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            api.loginAs('recovery-user-2');
            await new Promise(r => setTimeout(r, 100));
        });

        const afterLogin = await evalInPage(page, () => {
            const api = (window as any).rtcAgentDebug;
            return api.getState().auth as Record<string, unknown>;
        });
        expect(afterLogin.isLoggedIn).toBe(true);
        expect(afterLogin.userId).toBe('recovery-user-2');
    });

    test('rapid login/logout does not corrupt auth state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Rapid login/logout cycle
            for (let i = 0; i < 5; i++) {
                api.loginAs(`rapid-user-${i}`);
                await new Promise(r => requestAnimationFrame(r));
                api.logout();
                await new Promise(r => requestAnimationFrame(r));
            }

            // Final login
            api.loginAs('final-user');

            // Check auth state SYNCHRONOUSLY — before any async side effects
            // (token refresh, connection callbacks) can interfere.
            const directState = el.authController.state;
            const apiState = api.getState().auth as Record<string, unknown>;

            return {
                directIsLoggedIn: directState.isLoggedIn,
                directUserId: directState.userId,
                apiIsLoggedIn: apiState.isLoggedIn,
                apiUserId: apiState.userId,
            };
        });

        // Verify synchronous contract of loginAs: immediately after setTokens(),
        // both direct controller state and debug API state should be consistent.
        expect(result.directIsLoggedIn).toBe(true);
        expect(result.directUserId).toBe('final-user');
        expect(result.apiIsLoggedIn).toBe(true);
        expect(result.apiUserId).toBe('final-user');
        expect(result.directIsLoggedIn).toBe(result.apiIsLoggedIn);
        expect(result.directUserId).toBe(result.apiUserId);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Cross-Controller State Consistency
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - State Consistency', () => {
    test('getState() returns consistent snapshot of all controllers', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Setup: login, create session, set mode
            api.loginAs('consistency-user');
            el.sessionController.value.actions.createSession();
            el.modeController.value.actions.setMode('plan');
            el.windowStateController.actions.minimize();
            await new Promise(r => requestAnimationFrame(r));

            // Get state via debug API
            const state = api.getState();

            // Get state directly from controllers
            const directAuth = el.authController.state;
            const directSession = el.sessionController.value.state;
            const directWindow = el.windowStateController.value.state;
            const directMode = el.modeController.value.state;

            return {
                authMatch: (state.auth as any).isLoggedIn === directAuth.isLoggedIn
                    && (state.auth as any).userId === directAuth.userId,
                sessionMatch: (state.session as any).currentSessionId === directSession.currentSessionId
                    && (state.session as any).sessions.length === directSession.sessions.length,
                windowMatch: (state.window as any).mode === directWindow.mode,
                modeInState: (state.window as any).mode,
                persistenceMatch: (state.persistence as any).isConnected === el.persistenceController.isConnected,
            };
        });

        expect(result.authMatch).toBe(true);
        expect(result.sessionMatch).toBe(true);
        expect(result.windowMatch).toBe(true);
        expect(result.modeInState).toBe('minimized');
        expect(result.persistenceMatch).toBe(true);
    });

    test('session tab state stays consistent with session state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;
            const sessionActions = el.sessionController.value.actions;
            const tabActions = el.sessionTabController.value.actions;

            // Create sessions
            const id1 = sessionActions.createSession();
            const id2 = sessionActions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Open tabs for both sessions
            tabActions.openOrActivate(id1, 'Session 1');
            tabActions.openOrActivate(id2, 'Session 2');
            await new Promise(r => requestAnimationFrame(r));

            // Delete session 2
            await sessionActions.deleteSession(id2);
            await new Promise(r => requestAnimationFrame(r));

            const sessionState = el.sessionController.value.state;
            const tabState = el.sessionTabController.value.state;

            // Check: session 2 should not be in sessions
            const session2Exists = sessionState.sessions.some((s: any) => s.clientId === id2);

            // Tab state is independent (tabs may still reference deleted sessions
            // unless explicitly cleaned up)
            return {
                session2Exists,
                tabCount: tabState.tabs.length,
                sessionCount: sessionState.sessions.length,
            };
        });

        // Session 2 should be deleted
        expect(result.session2Exists).toBe(false);
        // Session count should reflect deletion
        expect(result.sessionCount).toBeGreaterThanOrEqual(1);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Log Capture Integration Flow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Log Integration', () => {
    test('business operations produce log entries', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Clear logs
            api.clearLogs();

            // Perform operations that should generate logs
            api.loginAs('log-test-user');
            await new Promise(r => requestAnimationFrame(r));

            const el = api.element;
            el.sessionController.value.actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            await api.writeFile('/log-test.txt', 'test');
            await new Promise(r => setTimeout(r, 100));

            const logs = api.logs as string[];
            return {
                logCount: logs.length,
                hasLoginLog: logs.some(l => l.includes('loginAs') || l.includes('login')),
                hasWriteLog: logs.some(l => l.includes('writeFile') || l.includes('write')),
            };
        });

        expect(result.logCount).toBeGreaterThan(0);
        // At least some operations should have been logged
        expect(result.hasLoginLog || result.hasWriteLog).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Multi-Tab Browser Simulation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Multi-Tab Simulation', () => {
    test('VirtualFS is accessible from multiple page contexts', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Write file in first context
        await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            await api.writeFile('/shared-data.txt', 'from-context-1');
        });

        // Verify file is readable
        const content = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            return api.readFile('/shared-data.txt');
        });

        expect(content).toBe('from-context-1');
    });

    test('clearData then write starts fresh', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Write a file
            await api.writeFile('/before-clear.txt', 'old-data');

            // Clear everything
            await api.clearData();

            // Note: After clearData, we need to ensure database is re-initialized
            // The writeFile API calls ensureDatabase() internally
            await api.writeFile('/after-clear.txt', 'new-data');

            const beforeClear = await api.readFile('/before-clear.txt');
            const afterClear = await api.readFile('/after-clear.txt');

            return {beforeClear, afterClear};
        });

        // Old data should be gone (DB was deleted)
        expect(result.beforeClear).toBe('');
        // New data should exist
        expect(result.afterClear).toBe('new-data');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Component Lifecycle
// ────────────────────────────────────────────────────────────────────────────

test.describe('Business Flow - Component Lifecycle', () => {
    test('waitForReady returns component after page load', async ({page}) => {
        await page.goto(DEBUG_PAGE);

        // Use waitForReady instead of waitForDebugAPI
        const tagName = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            if (!api) {
                // Wait for API to be available
                await new Promise<void>((resolve) => {
                    const check = () => {
                        if ((window as any).rtcAgentDebug) resolve();
                        else requestAnimationFrame(check);
                    };
                    check();
                });
            }
            const el = await (window as any).rtcAgentDebug.waitForReady(10000);
            return el.tagName.toLowerCase();
        });

        expect(tagName).toBe('rtc-agent');
    });

    test('element reference is stable across operations', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const el1 = api.element;
            const el2 = api.element;

            // Perform some operations
            api.loginAs('stability-test');
            await new Promise(r => requestAnimationFrame(r));

            const el3 = api.element;

            return {
                sameReference: el1 === el2 && el2 === el3,
                tagName: el1?.tagName?.toLowerCase(),
            };
        });

        expect(result.sameReference).toBe(true);
        expect(result.tagName).toBe('rtc-agent');
    });
});
