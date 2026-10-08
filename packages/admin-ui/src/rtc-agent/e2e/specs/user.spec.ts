import { expect, test } from '../fixtures/rtc-functions';

test.describe('admin Group - Admin User Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to admin user management page
    await login();
    await page.goto('/system/users');
    await page.waitForLoadState('networkidle');
  });

  test('admin.list - Read table data (matches UI)', async ({
    page,
    callFunction,
  }) => {
    // Call function
    const result = await callFunction('admin.list', {
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
      const firstRowEmail = await page
        .locator('.ant-table-tbody tr:first-child td:nth-child(2)')
        .textContent();
      expect(resultData[0].email).toBe(firstRowEmail?.trim());
    }
  });

  test('admin.create - Create admin user and refresh table', async ({
    page,
    callFunction,
  }) => {
    // Record row count before creation
    const rowsBefore = await page.locator('.ant-table-tbody tr').count();

    // Call function
    const result = await callFunction('admin.create', {
      email: `test_user_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      name: 'Test Admin User',
    });

    expect(result).toHaveProperty('success', true);

    // Verify table has been refreshed (row count increased)
    await page.waitForTimeout(500); // Wait for refresh to complete
    const rowsAfter = await page.locator('.ant-table-tbody tr').count();
    expect(rowsAfter).toBe(rowsBefore + 1);

    // Verify new admin user appears in table
    const newUserVisible = await page
      .locator('text=Test Admin User')
      .isVisible();
    expect(newUserVisible).toBe(true);
  });

  test('admin.update - Update admin user and refresh table', async ({
    page,
    callFunction,
  }) => {
    // First create a user to update
    const createResult = await callFunction('admin.create', {
      email: `update_test_${Date.now()}@example.com`,
      password: 'TestPassword123!',
      name: 'Before Update',
    });

    expect(createResult).toHaveProperty('success', true);
    await page.waitForTimeout(500);

    // Find the created user and get ID
    const targetRow = await page.locator('tr', { hasText: 'Before Update' });
    const idCell = await targetRow.locator('td:first-child').textContent();
    const userId = idCell?.trim() || '';

    // Call function to update
    const result = await callFunction('admin.update', {
      id: userId,
      name: 'After Update',
    });

    expect(result).toHaveProperty('success', true);

    // Verify table has been refreshed
    await page.waitForTimeout(500);

    // Verify user name has been updated
    const updatedNameVisible = await page
      .locator('text=After Update')
      .isVisible();
    expect(updatedNameVisible).toBe(true);
  });

  test('admin.remove - Delete admin users (not yet implemented)', async ({
    callFunction,
  }) => {
    // Note: Delete API is not yet implemented in service layer
    // This test verifies the function returns success: false

    const result = await callFunction('admin.remove', {
      ids: ['non-existent-id'],
    });

    // Since delete is not implemented, expect success: false
    expect(result).toHaveProperty('success', false);
  });
});
