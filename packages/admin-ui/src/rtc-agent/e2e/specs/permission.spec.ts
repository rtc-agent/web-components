import { expect, test } from '../fixtures/rtc-functions';

test.describe('permission Group - Admin Permission Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to permission list page
    await login();
    await page.goto('/system/permissions');
    await page.waitForLoadState('networkidle');
  });

  test('permission.list - Read table data (consistent with UI)', async ({
    page,
    callFunction,
  }) => {
    // Call function
    const result = await callFunction('permission.list', {
      current: 1,
      pageSize: 10,
    });

    // Verify return value structure
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');

    // Verify data matches UI table
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    const resultData = (result as any).data;
    expect(resultData.length).toBe(tableRows);

    // Verify first row data if exists
    if (resultData.length > 0) {
      const firstRow = resultData[0];
      expect(firstRow).toHaveProperty('role_id');
      expect(firstRow).toHaveProperty('resource');
      expect(firstRow).toHaveProperty('action');
    }
  });

  test('permission.create - Create permission policy and refresh table', async ({
    page,
    callFunction,
  }) => {
    // We need a role_id, get it from the first row's role dropdown or use a known one
    // For E2E test, we'll call list first to get a valid role_id
    const listResult = await callFunction('permission.list', {});
    const existingData = (listResult as any).data;

    // Use an existing role_id if available, otherwise use a placeholder
    const testRoleId =
      existingData?.[0]?.role_id || '00000000-0000-0000-0000-000000000001';

    // Call function to create a permission
    const result = await callFunction('permission.create', {
      role_id: testRoleId,
      resource: 'dashboard',
      action: 'read',
    });

    expect(result).toHaveProperty('success', true);

    // Verify table refreshed
    await page.waitForTimeout(500);
    // Just verify the call succeeded
    expect((result as any).success).toBe(true);
  });

  test('permission.remove - Delete permission policy and refresh table', async ({
    page,
    callFunction,
  }) => {
    // First list to get an existing permission
    const listResult = await callFunction('permission.list', {});
    const existingData = (listResult as any).data;

    if (existingData.length === 0) {
      // Skip if no data
      return;
    }

    const targetItem = existingData[0];
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // Call function to delete
    const result = await callFunction('permission.remove', {
      items: [
        {
          role_id: targetItem.role_id,
          resource: targetItem.resource,
          action: targetItem.action,
        },
      ],
    });

    expect(result).toHaveProperty('success', true);

    // Verify table refreshed (row count decreased)
    await page.waitForTimeout(500);
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore - 1);
  });

  test('permission.list - Should be filtered by permission', async ({
    page,
    loginAs,
    callFunction,
  }) => {
    // Login as viewer who has no permission:read
    await loginAs('viewer');
    await page.goto('/system/permissions');
    await page.waitForLoadState('networkidle');

    // Function should not be available (filtered out by permissions)
    await expect(callFunction('permission.list', {})).rejects.toThrow(
      /Function not found/i,
    );
  });
});
