import { expect, test } from '../fixtures/rtc-functions';

// Mock data for RTC message list API
const MOCK_MESSAGES = [
  {
    id: 'msg_001',
    session_id: 'sess_001',
    role: 'user' as const,
    content: '{"type":"user_message","data":{"text":"Hello, how are you?"}}',
    created_at: '2026-10-01T10:00:00Z',
    global_offset: 0,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  },
  {
    id: 'msg_002',
    session_id: 'sess_001',
    role: 'assistant' as const,
    content: '{"type":"text","data":"I\'m doing great, thanks for asking!"}',
    created_at: '2026-10-01T10:00:05Z',
    global_offset: 1,
    input_tokens: 150,
    output_tokens: 50,
    total_tokens: 200,
  },
  {
    id: 'msg_003',
    session_id: 'sess_001',
    role: 'user' as const,
    content: '{"type":"user_message","data":{"text":"Can you help me debug?"}}',
    created_at: '2026-10-01T10:01:00Z',
    global_offset: 2,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  },
  {
    id: 'msg_004',
    session_id: 'sess_001',
    role: 'assistant' as const,
    content: '{"type":"thinking","data":"Let me analyze the problem..."}',
    created_at: '2026-10-01T10:01:05Z',
    global_offset: 3,
    input_tokens: 300,
    output_tokens: 100,
    total_tokens: 400,
  },
  {
    id: 'msg_005',
    session_id: 'sess_002',
    role: 'user' as const,
    content: '{"type":"user_message","data":{"text":"Another session msg"}}',
    created_at: '2026-10-02T08:00:00Z',
    global_offset: 0,
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
  },
];

/**
 * Helper: Set up API route mocks for message endpoints.
 * Must be called before navigating to the page.
 */
async function setupMessageApiMocks(page: any) {
  // Mock message list API: /api/rtc-users/sessions/:session_id/messages
  await page.route(
    '**/api/rtc-users/sessions/*/messages*',
    async (route: any) => {
      const url = route.request().url();
      const requestUrl = new URL(url);
      const role = requestUrl.searchParams.get('role') || '';
      const createdAfter = requestUrl.searchParams.get('created_after') || '';
      const createdBefore = requestUrl.searchParams.get('created_before') || '';
      const page = Number(requestUrl.searchParams.get('page') || '1');
      const pageSize = Number(requestUrl.searchParams.get('page_size') || '10');
      const sortBy = requestUrl.searchParams.get('sort_by') || '';
      const sortOrder = requestUrl.searchParams.get('sort_order') || 'desc';

      // Extract session_id from URL path
      const urlPath = requestUrl.pathname;
      const sessionMatch = urlPath.match(
        /\/api\/rtc-users\/sessions\/([^/]+)\/messages/,
      );
      const sessionId = sessionMatch ? sessionMatch[1] : '';

      if (!sessionId) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [],
            total: 0,
            page,
            page_size: pageSize,
          }),
        });
        return;
      }

      let filtered = MOCK_MESSAGES.filter((m) => m.session_id === sessionId);

      if (role) {
        filtered = filtered.filter((m) => m.role === role);
      }

      if (createdAfter) {
        filtered = filtered.filter((m) => m.created_at >= createdAfter);
      }

      if (createdBefore) {
        filtered = filtered.filter((m) => m.created_at <= createdBefore);
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

      const start = (page - 1) * pageSize;
      const paged = filtered.slice(start, start + pageSize);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: paged,
          total: filtered.length,
          page,
          page_size: pageSize,
        }),
      });
    },
  );
}

test.describe('rtcMessage Group - RTC Message Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Set up API mocks before login/navigation
    await setupMessageApiMocks(page);

    // Login and navigate to messages page with a session_id
    await login();
    await page.goto('/rtc-users/messages?session_id=sess_001');
    await page.waitForLoadState('networkidle');
  });

  // ==================== list ====================

  test('rtcMessage.list - Query message list with pagination (matches UI)', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call function
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
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

    // Verify total matches (sess_001 has 4 messages)
    expect((result as any).total).toBe(4);

    // Verify data matches UI table
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    expect(resultData.length).toBe(tableRows);
  });

  test('rtcMessage.list - Data items have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Each item should have the required fields
    for (const item of resultData) {
      expect(item).toHaveProperty('id');
      expect(typeof item.id).toBe('string');
      expect(item).toHaveProperty('session_id');
      expect(typeof item.session_id).toBe('string');
      expect(item).toHaveProperty('role');
      expect(['user', 'assistant']).toContain(item.role);
      expect(item).toHaveProperty('content');
      expect(typeof item.content).toBe('string');
      expect(item).toHaveProperty('created_at');
      expect(typeof item.created_at).toBe('string');
      expect(item).toHaveProperty('global_offset');
      expect(typeof item.global_offset).toBe('number');
    }
  });

  test('rtcMessage.list - Filter by role (user)', async ({ callFunction }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      role: 'user',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All returned items should have role = 'user'
    for (const item of resultData) {
      expect(item.role).toBe('user');
    }

    // Should have 2 user messages from mock data for sess_001
    expect(resultData.length).toBe(2);
  });

  test('rtcMessage.list - Filter by role (assistant)', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      role: 'assistant',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All returned items should have role = 'assistant'
    for (const item of resultData) {
      expect(item.role).toBe('assistant');
    }

    // Should have 2 assistant messages from mock data for sess_001
    expect(resultData.length).toBe(2);
  });

  test('rtcMessage.list - Pagination limits page size', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 2,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Page size should be at most 2
    expect(resultData.length).toBeLessThanOrEqual(2);
    // Total should still reflect full count
    expect((result as any).total).toBe(4);
  });

  test('rtcMessage.list - Sort by created_at ascending', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      sortBy: 'created_at',
      sortOrder: 'asc',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Verify ascending order
    for (let i = 1; i < resultData.length; i++) {
      expect(resultData[i].created_at).toBeGreaterThanOrEqual(
        resultData[i - 1].created_at,
      );
    }
  });

  test('rtcMessage.list - Time range filter', async ({ callFunction }) => {
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      startTime: '2026-10-01T10:00:00Z',
      endTime: '2026-10-01T10:00:05Z',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All messages should be within the time range
    for (const item of resultData) {
      expect(item.created_at >= '2026-10-01T10:00:00Z').toBe(true);
      expect(item.created_at <= '2026-10-01T10:00:05Z').toBe(true);
    }
  });

  test('rtcMessage.list - Missing sessionId throws error', async ({
    callFunction,
  }) => {
    // sessionId is required for messages
    await expect(
      callFunction('rtcMessage.list', {
        current: 1,
        pageSize: 10,
      }),
    ).rejects.toThrow(/sessionId is required/i);
  });

  // ==================== Permission filtering ====================

  test('rtcMessage - Permission filter: viewer cannot access', async ({
    loginAs,
    callFunction,
  }) => {
    // Login as viewer (only has admin_user:read permission)
    await loginAs('viewer');

    // rtcMessage functions should not be available (filtered out)
    await expect(
      callFunction('rtcMessage.list', { sessionId: 'sess_001' }),
    ).rejects.toThrow(/Function not found/i);
  });

  test('rtcMessage - Permission filter: operator can list (has rtc_message:read)', async ({
    page,
    loginAs,
    callFunction,
  }) => {
    // Set up API mocks for the new page context
    await setupMessageApiMocks(page);

    // Login as operator (has rtc_message:read)
    await loginAs('operator');
    await page.goto('/rtc-users/messages?session_id=sess_001');
    await page.waitForLoadState('networkidle');

    // Operator should be able to call list (has rtc_message:read)
    const listResult = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
    });
    expect(listResult).toHaveProperty('success', true);
    expect((listResult as any).total).toBe(4);
  });

  // ==================== URL and data consistency ====================

  test('rtcMessage.list - URL syncs with query params', async ({
    page,
    callFunction,
  }) => {
    // Call list with filters
    await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      role: 'user',
    });

    // Verify URL contains the query params
    const url = page.url();
    expect(url).toContain('session_id=sess_001');
    expect(url).toContain('role=user');
  });

  test('rtcMessage.list - Data matches UI after filter', async ({
    page,
    callFunction,
  }) => {
    // Wait for initial load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call list with role filter
    const result = await callFunction('rtcMessage.list', {
      sessionId: 'sess_001',
      current: 1,
      pageSize: 10,
      role: 'user',
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

  test('rtcMessage - Search form backfills URL params on initial navigation', async ({
    page,
  }) => {
    // Navigate with URL params
    await page.goto('/rtc-users/messages?session_id=sess_001&role=assistant');
    await page.waitForLoadState('networkidle');

    // Wait for form to load
    await page.waitForTimeout(500);

    // Verify form fields are backfilled from URL
    const sessionIdInput = page.locator('input[id="session_id"]');
    const roleSelect = page.locator('.ant-select-selector').filter({
      hasText: /assistant/i,
    });

    await expect(sessionIdInput).toHaveValue('sess_001');
    await expect(roleSelect).toBeVisible();
  });

  test('rtcMessage - Form submission updates URL', async ({
    page,
  }) => {
    // Navigate to page with session_id
    await page.goto('/rtc-users/messages?session_id=sess_001');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Fill in role filter
    const roleSelect = page.locator('#role');
    await roleSelect.click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'User' }).click();

    // Submit form
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(500);

    // Verify URL is updated
    const url = page.url();
    expect(url).toContain('session_id=sess_001');
    expect(url).toContain('role=user');
  });

  test('rtcMessage - Clearing form removes URL params', async ({
    page,
  }) => {
    // Navigate with URL params
    await page.goto('/rtc-users/messages?session_id=sess_001&role=user');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Clear role filter
    const roleSelect = page.locator('#role');
    await roleSelect.click();
    await page.locator('.ant-select-item-option').filter({ hasText: 'User' }).click();

    // Submit form
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(500);

    // Verify role param is removed from URL
    const url = page.url();
    expect(url).toContain('session_id=sess_001');
    expect(url).not.toContain('role=user');
  });
});
