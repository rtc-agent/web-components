/**
 * Playwright test for index.html script execution
 *
 * Tests that rtcAgent.task.create() works correctly in the browser sandbox
 */

import { test, expect } from '@playwright/test';

test.describe('Task Manager - Script Execution', () => {
  test('should execute rtcAgent.task.create via script tool', async ({ page }) => {
    // Navigate to the page
    await page.goto('http://localhost:3000');

    // Wait for the page to load
    await page.waitForSelector('.task-list');

    // Wait for registry to be initialized (exposed to window)
    await page.waitForFunction(() => {
      // @ts-ignore
      return window.registry && window.registry.listFunctions().length > 0;
    }, { timeout: 5000 });

    // Execute the script via the toolRegistry (simulating what the Agent does)
    const result = await page.evaluate(async () => {
      // @ts-ignore - access toolRegistry from window
      const toolRegistry = window.toolRegistry;

      const scriptTool = toolRegistry.get('script');
      if (!scriptTool) {
        return { error: 'script tool not found' };
      }

      try {
        const result = await scriptTool.execute({
          action: 'eval',
          code: 'const task = await rtcAgent.task.create({ title: "test" })\nconsole.log("Created:", task)'
        });
        return { success: true, result };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    });

    console.log('Script execution result:', result);

    // Verify no error
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    // Verify console output was captured
    expect(result.result.data.logs).toBeDefined();
    expect(result.result.data.logs.length).toBeGreaterThan(0);
    expect(result.result.data.logs[0]).toContain('Created:');

    // Verify the task was saved to virtualFS
    const tasks = await page.evaluate(async () => {
      // @ts-ignore
      const virtualFS = window.virtualFS;
      const data = await virtualFS.read('/tasks.json');
      return JSON.parse(data || '[]');
    });

    console.log('Tasks in virtualFS:', tasks);
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t: any) => t.title === 'test')).toBe(true);

    // Manually trigger UI refresh and verify
    await page.evaluate(() => {
      // @ts-ignore
      renderTasks();
    });

    const taskTitle = await page.textContent('.task-title');
    expect(taskTitle).toContain('test');
  });

  test('should show task in UI after creation', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.task-list');

    // Wait for registry
    await page.waitForFunction(() => {
      // @ts-ignore
      return window.registry && window.registry.listFunctions().length > 0;
    }, { timeout: 5000 });

    // Create a task using the registry directly
    await page.evaluate(async () => {
      // @ts-ignore
      await window.registry.task.create({ title: 'UI test task' });
      // @ts-ignore
      await renderTasks();
    });

    // Wait for UI to update
    await page.waitForSelector('.task-title');

    // Verify task appears in UI
    const taskTitles = await page.$$eval('.task-title', els => els.map(el => el.textContent));
    expect(taskTitles.some(t => t?.includes('UI test task'))).toBe(true);
  });
});
