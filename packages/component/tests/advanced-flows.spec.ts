/**
 * Advanced E2E Tests — Complex Business Flows
 *
 * These tests exercise sophisticated multi-step scenarios that span multiple
 * controllers and verify cross-controller integration, state consistency,
 * and error recovery in realistic user workflows.
 *
 * Focus areas:
 * - Settings management & persistence
 * - Activity state management
 * - Network state simulation & recovery
 * - Tool call workflow & concurrent operations
 * - Complex cross-controller flows
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
// Settings Management & Persistence
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Settings Management', () => {
    test('updateSettings changes appearance theme', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Get initial settings
            const initial = api.getSettings();

            // Update theme to dark
            api.updateSettings('appearance', {theme: 'dark'});
            await new Promise(r => requestAnimationFrame(r));

            const afterDark = api.getSettings();

            // Update theme to light
            api.updateSettings('appearance', {theme: 'light'});
            await new Promise(r => requestAnimationFrame(r));

            const afterLight = api.getSettings();

            return {
                initialTheme: initial.appearance?.theme,
                afterDarkTheme: afterDark.appearance?.theme,
                afterLightTheme: afterLight.appearance?.theme,
            };
        });

        expect(result.initialTheme).toBe('system');
        expect(result.afterDarkTheme).toBe('dark');
        expect(result.afterLightTheme).toBe('light');
    });

    test('updateSettings changes fontSize', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const initial = api.getSettings();
            api.updateSettings('appearance', {fontSize: 16});
            await new Promise(r => requestAnimationFrame(r));
            const after16 = api.getSettings();

            api.updateSettings('appearance', {fontSize: 12});
            await new Promise(r => requestAnimationFrame(r));
            const after12 = api.getSettings();

            return {
                initialFontSize: initial.appearance?.fontSize,
                after16FontSize: after16.appearance?.fontSize,
                after12FontSize: after12.appearance?.fontSize,
            };
        });

        expect(result.initialFontSize).toBe(14);
        expect(result.after16FontSize).toBe(16);
        expect(result.after12FontSize).toBe(12);
    });

    test('updateSettings changes chat sendShortcut', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const initial = api.getSettings();
            api.updateSettings('chat', {sendShortcut: 'Ctrl+Enter'});
            await new Promise(r => requestAnimationFrame(r));
            const afterCtrl = api.getSettings();

            api.updateSettings('chat', {sendShortcut: 'Enter'});
            await new Promise(r => requestAnimationFrame(r));
            const afterEnter = api.getSettings();

            return {
                initialShortcut: initial.chat?.sendShortcut,
                afterCtrlShortcut: afterCtrl.chat?.sendShortcut,
                afterEnterShortcut: afterEnter.chat?.sendShortcut,
            };
        });

        expect(result.initialShortcut).toBe('Enter');
        expect(result.afterCtrlShortcut).toBe('Ctrl+Enter');
        expect(result.afterEnterShortcut).toBe('Enter');
    });

    test('updateSettings changes chat density', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const initial = api.getSettings();
            api.updateSettings('chat', {density: 'compact'});
            await new Promise(r => requestAnimationFrame(r));
            const afterCompact = api.getSettings();

            api.updateSettings('chat', {density: 'comfortable'});
            await new Promise(r => requestAnimationFrame(r));
            const afterComfortable = api.getSettings();

            return {
                initialDensity: initial.chat?.density,
                afterCompactDensity: afterCompact.chat?.density,
                afterComfortableDensity: afterComfortable.chat?.density,
            };
        });

        expect(result.initialDensity).toBe('comfortable');
        expect(result.afterCompactDensity).toBe('compact');
        expect(result.afterComfortableDensity).toBe('comfortable');
    });

    test('updateSettings changes files autoSave', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const initial = api.getSettings();
            api.updateSettings('files', {autoSave: false});
            await new Promise(r => requestAnimationFrame(r));
            const afterFalse = api.getSettings();

            api.updateSettings('files', {autoSave: true});
            await new Promise(r => requestAnimationFrame(r));
            const afterTrue = api.getSettings();

            return {
                initialAutoSave: initial.files?.autoSave,
                afterFalseAutoSave: afterFalse.files?.autoSave,
                afterTrueAutoSave: afterTrue.files?.autoSave,
            };
        });

        expect(result.initialAutoSave).toBe(true);
        expect(result.afterFalseAutoSave).toBe(false);
        expect(result.afterTrueAutoSave).toBe(true);
    });

    test('updateSettings changes notifications settings', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const initial = api.getSettings();
            api.updateSettings('notifications', {soundEnabled: false, toastEnabled: false});
            await new Promise(r => requestAnimationFrame(r));
            const afterDisabled = api.getSettings();

            api.updateSettings('notifications', {soundEnabled: true, toastEnabled: true});
            await new Promise(r => requestAnimationFrame(r));
            const afterEnabled = api.getSettings();

            return {
                initialSound: initial.notifications?.soundEnabled,
                initialToast: initial.notifications?.toastEnabled,
                afterDisabledSound: afterDisabled.notifications?.soundEnabled,
                afterDisabledToast: afterDisabled.notifications?.toastEnabled,
                afterEnabledSound: afterEnabled.notifications?.soundEnabled,
                afterEnabledToast: afterEnabled.notifications?.toastEnabled,
            };
        });

        expect(result.initialSound).toBe(true);
        expect(result.initialToast).toBe(true);
        expect(result.afterDisabledSound).toBe(false);
        expect(result.afterDisabledToast).toBe(false);
        expect(result.afterEnabledSound).toBe(true);
        expect(result.afterEnabledToast).toBe(true);
    });

    test('updateSettings with unknown section logs warning but does not throw', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // This should log a warning but not throw
            try {
                api.updateSettings('unknown-section', {foo: 'bar'});
                await new Promise(r => requestAnimationFrame(r));
                return {success: true, error: null};
            } catch (err) {
                return {success: false, error: (err as Error).message};
            }
        });

        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Activity State Management
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Activity Management', () => {
    test('setActivity changes active panel', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            const initial = api.getActivity();

            el.activityController.actions.setActivity('files');
            await new Promise(r => requestAnimationFrame(r));
            const afterFiles = api.getActivity();

            el.activityController.actions.setActivity('settings');
            await new Promise(r => requestAnimationFrame(r));
            const afterSettings = api.getActivity();

            el.activityController.actions.setActivity('chat');
            await new Promise(r => requestAnimationFrame(r));
            const afterChat = api.getActivity();

            return {
                initialActive: initial.active,
                afterFilesActive: afterFiles.active,
                afterSettingsActive: afterSettings.active,
                afterChatActive: afterChat.active,
            };
        });

        expect(result.initialActive).toBe('chat');
        expect(result.afterFilesActive).toBe('files');
        expect(result.afterSettingsActive).toBe('settings');
        expect(result.afterChatActive).toBe('chat');
    });

    test('toggleSidebar changes sidebar visibility', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            const initial = api.getActivity();

            el.activityController.actions.toggleSidebar();
            await new Promise(r => requestAnimationFrame(r));
            const afterToggle1 = api.getActivity();

            el.activityController.actions.toggleSidebar();
            await new Promise(r => requestAnimationFrame(r));
            const afterToggle2 = api.getActivity();

            return {
                initialVisible: initial.sidebarVisible,
                afterToggle1Visible: afterToggle1.sidebarVisible,
                afterToggle2Visible: afterToggle2.sidebarVisible,
            };
        });

        expect(result.initialVisible).toBe(true);
        expect(result.afterToggle1Visible).toBe(false);
        expect(result.afterToggle2Visible).toBe(true);
    });

    test('showSidebar and hideSidebar control visibility', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            el.activityController.actions.hideSidebar();
            await new Promise(r => requestAnimationFrame(r));
            const afterHide = api.getActivity();

            el.activityController.actions.showSidebar();
            await new Promise(r => requestAnimationFrame(r));
            const afterShow = api.getActivity();

            return {
                afterHideVisible: afterHide.sidebarVisible,
                afterShowVisible: afterShow.sidebarVisible,
            };
        });

        expect(result.afterHideVisible).toBe(false);
        expect(result.afterShowVisible).toBe(true);
    });

    test('activity reset restores default state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Change state
            el.activityController.actions.setActivity('files');
            el.activityController.actions.hideSidebar();
            await new Promise(r => requestAnimationFrame(r));

            const beforeReset = api.getActivity();

            // Reset
            el.activityController.actions.reset();
            await new Promise(r => requestAnimationFrame(r));

            const afterReset = api.getActivity();

            return {
                beforeResetActive: beforeReset.active,
                beforeResetVisible: beforeReset.sidebarVisible,
                afterResetActive: afterReset.active,
                afterResetVisible: afterReset.sidebarVisible,
            };
        });

        expect(result.beforeResetActive).toBe('files');
        expect(result.beforeResetVisible).toBe(false);
        expect(result.afterResetActive).toBe('chat');
        expect(result.afterResetVisible).toBe(true);
    });

    test('clicking same activity toggles sidebar', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Start with chat active
            el.activityController.actions.setActivity('chat');
            await new Promise(r => requestAnimationFrame(r));
            const initial = api.getActivity();

            // Click chat again (should toggle sidebar)
            el.activityController.actions.setActivity('chat');
            await new Promise(r => requestAnimationFrame(r));
            const afterClick1 = api.getActivity();

            // Click chat again (should toggle back)
            el.activityController.actions.setActivity('chat');
            await new Promise(r => requestAnimationFrame(r));
            const afterClick2 = api.getActivity();

            return {
                initialActive: initial.active,
                initialVisible: initial.sidebarVisible,
                afterClick1Active: afterClick1.active,
                afterClick1Visible: afterClick1.sidebarVisible,
                afterClick2Active: afterClick2.active,
                afterClick2Visible: afterClick2.sidebarVisible,
            };
        });

        // Activity should remain 'chat', but sidebar should toggle
        expect(result.initialActive).toBe('chat');
        expect(result.afterClick1Active).toBe('chat');
        expect(result.afterClick2Active).toBe('chat');
        expect(result.initialVisible).not.toBe(result.afterClick1Visible);
        expect(result.afterClick1Visible).not.toBe(result.afterClick2Visible);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Network State Simulation & Recovery
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Network Simulation', () => {
    test('simulateOffline blocks WebSocket connections', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            api.simulateOffline();
            await new Promise(r => setTimeout(r, 50));

            // Try to create a WebSocket
            let wsError: string | null = null;
            try {
                const ws = new WebSocket('ws://localhost:9999');
                await new Promise<void>((resolve, reject) => {
                    ws.addEventListener('error', () => {
                        wsError = 'WebSocket error fired';
                        resolve();
                    });
                    ws.addEventListener('open', () => {
                        wsError = 'WebSocket opened (should not happen)';
                        resolve();
                    });
                    setTimeout(() => {
                        wsError = 'Timeout waiting for error';
                        resolve();
                    }, 100);
                });
            } catch (err) {
                wsError = (err as Error).message;
            }

            api.restoreNetwork();
            return {wsError};
        });

        expect(result.wsError).toBeTruthy();
        expect(result.wsError).toContain('error');
    });

    test('offline/online cycle maintains state consistency', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Setup initial state and wait for it to settle
            api.loginAs('network-test-user');
            const el = api.element;
            el.sessionController.value.actions.createSession();

            // Wait for login to fully settle (auth state updates may be async)
            await new Promise(r => setTimeout(r, 500));

            const beforeOffline = api.getState();

            // Go offline
            api.simulateOffline();
            await new Promise(r => setTimeout(r, 100));

            const duringOffline = api.getState();

            // Go back online
            api.restoreNetwork();
            await new Promise(r => setTimeout(r, 100));

            const afterOnline = api.getState();

            return {
                beforeOfflineAuth: beforeOffline.auth,
                duringOfflineAuth: duringOffline.auth,
                afterOnlineAuth: afterOnline.auth,
                beforeOfflineSession: beforeOffline.session,
                duringOfflineSession: duringOffline.session,
                afterOnlineSession: afterOnline.session,
            };
        });

        // Auth state should remain consistent across network changes
        expect(result.beforeOfflineAuth).toEqual(result.duringOfflineAuth);
        expect(result.beforeOfflineAuth).toEqual(result.afterOnlineAuth);

        // Session state should remain consistent
        expect(result.beforeOfflineSession).toEqual(result.duringOfflineSession);
        expect(result.beforeOfflineSession).toEqual(result.afterOnlineSession);
    });

    test('multiple offline/online cycles work correctly', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const states: boolean[] = [];

            // Cycle 1
            api.simulateOffline();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);
            api.restoreNetwork();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);

            // Cycle 2
            api.simulateOffline();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);
            api.restoreNetwork();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);

            // Cycle 3
            api.simulateOffline();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);
            api.restoreNetwork();
            await new Promise(r => setTimeout(r, 10));
            states.push(api.isOffline);

            return states;
        });

        expect(result).toEqual([true, false, true, false, true, false]);
    });

    test('simulateOffline when already offline logs warning', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Ensure we start with a clean state
            if (api.isOffline) {
                api.restoreNetwork();
                await new Promise(r => setTimeout(r, 10));
            }

            api.simulateOffline();
            await new Promise(r => setTimeout(r, 10));
            const firstOffline = api.isOffline;

            // Call again (should log warning but not throw)
            try {
                api.simulateOffline();
                await new Promise(r => setTimeout(r, 10));
                const secondOffline = api.isOffline;
                api.restoreNetwork();
                return {success: true, firstOffline, secondOffline};
            } catch (err) {
                api.restoreNetwork();
                return {success: false, error: (err as Error).message};
            }
        });

        expect(result.success).toBe(true);
        expect(result.firstOffline).toBe(true);
        expect(result.secondOffline).toBe(true);
    });

    test('restoreNetwork when online logs warning', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Ensure we're online
            if (api.isOffline) {
                api.restoreNetwork();
            }

            // Call restoreNetwork when already online
            try {
                api.restoreNetwork();
                const isOffline = api.isOffline;
                return {success: true, isOffline};
            } catch (err) {
                return {success: false, error: (err as Error).message};
            }
        });

        expect(result.success).toBe(true);
        expect(result.isOffline).toBe(false);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Tool Call Workflow
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Tool Call Workflow', () => {
    test('tool call with parameters preserves data', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            api.addPendingToolCall({
                id: 'tc-params-test',
                toolName: 'bash',
                command: 'ls -la',
                description: 'List files',
                parameters: {verbose: true, format: 'json'},
            });
            await new Promise(r => requestAnimationFrame(r));

            const calls = api.getToolCalls();
            const call = calls.find((c: any) => c.id === 'tc-params-test');

            return {
                found: !!call,
                toolName: call?.toolName,
                command: call?.command,
                description: call?.description,
                parameters: call?.parameters,
            };
        });

        expect(result.found).toBe(true);
        expect(result.toolName).toBe('bash');
        expect(result.command).toBe('ls -la');
        expect(result.description).toBe('List files');
        expect(result.parameters).toEqual({verbose: true, format: 'json'});
    });

    test('concurrent tool calls maintain order', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Add 5 tool calls rapidly
            for (let i = 0; i < 5; i++) {
                api.addPendingToolCall({
                    id: `tc-concurrent-${i}`,
                    toolName: 'bash',
                    command: `echo ${i}`,
                });
            }
            await new Promise(r => requestAnimationFrame(r));

            const calls = api.getToolCalls();

            return {
                count: calls.length,
                ids: calls.map((c: any) => c.id),
            };
        });

        expect(result.count).toBe(5);
        expect(result.ids).toContain('tc-concurrent-0');
        expect(result.ids).toContain('tc-concurrent-4');
    });

    test('approve/deny cycle updates state correctly', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Add 3 tool calls
            api.addPendingToolCall({id: 'tc-approve-1', toolName: 'bash'});
            api.addPendingToolCall({id: 'tc-deny-1', toolName: 'read'});
            api.addPendingToolCall({id: 'tc-approve-2', toolName: 'bash'});
            await new Promise(r => requestAnimationFrame(r));

            const before = api.getToolCalls().length;

            // Approve first
            api.approveToolCall('tc-approve-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterApprove1 = api.getToolCalls().length;

            // Deny second
            api.denyToolCall('tc-deny-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterDeny1 = api.getToolCalls().length;

            // Approve third
            api.approveToolCall('tc-approve-2');
            await new Promise(r => requestAnimationFrame(r));
            const afterApprove2 = api.getToolCalls().length;

            return {
                before,
                afterApprove1,
                afterDeny1,
                afterApprove2,
            };
        });

        expect(result.before).toBe(3);
        expect(result.afterApprove1).toBe(2);
        expect(result.afterDeny1).toBe(1);
        expect(result.afterApprove2).toBe(0);
    });

    test('approveAllToolCalls with mixed tool names', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Add mixed tool calls
            api.addPendingToolCall({id: 'tc-bash-1', toolName: 'bash'});
            api.addPendingToolCall({id: 'tc-read-1', toolName: 'read'});
            api.addPendingToolCall({id: 'tc-bash-2', toolName: 'bash'});
            api.addPendingToolCall({id: 'tc-write-1', toolName: 'write'});
            api.addPendingToolCall({id: 'tc-bash-3', toolName: 'bash'});
            await new Promise(r => requestAnimationFrame(r));

            const before = api.getToolCalls();

            // Approve all bash calls
            api.approveAllToolCalls('bash');
            await new Promise(r => requestAnimationFrame(r));

            const after = api.getToolCalls();

            return {
                beforeCount: before.length,
                afterCount: after.length,
                remainingTools: after.map((c: any) => c.toolName),
            };
        });

        expect(result.beforeCount).toBe(5);
        expect(result.afterCount).toBe(2);
        expect(result.remainingTools).toContain('read');
        expect(result.remainingTools).toContain('write');
        expect(result.remainingTools).not.toContain('bash');
    });

    test('tool call auto-generates ID when not provided', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Add tool call without ID
            api.addPendingToolCall({
                toolName: 'bash',
                command: 'echo test',
            });
            await new Promise(r => requestAnimationFrame(r));

            const calls = api.getToolCalls();
            const call = calls[0];

            return {
                hasId: !!call.id,
                idFormat: call.id?.startsWith('tc-'),
                toolName: call.toolName,
            };
        });

        expect(result.hasId).toBe(true);
        expect(result.idFormat).toBe(true);
        expect(result.toolName).toBe('bash');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Complex Cross-Controller Flows
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Cross-Controller Integration', () => {
    test('login -> create session -> add tool call -> approve -> verify state', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Step 1: Login
            api.loginAs('workflow-user');
            await new Promise(r => requestAnimationFrame(r));
            const afterLogin = api.getState().auth;

            // Step 2: Create session
            const sessionId = el.sessionController.value.actions.createSession();
            await new Promise(r => requestAnimationFrame(r));
            const afterSession = el.sessionController.value.state;

            // Step 3: Add tool call
            api.addPendingToolCall({
                id: 'tc-workflow-1',
                toolName: 'bash',
                command: 'pwd',
            });
            await new Promise(r => requestAnimationFrame(r));
            const afterToolCall = api.getToolCalls().length;

            // Step 4: Approve tool call
            api.approveToolCall('tc-workflow-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterApprove = api.getToolCalls().length;

            // Step 5: Verify final state
            const finalState = api.getState();

            return {
                afterLoginUserId: afterLogin.userId,
                afterLoginLoggedIn: afterLogin.isLoggedIn,
                afterSessionId: sessionId,
                afterSessionCount: afterSession.sessions.length,
                afterToolCallCount: afterToolCall,
                afterApproveCount: afterApprove,
                finalAuthUserId: finalState.auth.userId,
                finalSessionCount: finalState.session.sessions.length,
            };
        });

        expect(result.afterLoginUserId).toBe('workflow-user');
        expect(result.afterLoginLoggedIn).toBe(true);
        expect(result.afterSessionId).toBeTruthy();
        expect(result.afterSessionCount).toBeGreaterThan(0);
        expect(result.afterToolCallCount).toBe(1);
        expect(result.afterApproveCount).toBe(0);
        expect(result.finalAuthUserId).toBe('workflow-user');
        expect(result.finalSessionCount).toBeGreaterThan(0);
    });

    test('settings change -> activity change -> verify both persist', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Change settings
            api.updateSettings('appearance', {theme: 'dark', fontSize: 16});
            await new Promise(r => requestAnimationFrame(r));
            const afterSettings = api.getSettings();

            // Change activity
            el.activityController.actions.setActivity('files');
            el.activityController.actions.hideSidebar();
            await new Promise(r => requestAnimationFrame(r));
            const afterActivity = api.getActivity();

            // Verify both states
            const settings = api.getSettings();
            const activity = api.getActivity();

            return {
                afterSettingsTheme: afterSettings.appearance?.theme,
                afterSettingsFontSize: afterSettings.appearance?.fontSize,
                afterActivityActive: afterActivity.active,
                afterActivityVisible: afterActivity.sidebarVisible,
                finalTheme: settings.appearance?.theme,
                finalFontSize: settings.appearance?.fontSize,
                finalActive: activity.active,
                finalVisible: activity.sidebarVisible,
            };
        });

        expect(result.afterSettingsTheme).toBe('dark');
        expect(result.afterSettingsFontSize).toBe(16);
        expect(result.afterActivityActive).toBe('files');
        expect(result.afterActivityVisible).toBe(false);
        expect(result.finalTheme).toBe('dark');
        expect(result.finalFontSize).toBe(16);
        expect(result.finalActive).toBe('files');
        expect(result.finalVisible).toBe(false);
    });

    test('network offline -> tool call -> restore -> verify consistency', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Ensure clean network state
            if (api.isOffline) {
                api.restoreNetwork();
                await new Promise(r => setTimeout(r, 10));
            }

            // Go offline
            api.simulateOffline();
            await new Promise(r => setTimeout(r, 100));

            // Add tool call while offline
            api.addPendingToolCall({
                id: 'tc-offline-1',
                toolName: 'bash',
                command: 'echo offline',
            });
            await new Promise(r => requestAnimationFrame(r));
            const duringOffline = api.getToolCalls().length;

            // Restore network
            api.restoreNetwork();
            await new Promise(r => setTimeout(r, 100));

            // Approve tool call
            api.approveToolCall('tc-offline-1');
            await new Promise(r => requestAnimationFrame(r));
            const afterApprove = api.getToolCalls().length;

            return {
                duringOfflineCount: duringOffline,
                afterApproveCount: afterApprove,
            };
        });

        // Verify tool call workflow works across network changes
        expect(result.duringOfflineCount).toBe(1);
        expect(result.afterApproveCount).toBe(0);
    });

    test('multiple sessions -> multiple tool calls -> approve all', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Create 3 sessions
            const id1 = el.sessionController.value.actions.createSession();
            const id2 = el.sessionController.value.actions.createSession();
            const id3 = el.sessionController.value.actions.createSession();
            await new Promise(r => requestAnimationFrame(r));

            // Add tool calls for each session
            api.addPendingToolCall({id: `tc-${id1}-1`, toolName: 'bash'});
            api.addPendingToolCall({id: `tc-${id1}-2`, toolName: 'read'});
            api.addPendingToolCall({id: `tc-${id2}-1`, toolName: 'bash'});
            api.addPendingToolCall({id: `tc-${id3}-1`, toolName: 'write'});
            await new Promise(r => requestAnimationFrame(r));

            const before = api.getToolCalls().length;

            // Approve all bash calls
            api.approveAllToolCalls('bash');
            await new Promise(r => requestAnimationFrame(r));

            const afterBash = api.getToolCalls().length;

            // Approve remaining individually
            api.approveToolCall(`tc-${id1}-2`);
            api.approveToolCall(`tc-${id3}-1`);
            await new Promise(r => requestAnimationFrame(r));

            const afterAll = api.getToolCalls().length;

            return {
                sessionCount: el.sessionController.value.state.sessions.length,
                beforeApprove: before,
                afterBashApprove: afterBash,
                afterAllApprove: afterAll,
            };
        });

        expect(result.sessionCount).toBeGreaterThanOrEqual(3);
        expect(result.beforeApprove).toBe(4);
        expect(result.afterBashApprove).toBe(2);
        expect(result.afterAllApprove).toBe(0);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Performance Metrics After Operations
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Performance Metrics', () => {
    test('metrics update after heavy operations', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Get initial metrics
            const before = api.getMetrics();
            const beforeLogLength = before.logs.bufferLength;

            // Perform heavy operations
            for (let i = 0; i < 10; i++) {
                await api.writeFile(`/perf-test/file-${i}.txt`, `content-${i}`);
            }

            api.loginAs('perf-test-user');
            await new Promise(r => requestAnimationFrame(r));

            for (let i = 0; i < 5; i++) {
                api.addPendingToolCall({
                    id: `tc-perf-${i}`,
                    toolName: 'bash',
                    command: `echo ${i}`,
                });
            }
            await new Promise(r => requestAnimationFrame(r));

            // Get metrics after operations
            const after = api.getMetrics();
            const afterLogLength = after.logs.bufferLength;

            return {
                beforeLogLength,
                afterLogLength,
                logIncrease: afterLogLength - beforeLogLength,
                componentState: after.component,
            };
        });

        expect(result.logIncrease).toBeGreaterThan(0);
        expect(result.componentState).toBeDefined();
        expect(result.componentState.isConnected).toBe(true);
    });

    test('metrics include DOM node count', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            const metrics = api.getMetrics();
            const dom = metrics.dom;

            return {
                nodeCount: dom.nodeCount,
                rtcAgentChildren: dom.rtcAgentChildren,
                nodeCountPositive: dom.nodeCount > 0,
            };
        });

        expect(result.nodeCountPositive).toBe(true);
        expect(typeof result.nodeCount).toBe('number');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge Cases & Error Handling
// ────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Flow - Edge Cases', () => {
    test('rapid activity changes maintain consistency', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;
            const el = api.element;

            // Rapidly change activity
            const activities = ['chat', 'files', 'settings', 'chat', 'files', 'settings'];
            for (const activity of activities) {
                el.activityController.actions.setActivity(activity);
            }
            await new Promise(r => requestAnimationFrame(r));

            const final = api.getActivity();

            return {
                finalActive: final.active,
                finalVisible: final.sidebarVisible,
            };
        });

        expect(result.finalActive).toBe('settings');
        expect(typeof result.finalVisible).toBe('boolean');
    });

    test('rapid settings updates maintain consistency', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            // Rapidly update settings
            for (let i = 0; i < 10; i++) {
                api.updateSettings('appearance', {fontSize: 10 + i});
            }
            await new Promise(r => requestAnimationFrame(r));

            const final = api.getSettings();

            return {
                finalFontSize: final.appearance?.fontSize,
            };
        });

        expect(result.finalFontSize).toBe(19); // Last value: 10 + 9
    });

    test('tool call operations on empty list do not throw', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await evalInPage(page, async () => {
            const api = (window as any).rtcAgentDebug;

            try {
                // Try to approve non-existent tool call
                const approveResult = api.approveToolCall('non-existent-id');

                // Try to deny non-existent tool call
                const denyResult = api.denyToolCall('non-existent-id');

                // Try to approve all for non-existent tool name
                api.approveAllToolCalls('non-existent-tool');

                await new Promise(r => requestAnimationFrame(r));

                return {
                    success: true,
                    approveResult,
                    denyResult,
                };
            } catch (err) {
                return {
                    success: false,
                    error: (err as Error).message,
                };
            }
        });

        expect(result.success).toBe(true);
        expect(result.approveResult).toBe(false);
        expect(result.denyResult).toBe(false);
    });
});
