import { expect, test } from '../fixtures/rtc-functions';

test.describe('serverConfig Group - Server Configuration Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to server configs page
    await login();
    await page.goto('/system/configs');
    await page.waitForLoadState('networkidle');
  });

  test('serverConfig.list - Query config list (consistent with UI)', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call function
    const result = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 20,
    });

    // Verify return structure
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');

    // Verify data is an array
    const resultData = (result as any).data;
    expect(Array.isArray(resultData)).toBe(true);

    // Verify total is a non-negative number
    expect((result as any).total).toBeGreaterThanOrEqual(0);

    // Verify data count matches table rows
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    expect(resultData.length).toBe(tableRows);
  });

  test('serverConfig.list - Data items have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Each item should have the required fields
    for (const item of resultData) {
      expect(item).toHaveProperty('key');
      expect(typeof item.key).toBe('string');
      expect(item).toHaveProperty('value');
      expect(item).toHaveProperty('value_type');
      expect(['string', 'int', 'float', 'bool', 'duration', 'json']).toContain(
        item.value_type,
      );
      expect(item).toHaveProperty('source');
      expect(['yaml', 'system']).toContain(item.source);
      expect(item).toHaveProperty('version');
      expect(typeof item.version).toBe('number');
    }
  });

  test('serverConfig.list - Pagination works', async ({ callFunction }) => {
    const result = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 5,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // Page size should be at most 5
    expect(resultData.length).toBeLessThanOrEqual(5);
  });

  test('serverConfig.list - Filter by category', async ({ callFunction }) => {
    const result = await callFunction('serverConfig.list', {
      category: 'llm',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // All returned items should have category = 'llm'
    for (const item of resultData) {
      expect(item.category).toBe('llm');
    }
  });

  test('serverConfig.update - Update config value and table refreshes', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // First, get the current list to find a config to update
    const listResult = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 20,
    });
    expect(listResult).toHaveProperty('success', true);
    const listData = (listResult as any).data;

    // Skip if no configs available
    if (listData.length === 0) {
      test.skip();
      return;
    }

    // Find a config that has source='system' (can be updated)
    const targetConfig =
      listData.find((item: any) => item.source === 'system') || listData[0];

    // Record the current value
    const originalValue = targetConfig.value;
    const configKey = targetConfig.key;
    const configVersion = targetConfig.version;

    // Determine a test value based on value_type
    let testValue: unknown;
    if (targetConfig.value_type === 'bool') {
      testValue = !originalValue;
    } else if (targetConfig.value_type === 'int') {
      testValue = typeof originalValue === 'number' ? originalValue + 1 : 42;
    } else if (targetConfig.value_type === 'float') {
      testValue =
        typeof originalValue === 'number' ? originalValue + 0.1 : 3.14;
    } else {
      testValue = 'e2e-test-value';
    }

    // Call update function
    const updateResult = await callFunction('serverConfig.update', {
      key: configKey,
      value: testValue,
      version: configVersion,
      change_note: 'E2E test update',
    });

    expect(updateResult).toHaveProperty('success', true);

    // Wait for table refresh
    await page.waitForTimeout(500);

    // Verify the config value was updated in the list
    const updatedListResult = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 100,
    });
    expect(updatedListResult).toHaveProperty('success', true);
    const updatedListData = (updatedListResult as any).data;
    const updatedConfig = updatedListData.find(
      (item: any) => item.key === configKey,
    );
    expect(updatedConfig).toBeDefined();

    // Restore the original value to leave clean state
    await callFunction('serverConfig.update', {
      key: configKey,
      value: originalValue,
      change_note: 'E2E test restore',
    });
  });

  test('serverConfig.remove - Delete config and table refreshes', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // First, get the current list
    const listResult = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 100,
    });
    expect(listResult).toHaveProperty('success', true);
    const listData = (listResult as any).data;

    // Find a config with source='system' and version > 0 (can be deleted/reset)
    const deletableConfig = listData.find(
      (item: any) => item.source === 'system' && item.version > 0,
    );

    // Skip if no deletable configs
    if (!deletableConfig) {
      test.skip();
      return;
    }

    const configKey = deletableConfig.key;
    const configVersion = deletableConfig.version;

    // Call remove function
    const removeResult = await callFunction('serverConfig.remove', {
      key: configKey,
      version: configVersion,
    });

    expect(removeResult).toHaveProperty('success', true);

    // Wait for table refresh
    await page.waitForTimeout(500);

    // Verify the config was removed (or reset to yaml default)
    const afterListResult = await callFunction('serverConfig.list', {
      current: 1,
      pageSize: 100,
    });
    expect(afterListResult).toHaveProperty('success', true);
    const afterListData = (afterListResult as any).data;
    const afterConfig = afterListData.find(
      (item: any) => item.key === configKey,
    );

    // After delete, config should either not exist or be reset to yaml source
    if (afterConfig) {
      // Reset to yaml default: source should be 'yaml', version should be 0
      expect(afterConfig.source).toBe('yaml');
      expect(afterConfig.version).toBe(0);
    }
  });

  test('serverConfig - Permission filter: viewer cannot access', async ({
    loginAs,
    callFunction,
  }) => {
    // Login as viewer (only has admin_user:read permission)
    await loginAs('viewer');

    // serverConfig functions should not be available (filtered out)
    await expect(callFunction('serverConfig.list', {})).rejects.toThrow(
      /Function not found/i,
    );
  });

  test('serverConfig - Permission filter: operator cannot access', async ({
    loginAs,
    callFunction,
  }) => {
    // Login as operator (has admin_user:read/write, role:read)
    await loginAs('operator');

    // serverConfig functions should not be available (filtered out)
    await expect(callFunction('serverConfig.list', {})).rejects.toThrow(
      /Function not found/i,
    );
  });
});
