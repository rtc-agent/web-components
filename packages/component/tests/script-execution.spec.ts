/**
 * Playwright test for Task Manager script execution
 *
 * Tests that rtcAgent.task.create() works correctly in the browser sandbox
 * via the script tool (toolRegistry.get('script')).
 */

import { test, expect } from '@playwright/test';

test.describe('Task Manager - Script Execution', () => {
  test('should execute rtcAgent.task.create via script tool', async ({ page }) => {
    // Navigate to the Task Manager demo page (served by Vite at port 3000)
    await page.goto('http://localhost:3000');

    // Wait for the task list container to render
    await page.waitForSelector('.task-list');

    // Wait for registry to be initialized and functions registered
    await page.waitForFunction(() => {
      return window.registry && window.registry.listFunctions().length > 0;
    }, { timeout: 5000 });

    // Wait for toolRegistry bridge to be established
    // (SkillController bridges rtcAgentAPI into toolRegistry when registry is set on <rtc-agent>)
    await page.waitForFunction(() => {
      return window.toolRegistry && window.toolRegistry.has('script');
    }, { timeout: 5000 });

    // Execute the script via the script tool (simulating what the LLM agent does)
    const result = await page.evaluate(async () => {
      const scriptTool = window.toolRegistry.get('script');
      if (!scriptTool) {
        return { error: 'script tool not found in toolRegistry' };
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

    // Verify no error occurred
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);

    // Verify console output was captured
    const scriptResult = result.result as { data?: { logs?: string[] } };
    expect(scriptResult.data?.logs).toBeDefined();
    expect(scriptResult.data!.logs!.length).toBeGreaterThan(0);
    expect(scriptResult.data!.logs![0]).toContain('Created:');

    // Verify the task was created in the registry (stored in localStorage by TaskManager)
    const tasks = await page.evaluate(async () => {
      return await window.registry.execute('task.list', {}) as Array<{ title: string }>;
    });

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.some((t) => t.title === 'test')).toBe(true);

    // Manually trigger UI refresh and verify the task appears
    await page.evaluate(() => {
      window.renderTasks();
    });

    const taskTitle = await page.textContent('.task-title');
    expect(taskTitle).toContain('test');
  });

  test('should show task in UI after creation', async ({ page }) => {
    await page.goto('http://localhost:3000');
    await page.waitForSelector('.task-list');

    // Wait for registry
    await page.waitForFunction(() => {
      return window.registry && window.registry.listFunctions().length > 0;
    }, { timeout: 5000 });

    // Create a task using the registry directly
    await page.evaluate(async () => {
      await window.registry.execute('task.create', { title: 'UI test task' });
      await window.renderTasks();
    });

    // Wait for UI to update
    await page.waitForSelector('.task-title');

    // Verify task appears in UI
    const taskTitles = await page.$$eval('.task-title', els => els.map(el => el.textContent));
    expect(taskTitles.some(t => t?.includes('UI test task'))).toBe(true);
  });
});
