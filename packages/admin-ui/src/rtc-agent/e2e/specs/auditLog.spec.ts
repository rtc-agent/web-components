import { expect, test } from '../fixtures/rtc-functions';

test.describe('auditLog Group - Audit Log Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Login and navigate to audit logs page
    await login();
    await page.goto('/system/audit-logs');
    await page.waitForLoadState('networkidle');
  });

  test('auditLog.list - Read table data (consistent with UI)', async ({
    callFunction,
  }) => {
    // Call function
    const result = await callFunction('auditLog.list', {
      current: 1,
      pageSize: 10,
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
  });

  test('auditLog.list - Pagination works', async ({ callFunction }) => {
    const result = await callFunction('auditLog.list', {
      current: 1,
      pageSize: 5,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // Page size should be at most 5
    expect(resultData.length).toBeLessThanOrEqual(5);
  });

  test('auditLog.list - Filter by event_type', async ({ callFunction }) => {
    const result = await callFunction('auditLog.list', {
      event_type: 'create_role',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // All returned items should have event_type = 'create_role'
    for (const item of resultData) {
      expect(item.event_type).toBe('create_role');
    }
  });

  test('auditLog.list - Filter by resource_type', async ({ callFunction }) => {
    const result = await callFunction('auditLog.list', {
      resource_type: 'role',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // All returned items should have resource_type = 'role'
    for (const item of resultData) {
      expect(item.resource_type).toBe('role');
    }
  });

  test('auditLog.list - Time range filter', async ({ callFunction }) => {
    const result = await callFunction('auditLog.list', {
      start_time: '2026-01-01T00:00:00Z',
      end_time: '2026-12-31T23:59:59Z',
    });

    expect(result).toHaveProperty('success', true);
  });

  test('auditLog.list - Data consistency with UI table', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    const result = await callFunction('auditLog.list', {
      current: 1,
      pageSize: 20,
    });

    expect(result).toHaveProperty('success', true);

    // Verify data count matches table rows
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    const resultData = (result as any).data;
    expect(resultData.length).toBe(tableRows);
  });
});
