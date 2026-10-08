import { expect, test } from '../fixtures/rtc-functions';

test.describe('role Group - Admin Role Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to admin role list page
    await login();
    await page.goto('/system/roles');
    await page.waitForLoadState('networkidle');
  });

  test('role.list - Read table data (matches UI)', async ({
    page,
    callFunction,
  }) => {
    // Call function
    const result = await callFunction('role.list', {
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

    // Verify first row data
    if (resultData.length > 0) {
      const firstRowName = await page
        .locator('.ant-table-tbody tr:first-child td:nth-child(2)')
        .textContent();
      expect(resultData[0].name).toBe(firstRowName?.trim());
    }
  });

  test('role.create - Create admin role and refresh table', async ({
    page,
    callFunction,
  }) => {
    // Record row count before creation
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // Call function
    const result = await callFunction('role.create', {
      name: 'test_role',
      display_name: 'Test Admin Role',
      description: 'Admin role created by E2E test',
    });

    expect(result).toHaveProperty('success', true);

    // Verify table has been refreshed (row count increased)
    await page.waitForTimeout(500); // Wait for refresh to complete
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore + 1);

    // Verify new admin role appears in table
    const newRoleVisible = await page
      .locator('text=Test Admin Role')
      .isVisible();
    expect(newRoleVisible).toBe(true);
  });

  test('role.remove - Delete admin role and refresh table', async ({
    page,
    callFunction,
  }) => {
    // First create an admin role
    await callFunction('role.create', {
      name: 'test_delete_role',
      display_name: 'Role To Delete',
      description: 'Will be deleted',
    });

    // Record current row count
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // Find the newly created admin role
    const targetRow = await page.locator('tr', { hasText: 'Role To Delete' });
    const idCell = await targetRow.locator('td:first-child').textContent();
    const roleId = idCell?.trim() || '';

    // Call function to delete
    const result = await callFunction('role.remove', {
      ids: [roleId],
    });

    expect(result).toHaveProperty('success', true);

    // Verify table has been refreshed (row count decreased)
    await page.waitForTimeout(500);
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore - 1);

    // Verify admin role has disappeared from table
    const roleStillVisible = await page
      .locator('text=Role To Delete')
      .isVisible();
    expect(roleStillVisible).toBe(false);
  });
});
