import { expect, test } from '../fixtures/rtc-functions';

// Mock data for RTC session list API
const MOCK_SESSIONS = [
  {
    id: 'sess_001',
    client_id: 'client_001',
    title: 'Debug authentication flow',
    status: 'active' as const,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-07T15:30:00Z',
    total_input_tokens: 50000,
    total_output_tokens: 20000,
    total_tokens: 70000,
    total_cached_read_tokens: 5000,
    total_cost_micros: 350000,
  },
  {
    id: 'sess_002',
    client_id: 'client_001',
    title: 'Refactor database layer',
    status: 'closed' as const,
    created_at: '2026-09-20T14:00:00Z',
    updated_at: '2026-09-25T09:00:00Z',
    total_input_tokens: 30000,
    total_output_tokens: 12000,
    total_tokens: 42000,
    total_cached_read_tokens: 3000,
    total_cost_micros: 210000,
  },
  {
    id: 'sess_003',
    client_id: 'client_002',
    title: 'Implement user profile page',
    status: 'active' as const,
    created_at: '2026-10-05T08:00:00Z',
    updated_at: '2026-10-07T12:00:00Z',
    total_input_tokens: 25000,
    total_output_tokens: 10000,
    total_tokens: 35000,
    total_cached_read_tokens: 2000,
    total_cost_micros: 175000,
  },
];

/**
 * Helper: Set up API route mocks for session endpoints.
 * Must be called before navigating to the page.
 */
async function setupSessionApiMocks(page: any) {
  // Mock session list API
  await page.route('**/api/rtc-users/sessions*', async (route: any) => {
    const url = route.request().url();
    const requestUrl = new URL(url);
    const userId = requestUrl.searchParams.get('user_id') || '';
    const status = requestUrl.searchParams.get('status') || '';
    const search = requestUrl.searchParams.get('search') || '';
    const startTime = requestUrl.searchParams.get('start_time') || '';
    const endTime = requestUrl.searchParams.get('end_time') || '';
    const pageNum = Number(requestUrl.searchParams.get('page') || '1');
    const pageSize = Number(requestUrl.searchParams.get('page_size') || '10');
    const sortBy = requestUrl.searchParams.get('sort_by') || '';
    const sortOrder = requestUrl.searchParams.get('sort_order') || 'desc';

    // If no user_id, return empty (sessions require a user)
    if (!userId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          total: 0,
          page: pageNum,
          page_size: pageSize,
        }),
      });
      return;
    }

    let filtered = [...MOCK_SESSIONS];

    if (status) {
      filtered = filtered.filter((s) => s.status === status);
    }

    if (search) {
      const lowerSearch = search.toLowerCase();
      filtered = filtered.filter((s) =>
        s.title.toLowerCase().includes(lowerSearch),
      );
    }

    if (startTime) {
      filtered = filtered.filter((s) => s.created_at >= startTime);
    }

    if (endTime) {
      filtered = filtered.filter((s) => s.created_at <= endTime);
    }

    // Sorting
    if (sortBy) {
      filtered.sort((a, b) => {
        const aVal = (a as any)[sortBy];
        const bVal = (b as any)[sortBy];
        if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      });
    }

    const start = (pageNum - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: paged,
        total: filtered.length,
        page: pageNum,
        page_size: pageSize,
      }),
    });
  });
}

test.describe('rtcSession Group - RTC Session Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Set up API mocks before login/navigation
    await setupSessionApiMocks(page);

    // Login and navigate to sessions page with a user_id
    await login();
    await page.goto('/rtc-users/sessions?user_id=usr_001');
    await page.waitForLoadState('networkidle');
  });

  // ==================== list ====================

  test('rtcSession.list - Query session list with pagination (matches UI)', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call function
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
    });

    // Verify return value structure
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');

    // Verify data is an array
    const resultData = (result as any).data;
    expect(Array.isArray(resultData)).toBe(true);

    // Verify total matches
    expect((result as any).total).toBe(MOCK_SESSIONS.length);

    // Verify data matches UI table
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    expect(resultData.length).toBe(tableRows);
  });

  test('rtcSession.list - Data items have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Each item should have the required fields
    for (const item of resultData) {
      expect(item).toHaveProperty('id');
      expect(typeof item.id).toBe('string');
      expect(item).toHaveProperty('client_id');
      expect(typeof item.client_id).toBe('string');
      expect(item).toHaveProperty('title');
      expect(typeof item.title).toBe('string');
      expect(item).toHaveProperty('status');
      expect(['active', 'closed']).toContain(item.status);
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('updated_at');
      expect(item).toHaveProperty('total_tokens');
      expect(typeof item.total_tokens).toBe('number');
      expect(item).toHaveProperty('total_input_tokens');
      expect(typeof item.total_input_tokens).toBe('number');
      expect(item).toHaveProperty('total_output_tokens');
      expect(typeof item.total_output_tokens).toBe('number');
      expect(item).toHaveProperty('total_cached_read_tokens');
      expect(typeof item.total_cached_read_tokens).toBe('number');
      expect(item).toHaveProperty('total_cost_micros');
      expect(typeof item.total_cost_micros).toBe('number');
    }
  });

  test('rtcSession.list - Filter by status (active)', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      status: 'active',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All returned items should have status = 'active'
    for (const item of resultData) {
      expect(item.status).toBe('active');
    }

    // Should have 2 active sessions from mock data
    expect(resultData.length).toBe(2);
  });

  test('rtcSession.list - Filter by status (closed)', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      status: 'closed',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All returned items should have status = 'closed'
    for (const item of resultData) {
      expect(item.status).toBe('closed');
    }

    // Should have 1 closed session from mock data
    expect(resultData.length).toBe(1);
  });

  test('rtcSession.list - Search by title keyword', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      search: 'authentication',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Should find the session with "authentication" in title
    expect(resultData.length).toBe(1);
    expect(resultData[0].title).toBe('Debug authentication flow');
  });

  test('rtcSession.list - Pagination limits page size', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 2,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Page size should be at most 2
    expect(resultData.length).toBeLessThanOrEqual(2);
    // Total should still reflect full count
    expect((result as any).total).toBe(MOCK_SESSIONS.length);
  });

  test('rtcSession.list - Sort by total_tokens ascending', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      sortBy: 'total_tokens',
      sortOrder: 'asc',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Verify ascending order
    for (let i = 1; i < resultData.length; i++) {
      expect(resultData[i].total_tokens).toBeGreaterThanOrEqual(
        resultData[i - 1].total_tokens,
      );
    }
  });

  test('rtcSession.list - Time range filter', async ({ callFunction }) => {
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      startTime: '2026-10-01T00:00:00Z',
      endTime: '2026-10-06T23:59:59Z',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All sessions should be within the time range
    for (const item of resultData) {
      expect(item.created_at >= '2026-10-01T00:00:00Z').toBe(true);
      expect(item.created_at <= '2026-10-06T23:59:59Z').toBe(true);
    }
  });

  test('rtcSession.list - Missing userId throws error', async ({
    callFunction,
  }) => {
    // userId is required for sessions
    await expect(
      callFunction('rtcSession.list', {
        current: 1,
        pageSize: 10,
      }),
    ).rejects.toThrow(/userId is required/i);
  });

  // ==================== Permission filtering ====================

  test('rtcSession - Permission filter: viewer cannot access', async ({
    loginAs,
    callFunction,
  }) => {
    // Login as viewer (only has admin_user:read permission)
    await loginAs('viewer');

    // rtcSession functions should not be available (filtered out)
    await expect(
      callFunction('rtcSession.list', { userId: 'usr_001' }),
    ).rejects.toThrow(/Function not found/i);
  });

  test('rtcSession - Permission filter: operator can list (has rtc_session:read)', async ({
    page,
    loginAs,
    callFunction,
  }) => {
    // Set up API mocks for the new page context
    await setupSessionApiMocks(page);

    // Login as operator (has rtc_session:read)
    await loginAs('operator');
    await page.goto('/rtc-users/sessions?user_id=usr_001');
    await page.waitForLoadState('networkidle');

    // Operator should be able to call list (has rtc_session:read)
    const listResult = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
    });
    expect(listResult).toHaveProperty('success', true);
    expect((listResult as any).total).toBe(MOCK_SESSIONS.length);
  });

  // ==================== URL and data consistency ====================

  test('rtcSession.list - URL syncs with query params', async ({
    page,
    callFunction,
  }) => {
    // Call list with filters
    await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      status: 'active',
      search: 'debug',
    });

    // Verify URL contains the query params
    const url = page.url();
    expect(url).toContain('user_id=usr_001');
    expect(url).toContain('status=active');
    expect(url).toContain('search=debug');
  });

  test('rtcSession.list - Data matches UI after filter', async ({
    page,
    callFunction,
  }) => {
    // Wait for initial load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call list with status filter
    const result = await callFunction('rtcSession.list', {
      userId: 'usr_001',
      current: 1,
      pageSize: 10,
      status: 'active',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Wait for table to update
    await page.waitForTimeout(500);

    // Verify table row count matches
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    expect(resultData.length).toBe(tableRows);
  });

  // ==================== Search form backfill ====================

  test('rtcSession - Search form reflects URL params on initial navigation', async ({
    page,
  }) => {
    // Navigate with query params
    await page.goto(
      '/rtc-users/sessions?user_id=usr_001&status=active&search=debug',
    );
    await page.waitForLoadState('networkidle');

    // Verify form fields are populated from URL
    const userIdInput = page.locator(
      'input[id="user_id"], input[name="user_id"]',
    );
    await expect(userIdInput).toHaveValue('usr_001');

    // Status select should reflect the URL param
    const statusSelect = page.locator(
      '.ant-select input[id="status"], .ant-select input[name="status"]',
    );
    // The select input may show the label text
    const statusValue = await statusSelect.inputValue();
    expect(statusValue).toBeTruthy();
  });

  test('rtcSession - URL updates after search form submit', async ({
    page,
  }) => {
    // Navigate to sessions page
    await page.goto('/rtc-users/sessions?user_id=usr_001');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Type in search field and submit
    const searchInput = page.locator(
      'input[id="search"], input[name="search"]',
    );
    await searchInput.fill('authentication');

    // Click the submit button
    const submitBtn = page.locator(
      'button[type="submit"], .ant-pro-table-search button.ant-btn-primary',
    );
    await submitBtn.click();

    // Wait for navigation
    await page.waitForTimeout(500);

    // Verify URL contains search param
    const url = page.url();
    expect(url).toContain('search=authentication');
  });

  test('rtcSession - Clearing form removes URL params', async ({ page }) => {
    // Navigate with filters
    await page.goto(
      '/rtc-users/sessions?user_id=usr_001&status=active&search=debug',
    );
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Click the reset button
    const resetBtn = page.locator(
      '.ant-pro-table-search button:has-text("Reset"), .ant-pro-table-search button:has-text("重置")',
    );
    await resetBtn.click();

    // Wait for navigation
    await page.waitForTimeout(500);

    // Verify URL no longer contains status/search params
    const url = page.url();
    expect(url).toContain('user_id=usr_001');
    expect(url).not.toContain('status=active');
    expect(url).not.toContain('search=debug');
  });
});
