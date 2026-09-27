/**
 * Doc Reconciliation E2E Tests
 *
 * Tests the orphan document cleanup mechanism:
 * - Function docs: when config changes, stale docs under /functions/ are deleted
 * - INDEX.md / AGENT.md are never deleted
 * - Edge cases: empty registry, re-registration, orphan seeding, concurrent changes
 *
 * Note: The debug page does not initialize a SharedWorker (no backend available),
 * so batchWriteFiles() is not available. These tests call generateAllDocsContent()
 * to compute files + deletePaths, then manually apply writes/deletes via the debug
 * API to verify the VFS state. This tests the core reconciliation logic (orphan
 * detection) end-to-end through real IndexedDB.
 *
 * Prerequisites: Vite dev server running (started automatically by Playwright).
 *
 * Run: npx playwright test --config=packages/component/playwright.config.ts tests/doc-reconciliation.spec.ts
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
 * Set agentConfig on the component, run reconciliation manually, and return results.
 *
 * Since the debug page doesn't have a SharedWorker, we simulate what
 * _regenerateDocsAfterRegistrySet + batchWriteFiles would do:
 * 1. Set agentConfig → builds registry
 * 2. Call generateAllDocsContent() → computes files + deletePaths
 * 3. Write files and delete orphans via the debug API (direct IndexedDB)
 */
async function setConfigAndReconcile(
    page: Page,
    config: {
        name: string;
        description?: string;
        persona?: string;
        groups?: Array<{
            name: string;
            description?: string;
            functions: Array<{name: string; description: string}>;
        }>;
    },
): Promise<{
    filesWritten: number;
    pathsDeleted: number;
    deletedPaths: string[];
}> {
    return page.evaluate((cfg) => {
        const api = (window as any).rtcAgentDebug;
        const el = api.element;

        // 1. Build registry from config (with handlers in browser context)
        const rebuiltConfig = {
            ...cfg,
            groups: (cfg.groups || []).map((g: any) => ({
                ...g,
                functions: g.functions.map((f: any) => ({
                    ...f,
                    handler: async () => `${f.name} result`,
                })),
            })),
        };
        el.agentConfig = rebuiltConfig;

        // 2. Get registry and generate docs content (computes orphan paths)
        const registry = el._skill.actions.getRegistry();
        return registry.generateAllDocsContent(0).then(async (result: any) => {
            // 3. Write files
            for (const file of result.files) {
                await api.writeFile(file.path, file.content);
            }
            // 4. Delete orphans
            for (const path of result.deletePaths) {
                await api.deleteFile(path);
            }
            return {
                filesWritten: result.files.length,
                pathsDeleted: result.deletePaths.length,
                deletedPaths: result.deletePaths,
            };
        });
    }, config);
}

/**
 * Helper: create a serializable function def (no handler — rebuilt in browser).
 */
function makeFunc(name: string, desc = `Function ${name}`) {
    return { name, description: desc };
}

// ────────────────────────────────────────────────────────────────────────────
// Basic Function Doc Generation
// ────────────────────────────────────────────────────────────────────────────

test.describe('Doc Reconciliation - Basic Generation', () => {
    test('setting agentConfig generates function docs + INDEX.md + AGENT.md', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const result = await setConfigAndReconcile(page, {
            name: 'TestAgent',
            description: 'Test agent for reconciliation',
            groups: [{
                name: 'math',
                description: 'Math operations',
                functions: [
                    makeFunc('add', 'Add two numbers'),
                    makeFunc('subtract', 'Subtract two numbers'),
                ],
            }],
        });

        // Should generate: 2 func docs + system docs + INDEX.md + AGENT.md
        expect(result.filesWritten).toBeGreaterThan(2);

        const docs = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                addDoc: await api.readFile('/functions/math/add.md'),
                subDoc: await api.readFile('/functions/math/subtract.md'),
                indexDoc: await api.readFile('/functions/INDEX.md'),
                agentDoc: await api.readFile('/AGENT.md'),
            };
        });

        expect(docs.addDoc.length).toBeGreaterThan(0);
        expect(docs.addDoc).toContain('add');
        expect(docs.subDoc.length).toBeGreaterThan(0);
        expect(docs.subDoc).toContain('subtract');
        expect(docs.indexDoc.length).toBeGreaterThan(0);
        expect(docs.indexDoc).toContain('math');
        expect(docs.agentDoc.length).toBeGreaterThan(0);
        expect(docs.agentDoc).toContain('TestAgent');
    });

    test('docs contain correct function metadata', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        await setConfigAndReconcile(page, {
            name: 'MetaAgent',
            description: 'Agent with described functions',
            groups: [{
                name: 'editor',
                description: 'Editor operations',
                functions: [
                    makeFunc('getCode', 'Get the current editor code'),
                ],
            }],
        });

        const doc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/functions/editor/getCode.md');
        });

        expect(doc).toContain('# editor.getCode');
        expect(doc).toContain('Get the current editor code');
        expect(doc).toContain('AUTO-GENERAGED');
        expect(doc).toContain('rtcAgent.editor.getCode');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Orphan Cleanup — Function Docs
// ────────────────────────────────────────────────────────────────────────────

test.describe('Doc Reconciliation - Orphan Cleanup', () => {
    test('removing a function from config deletes its doc', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Step 1: Register 3 functions
        await setConfigAndReconcile(page, {
            name: 'ShrinkAgent',
            groups: [{
                name: 'task',
                description: 'Task operations',
                functions: [makeFunc('create'), makeFunc('update'), makeFunc('delete')],
            }],
        });

        // Verify all 3 docs exist
        const before = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                create: (await api.readFile('/functions/task/create.md')).length > 0,
                update: (await api.readFile('/functions/task/update.md')).length > 0,
                delete: (await api.readFile('/functions/task/delete.md')).length > 0,
            };
        });
        expect(before.create).toBe(true);
        expect(before.update).toBe(true);
        expect(before.delete).toBe(true);

        // Step 2: Re-register with only 2 functions (remove 'delete')
        const reconcile = await setConfigAndReconcile(page, {
            name: 'ShrinkAgent',
            groups: [{
                name: 'task',
                description: 'Task operations',
                functions: [makeFunc('create'), makeFunc('update')],
            }],
        });

        // Verify deletePaths includes the orphan
        expect(reconcile.deletedPaths).toContain('/functions/task/delete.md');

        // Verify 'delete' doc is gone, others remain
        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                create: (await api.readFile('/functions/task/create.md')).length > 0,
                update: (await api.readFile('/functions/task/update.md')).length > 0,
                delete: (await api.readFile('/functions/task/delete.md')).length > 0,
            };
        });
        expect(after.create).toBe(true);
        expect(after.update).toBe(true);
        expect(after.delete).toBe(false);
    });

    test('removing an entire group deletes all its docs', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Step 1: Two groups
        await setConfigAndReconcile(page, {
            name: 'TwoGroupAgent',
            groups: [
                {
                    name: 'math',
                    description: 'Math ops',
                    functions: [makeFunc('add'), makeFunc('sub')],
                },
                {
                    name: 'text',
                    description: 'Text ops',
                    functions: [makeFunc('upper'), makeFunc('lower')],
                },
            ],
        });

        // Step 2: Remove 'text' group entirely
        const reconcile = await setConfigAndReconcile(page, {
            name: 'TwoGroupAgent',
            groups: [
                {
                    name: 'math',
                    description: 'Math ops',
                    functions: [makeFunc('add'), makeFunc('sub')],
                },
            ],
        });

        // Verify text group docs are in deletePaths
        expect(reconcile.deletedPaths).toContain('/functions/text/upper.md');
        expect(reconcile.deletedPaths).toContain('/functions/text/lower.md');
        // Math docs should NOT be in deletePaths
        expect(reconcile.deletedPaths).not.toContain('/functions/math/add.md');

        // Verify VFS state
        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                mathAdd: (await api.readFile('/functions/math/add.md')).length > 0,
                textUpper: (await api.readFile('/functions/text/upper.md')).length > 0,
                textLower: (await api.readFile('/functions/text/lower.md')).length > 0,
            };
        });
        expect(after.mathAdd).toBe(true);
        expect(after.textUpper).toBe(false);
        expect(after.textLower).toBe(false);
    });

    test('pre-seeded orphan function docs are cleaned up', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed orphan function docs (simulating stale docs from a previous config)
        await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            await api.seedData({
                files: [
                    {path: '/functions/oldGroup/oldFunc1.md', content: '# oldFunc1\nStale doc'},
                    {path: '/functions/oldGroup/oldFunc2.md', content: '# oldFunc2\nStale doc'},
                    {path: '/functions/legacy.md', content: '# legacy\nUngrouped stale doc'},
                ],
            });
        });

        // Set a clean config (no oldGroup, no legacy)
        const reconcile = await setConfigAndReconcile(page, {
            name: 'CleanAgent',
            groups: [{
                name: 'newGroup',
                description: 'Fresh group',
                functions: [makeFunc('fresh')],
            }],
        });

        // Verify orphans are in deletePaths
        expect(reconcile.deletedPaths).toContain('/functions/oldGroup/oldFunc1.md');
        expect(reconcile.deletedPaths).toContain('/functions/oldGroup/oldFunc2.md');
        expect(reconcile.deletedPaths).toContain('/functions/legacy.md');

        // Verify VFS state
        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                old1: (await api.readFile('/functions/oldGroup/oldFunc1.md')).length > 0,
                old2: (await api.readFile('/functions/oldGroup/oldFunc2.md')).length > 0,
                legacy: (await api.readFile('/functions/legacy.md')).length > 0,
                fresh: (await api.readFile('/functions/newGroup/fresh.md')).length > 0,
            };
        });
        expect(after.old1).toBe(false);
        expect(after.old2).toBe(false);
        expect(after.legacy).toBe(false);
        expect(after.fresh).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// INDEX.md / AGENT.md Protection
// ────────────────────────────────────────────────────────────────────────────

test.describe('Doc Reconciliation - System File Protection', () => {
    test('INDEX.md is never in deletePaths even when registry becomes empty', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Step 1: Register with functions
        await setConfigAndReconcile(page, {
            name: 'PopulatedAgent',
            groups: [{
                name: 'group',
                description: 'A group',
                functions: [makeFunc('func1')],
            }],
        });

        // Step 2: Set empty config (no functions)
        const reconcile = await setConfigAndReconcile(page, {
            name: 'EmptyAgent',
            description: 'No functions',
        });

        // INDEX.md should NOT be in deletePaths
        expect(reconcile.deletedPaths).not.toContain('/functions/INDEX.md');
        // The function doc should be deleted
        expect(reconcile.deletedPaths).toContain('/functions/group/func1.md');

        // INDEX.md should still exist (regenerated with empty content)
        const indexDoc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/functions/INDEX.md');
        });
        expect(indexDoc.length).toBeGreaterThan(0);
        expect(indexDoc).not.toContain('group');
    });

    test('AGENT.md is always regenerated (never in deletePaths)', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const reconcile = await setConfigAndReconcile(page, {
            name: 'NamedAgent',
            description: 'An agent with a name',
            persona: 'You are helpful.',
            groups: [{
                name: 'tools',
                description: 'Tool functions',
                functions: [makeFunc('run')],
            }],
        });

        expect(reconcile.deletedPaths).not.toContain('/AGENT.md');

        const agentDoc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/AGENT.md');
        });
        expect(agentDoc).toContain('NamedAgent');
        expect(agentDoc).toContain('An agent with a name');
    });

    test('empty registry cleans up all function docs but keeps INDEX.md and AGENT.md', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Step 1: Populate
        await setConfigAndReconcile(page, {
            name: 'FullAgent',
            groups: [{
                name: 'alpha',
                description: 'Alpha group',
                functions: [makeFunc('a1'), makeFunc('a2')],
            }, {
                name: 'beta',
                description: 'Beta group',
                functions: [makeFunc('b1')],
            }],
        });

        // Step 2: Empty config
        const reconcile = await setConfigAndReconcile(page, {
            name: 'EmptyAgent',
        });

        // All function docs should be in deletePaths
        expect(reconcile.deletedPaths).toContain('/functions/alpha/a1.md');
        expect(reconcile.deletedPaths).toContain('/functions/alpha/a2.md');
        expect(reconcile.deletedPaths).toContain('/functions/beta/b1.md');
        // System files should NOT be in deletePaths
        expect(reconcile.deletedPaths).not.toContain('/functions/INDEX.md');
        expect(reconcile.deletedPaths).not.toContain('/AGENT.md');

        // Verify VFS state
        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                a1: (await api.readFile('/functions/alpha/a1.md')).length > 0,
                a2: (await api.readFile('/functions/alpha/a2.md')).length > 0,
                b1: (await api.readFile('/functions/beta/b1.md')).length > 0,
                indexLen: (await api.readFile('/functions/INDEX.md')).length,
                agentDoc: await api.readFile('/AGENT.md'),
            };
        });
        expect(after.a1).toBe(false);
        expect(after.a2).toBe(false);
        expect(after.b1).toBe(false);
        expect(after.indexLen).toBeGreaterThan(0);
        expect(after.agentDoc).toContain('EmptyAgent');
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Re-registration & Idempotency
// ────────────────────────────────────────────────────────────────────────────

test.describe('Doc Reconciliation - Re-registration', () => {
    test('re-adding a removed function recreates its doc', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Register with func
        await setConfigAndReconcile(page, {
            name: 'ToggleAgent',
            groups: [{
                name: 'svc',
                description: 'Service',
                functions: [makeFunc('ping')],
            }],
        });

        let pingDoc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/functions/svc/ping.md');
        });
        expect(pingDoc.length).toBeGreaterThan(0);

        // Remove func
        await setConfigAndReconcile(page, {
            name: 'ToggleAgent',
            groups: [{
                name: 'svc',
                description: 'Service',
                functions: [],
            }],
        });

        pingDoc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/functions/svc/ping.md');
        });
        expect(pingDoc.length).toBe(0);

        // Re-add func
        await setConfigAndReconcile(page, {
            name: 'ToggleAgent',
            groups: [{
                name: 'svc',
                description: 'Service',
                functions: [makeFunc('ping')],
            }],
        });

        pingDoc = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return await api.readFile('/functions/svc/ping.md');
        });
        expect(pingDoc.length).toBeGreaterThan(0);
        expect(pingDoc).toContain('ping');
    });

    test('setting the same config twice is idempotent', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const config = {
            name: 'IdempotentAgent',
            groups: [{
                name: 'grp',
                description: 'A group',
                functions: [makeFunc('fn1'), makeFunc('fn2')],
            }],
        };

        await setConfigAndReconcile(page, config);
        const second = await setConfigAndReconcile(page, config);

        // Second reconciliation should have 0 deletes (nothing is orphaned)
        expect(second.pathsDeleted).toBe(0);

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                fn1: (await api.readFile('/functions/grp/fn1.md')).length > 0,
                fn2: (await api.readFile('/functions/grp/fn2.md')).length > 0,
                index: (await api.readFile('/functions/INDEX.md')).length > 0,
            };
        });
        expect(result.fn1).toBe(true);
        expect(result.fn2).toBe(true);
        expect(result.index).toBe(true);
    });
});

// ────────────────────────────────────────────────────────────────────────────
// Edge Cases
// ────────────────────────────────────────────────────────────────────────────

test.describe('Doc Reconciliation - Edge Cases', () => {
    test('non-function files under /functions/ are also cleaned up', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed non-.md files under /functions/
        await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            await api.seedData({
                files: [
                    {path: '/functions/stray.json', content: '{"orphan": true}'},
                    {path: '/functions/notes.txt', content: 'random notes'},
                ],
            });
        });

        const reconcile = await setConfigAndReconcile(page, {
            name: 'CleanAgent',
            groups: [{
                name: 'g',
                description: 'Group',
                functions: [makeFunc('x')],
            }],
        });

        // Non-md orphans should also be detected (find('**', '/functions/') matches all)
        expect(reconcile.deletedPaths).toContain('/functions/stray.json');
        expect(reconcile.deletedPaths).toContain('/functions/notes.txt');

        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                json: (await api.readFile('/functions/stray.json')).length > 0,
                txt: (await api.readFile('/functions/notes.txt')).length > 0,
                x: (await api.readFile('/functions/g/x.md')).length > 0,
            };
        });
        expect(after.json).toBe(false);
        expect(after.txt).toBe(false);
        expect(after.x).toBe(true);
    });

    test('files outside /functions/ are NOT affected by reconciliation', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed files in other directories
        await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            await api.seedData({
                files: [
                    {path: '/scripts/myscript.js', content: 'console.log("hello")'},
                    {path: '/custom/readme.md', content: '# Custom'},
                    {path: '/scenarios/INDEX.md', content: '# Scenarios'},
                ],
            });
        });

        await setConfigAndReconcile(page, {
            name: 'ScopedAgent',
            groups: [{
                name: 'g',
                description: 'Group',
                functions: [makeFunc('fn')],
            }],
        });

        // Non-function files should be untouched
        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                script: (await api.readFile('/scripts/myscript.js')).length > 0,
                custom: (await api.readFile('/custom/readme.md')).length > 0,
                scenarios: (await api.readFile('/scenarios/INDEX.md')).length > 0,
            };
        });
        expect(result.script).toBe(true);
        expect(result.custom).toBe(true);
        expect(result.scenarios).toBe(true);
    });

    test('no orphans when config has no changes', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        const config = {
            name: 'StableAgent',
            groups: [{
                name: 'svc',
                description: 'Service',
                functions: [makeFunc('a'), makeFunc('b')],
            }],
        };

        // First reconcile: creates docs
        const first = await setConfigAndReconcile(page, config);
        // first may have orphans from the debug page's built-in registry setup
        // (system functions are always present)

        // Second reconcile: no orphans
        const second = await setConfigAndReconcile(page, config);
        expect(second.pathsDeleted).toBe(0);

        // Third reconcile: still no orphans
        const third = await setConfigAndReconcile(page, config);
        expect(third.pathsDeleted).toBe(0);
    });

    test('built-in system functions always have docs', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        await setConfigAndReconcile(page, {
            name: 'MinimalAgent',
            groups: [{
                name: 'custom',
                description: 'Custom group',
                functions: [makeFunc('myFunc')],
            }],
        });

        const result = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                delay: (await api.readFile('/functions/system/delay.md')).length > 0,
                uuid: (await api.readFile('/functions/system/uuid.md')).length > 0,
                now: (await api.readFile('/functions/system/now.md')).length > 0,
                random: (await api.readFile('/functions/system/random.md')).length > 0,
                time: (await api.readFile('/functions/system/time.md')).length > 0,
                timezone: (await api.readFile('/functions/system/timezone.md')).length > 0,
                custom: (await api.readFile('/functions/custom/myFunc.md')).length > 0,
            };
        });

        expect(result.delay).toBe(true);
        expect(result.uuid).toBe(true);
        expect(result.now).toBe(true);
        expect(result.random).toBe(true);
        expect(result.time).toBe(true);
        expect(result.timezone).toBe(true);
        expect(result.custom).toBe(true);
    });

    test('stress test: 50 functions across 5 groups → shrink to 1', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Create 5 groups with 10 functions each
        const groups = [];
        for (let g = 0; g < 5; g++) {
            const funcs = [];
            for (let f = 0; f < 10; f++) {
                funcs.push(makeFunc(`func_${g}_${f}`, `Function ${g}.${f}`));
            }
            groups.push({name: `group${g}`, description: `Group ${g}`, functions: funcs});
        }

        const first = await setConfigAndReconcile(page, {
            name: 'StressAgent',
            groups,
        });

        // Spot-check docs
        let docs = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                first: (await api.readFile('/functions/group0/func_0_0.md')).length > 0,
                middle: (await api.readFile('/functions/group2/func_2_5.md')).length > 0,
                last: (await api.readFile('/functions/group4/func_4_9.md')).length > 0,
            };
        });
        expect(docs.first).toBe(true);
        expect(docs.middle).toBe(true);
        expect(docs.last).toBe(true);

        // Shrink to 1 group with 1 function — should clean up all 50
        const second = await setConfigAndReconcile(page, {
            name: 'StressAgent',
            groups: [{
                name: 'only',
                description: 'Only group',
                functions: [makeFunc('sole')],
            }],
        });

        // All 50 old function docs should be in deletePaths
        expect(second.pathsDeleted).toBeGreaterThanOrEqual(50);

        const after = await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            return {
                oldFirst: (await api.readFile('/functions/group0/func_0_0.md')).length > 0,
                oldMiddle: (await api.readFile('/functions/group2/func_2_5.md')).length > 0,
                oldLast: (await api.readFile('/functions/group4/func_4_9.md')).length > 0,
                sole: (await api.readFile('/functions/only/sole.md')).length > 0,
                index: (await api.readFile('/functions/INDEX.md')).length > 0,
            };
        });
        expect(after.oldFirst).toBe(false);
        expect(after.oldMiddle).toBe(false);
        expect(after.oldLast).toBe(false);
        expect(after.sole).toBe(true);
        expect(after.index).toBe(true);
    });

    test('generateAllDocsContent returns correct deletePaths for orphan in subdirectory', async ({page}) => {
        await page.goto(DEBUG_PAGE);
        await waitForDebugAPI(page);

        // Seed an orphan in a subdirectory
        await page.evaluate(async () => {
            const api = (window as any).rtcAgentDebug;
            await api.writeFile('/functions/removedGroup/removedFunc.md', '# removed\nOld doc');
        });

        const reconcile = await setConfigAndReconcile(page, {
            name: 'Agent',
            groups: [{
                name: 'keep',
                description: 'Keep this',
                functions: [makeFunc('kept')],
            }],
        });

        expect(reconcile.deletedPaths).toContain('/functions/removedGroup/removedFunc.md');
        expect(reconcile.deletedPaths).not.toContain('/functions/keep/kept.md');
    });
});
