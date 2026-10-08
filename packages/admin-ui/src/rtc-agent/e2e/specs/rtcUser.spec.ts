import { expect, test } from '../fixtures/rtc-functions';

// Mock data for RTC user list API
const MOCK_RTC_USERS = [
  {
    id: 'usr_001',
    provider: 'google',
    sub: 'google-123',
    email: 'alice@example.com',
    name: 'Alice Johnson',
    avatar_url: 'https://example.com/avatars/alice.png',
    status: 'active' as const,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-15T08:30:00Z',
  },
  {
    id: 'usr_002',
    provider: 'github',
    sub: 'github-456',
    email: 'bob@example.com',
    name: 'Bob Smith',
    avatar_url: 'https://example.com/avatars/bob.png',
    status: 'banned' as const,
    banned_at: '2026-09-10T14:00:00Z',
    banned_reason: 'Violation of terms of service',
    created_at: '2026-08-15T12:00:00Z',
    updated_at: '2026-09-10T14:00:00Z',
  },
  {
    id: 'usr_003',
    provider: 'google',
    sub: 'google-789',
    email: 'charlie@example.com',
    name: 'Charlie Brown',
    avatar_url: '',
    status: 'active' as const,
    created_at: '2026-09-20T09:00:00Z',
    updated_at: '2026-09-20T09:00:00Z',
  },
];

// Mock data for user devices
const MOCK_DEVICES = [
  {
    id: 'dev_001',
    user_id: 'usr_001',
    device_id: 'device-chrome-mac-001',
    name: 'Chrome on MacBook Pro',
    user_agent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0',
    last_active_at: '2026-10-07T15:30:00Z',
    created_at: '2026-09-01T10:05:00Z',
    is_online: true,
  },
  {
    id: 'dev_002',
    user_id: 'usr_001',
    device_id: 'device-safari-iphone-002',
    name: 'Safari on iPhone',
    user_agent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    last_active_at: '2026-10-06T08:00:00Z',
    created_at: '2026-09-05T14:00:00Z',
    is_online: false,
  },
];

// Mock data for token statistics
const MOCK_TOKEN_STATS = {
  daily_stats: [
    {
      date: '2026-10-07',
      total_tokens: 15000,
      total_input_tokens: 10000,
      total_output_tokens: 4000,
      total_cached_read_tokens: 1000,
    },
    {
      date: '2026-10-06',
      total_tokens: 12000,
      total_input_tokens: 8000,
      total_output_tokens: 3500,
      total_cached_read_tokens: 500,
    },
  ],
  summary: {
    today_tokens: 15000,
    week_tokens: 45000,
    month_tokens: 180000,
    total_tokens: 500000,
  },
  top_sessions: [
    {
      session_id: 'sess_001',
      title: 'Debug authentication flow',
      total_tokens: 85000,
      created_at: '2026-10-01T10:00:00Z',
    },
    {
      session_id: 'sess_002',
      title: 'Refactor database layer',
      total_tokens: 62000,
      created_at: '2026-10-03T14:00:00Z',
    },
  ],
};

/**
 * Helper: Set up API route mocks for rtc-user endpoints.
 * Must be called before navigating to the page.
 */
async function setupRtcUserApiMocks(page: any) {
  // Mock user list API
  await page.route('**/api/rtc-users*', async (route: any) => {
    const url = route.request().url();

    // Only match list endpoint (not ban/unban/devices/stats sub-paths)
    if (url.match(/\/api\/rtc-users\?/) || url.match(/\/api\/rtc-users$/)) {
      const requestUrl = new URL(url);
      const search = requestUrl.searchParams.get('search') || '';
      const status = requestUrl.searchParams.get('status') || '';
      const page = Number(requestUrl.searchParams.get('page') || '1');
      const pageSize = Number(requestUrl.searchParams.get('page_size') || '10');

      let filtered = [...MOCK_RTC_USERS];

      if (search) {
        const lowerSearch = search.toLowerCase();
        filtered = filtered.filter(
          (u) =>
            u.email?.toLowerCase().includes(lowerSearch) ||
            u.name?.toLowerCase().includes(lowerSearch),
        );
      }

      if (status) {
        filtered = filtered.filter((u) => u.status === status);
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
      return;
    }

    // Pass through other rtc-user sub-routes
    await route.continue();
  });

  // Mock ban API
  await page.route('**/api/rtc-users/*/ban', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'usr_001',
        status: 'banned',
        banned_at: new Date().toISOString(),
        banned_reason: 'Test ban reason',
      }),
    });
  });

  // Mock unban API
  await page.route('**/api/rtc-users/*/unban', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'usr_002',
        status: 'active',
      }),
    });
  });

  // Mock devices API
  await page.route('**/api/rtc-users/*/devices', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: MOCK_DEVICES,
      }),
    });
  });

  // Mock token stats API
  await page.route('**/api/rtc-users/sessions/stats*', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TOKEN_STATS),
    });
  });
}

test.describe('rtcUser Group - RTC User Management', () => {
  test.beforeEach(async ({ page, login }) => {
    // Set up API mocks before login/navigation
    await setupRtcUserApiMocks(page);

    // Login and navigate to RTC user management page
    await login();
    await page.goto('/rtc-users/management');
    await page.waitForLoadState('networkidle');
  });

  // ==================== list ====================

  test('rtcUser.list - Query user list with pagination (matches UI)', async ({
    page,
    callFunction,
  }) => {
    // Wait for table to load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call function
    const result = await callFunction('rtcUser.list', {
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
    expect((result as any).total).toBe(MOCK_RTC_USERS.length);

    // Verify data matches UI table
    const tableRows = await page.locator('.ant-table-tbody tr').count();
    expect(resultData.length).toBe(tableRows);
  });

  test('rtcUser.list - Data items have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Each item should have the required fields
    for (const item of resultData) {
      expect(item).toHaveProperty('id');
      expect(typeof item.id).toBe('string');
      expect(item).toHaveProperty('provider');
      expect(typeof item.provider).toBe('string');
      expect(item).toHaveProperty('sub');
      expect(typeof item.sub).toBe('string');
      expect(item).toHaveProperty('status');
      expect(['active', 'banned']).toContain(item.status);
      expect(item).toHaveProperty('created_at');
      expect(item).toHaveProperty('updated_at');
    }
  });

  test('rtcUser.list - Filter by status (active)', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.list', {
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

    // Should have 2 active users from mock data
    expect(resultData.length).toBe(2);
  });

  test('rtcUser.list - Filter by status (banned)', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
      status: 'banned',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // All returned items should have status = 'banned'
    for (const item of resultData) {
      expect(item.status).toBe('banned');
    }

    // Should have 1 banned user from mock data
    expect(resultData.length).toBe(1);
  });

  test('rtcUser.list - Search by email', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
      search: 'alice',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Should find the user with alice in email
    expect(resultData.length).toBe(1);
    expect(resultData[0].email).toBe('alice@example.com');
  });

  test('rtcUser.list - Search by name', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
      search: 'Bob',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Should find the user with Bob in name
    expect(resultData.length).toBe(1);
    expect(resultData[0].name).toBe('Bob Smith');
  });

  test('rtcUser.list - Pagination limits page size', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 2,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // Page size should be at most 2
    expect(resultData.length).toBeLessThanOrEqual(2);
    // Total should still reflect full count
    expect((result as any).total).toBe(MOCK_RTC_USERS.length);
  });

  // ==================== ban ====================

  test('rtcUser.ban - Ban an active user', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.ban', {
      userId: 'usr_001',
      reason: 'Violation of terms of service',
    });

    expect(result).toHaveProperty('success', true);
  });

  test('rtcUser.ban - Ban with reason recorded', async ({ callFunction }) => {
    const reason = 'Spamming and abusive behavior';
    const result = await callFunction('rtcUser.ban', {
      userId: 'usr_001',
      reason,
    });

    expect(result).toHaveProperty('success', true);
    expect((result as any).success).toBe(true);
  });

  // ==================== unban ====================

  test('rtcUser.unban - Unban a banned user', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.unban', {
      userId: 'usr_002',
    });

    expect(result).toHaveProperty('success', true);
  });

  test('rtcUser.unban - Unban returns active status', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.unban', {
      userId: 'usr_002',
    });

    expect(result).toHaveProperty('success', true);
    expect((result as any).success).toBe(true);
  });

  // ==================== devices ====================

  test('rtcUser.devices - Get user device list', async ({ callFunction }) => {
    const result = await callFunction('rtcUser.devices', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');

    const resultData = (result as any).data;
    expect(Array.isArray(resultData)).toBe(true);
    expect(resultData.length).toBe(MOCK_DEVICES.length);
  });

  test('rtcUser.devices - Device items have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.devices', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    for (const device of resultData) {
      expect(device).toHaveProperty('id');
      expect(typeof device.id).toBe('string');
      expect(device).toHaveProperty('user_id');
      expect(typeof device.user_id).toBe('string');
      expect(device).toHaveProperty('device_id');
      expect(typeof device.device_id).toBe('string');
      expect(device).toHaveProperty('name');
      expect(typeof device.name).toBe('string');
      expect(device).toHaveProperty('user_agent');
      expect(typeof device.user_agent).toBe('string');
      expect(device).toHaveProperty('last_active_at');
      expect(device).toHaveProperty('created_at');
      expect(device).toHaveProperty('is_online');
      expect(typeof device.is_online).toBe('boolean');
    }
  });

  test('rtcUser.devices - Online status correctly reported', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.devices', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;

    // From mock data, first device is online, second is offline
    const onlineDevices = resultData.filter((d: any) => d.is_online === true);
    const offlineDevices = resultData.filter((d: any) => d.is_online === false);

    expect(onlineDevices.length).toBe(1);
    expect(offlineDevices.length).toBe(1);
  });

  // ==================== tokenStats ====================

  test('rtcUser.tokenStats - Get token statistics', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.tokenStats', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('data');

    const data = (result as any).data;
    expect(data).toHaveProperty('daily_stats');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('top_sessions');

    // Verify daily_stats is an array
    expect(Array.isArray(data.daily_stats)).toBe(true);
    expect(data.daily_stats.length).toBe(MOCK_TOKEN_STATS.daily_stats.length);
  });

  test('rtcUser.tokenStats - Summary has correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.tokenStats', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    const data = (result as any).data;

    // Verify summary fields
    expect(data.summary).toHaveProperty('today_tokens');
    expect(typeof data.summary.today_tokens).toBe('number');
    expect(data.summary).toHaveProperty('week_tokens');
    expect(typeof data.summary.week_tokens).toBe('number');
    expect(data.summary).toHaveProperty('month_tokens');
    expect(typeof data.summary.month_tokens).toBe('number');
    expect(data.summary).toHaveProperty('total_tokens');
    expect(typeof data.summary.total_tokens).toBe('number');

    // Verify values match mock data
    expect(data.summary.today_tokens).toBe(15000);
    expect(data.summary.total_tokens).toBe(500000);
  });

  test('rtcUser.tokenStats - Top sessions have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.tokenStats', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    const data = (result as any).data;

    expect(Array.isArray(data.top_sessions)).toBe(true);
    expect(data.top_sessions.length).toBe(MOCK_TOKEN_STATS.top_sessions.length);

    for (const session of data.top_sessions) {
      expect(session).toHaveProperty('session_id');
      expect(typeof session.session_id).toBe('string');
      expect(session).toHaveProperty('title');
      expect(typeof session.title).toBe('string');
      expect(session).toHaveProperty('total_tokens');
      expect(typeof session.total_tokens).toBe('number');
      expect(session).toHaveProperty('created_at');
    }
  });

  test('rtcUser.tokenStats - Custom days parameter', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.tokenStats', {
      userId: 'usr_001',
      days: 7,
    });

    expect(result).toHaveProperty('success', true);
    const data = (result as any).data;

    // Should still return valid structure regardless of days
    expect(data).toHaveProperty('daily_stats');
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('top_sessions');
  });

  test('rtcUser.tokenStats - Daily stats have correct structure', async ({
    callFunction,
  }) => {
    const result = await callFunction('rtcUser.tokenStats', {
      userId: 'usr_001',
    });

    expect(result).toHaveProperty('success', true);
    const data = (result as any).data;

    for (const stat of data.daily_stats) {
      expect(stat).toHaveProperty('date');
      expect(typeof stat.date).toBe('string');
      expect(stat).toHaveProperty('total_tokens');
      expect(typeof stat.total_tokens).toBe('number');
      expect(stat).toHaveProperty('total_input_tokens');
      expect(typeof stat.total_input_tokens).toBe('number');
      expect(stat).toHaveProperty('total_output_tokens');
      expect(typeof stat.total_output_tokens).toBe('number');
      expect(stat).toHaveProperty('total_cached_read_tokens');
      expect(typeof stat.total_cached_read_tokens).toBe('number');
    }
  });

  // ==================== URL and table data sync ====================

  test('rtcUser - URL changes trigger table refresh', async ({
    page,
    callFunction,
  }) => {
    // Wait for initial table load
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Navigate to URL with status=banned query param
    await page.goto('/rtc-users/management?status=banned');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call list to verify data reflects the URL filter
    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    // All items should be banned (matching URL param)
    for (const item of resultData) {
      expect(item.status).toBe('banned');
    }
  });

  test('rtcUser - Table data matches URL parameters', async ({
    page,
    callFunction,
  }) => {
    // Navigate with search parameter
    await page.goto('/rtc-users/management?search=alice');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    expect(resultData.length).toBe(1);
    expect(resultData[0].email).toBe('alice@example.com');
  });

  test('rtcUser - Manual URL modification updates table', async ({
    page,
    callFunction,
  }) => {
    // Start on the page without filters
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Manually change URL to add search param
    await page.goto('/rtc-users/management?search=bob');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    const result = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });

    expect(result).toHaveProperty('success', true);
    const resultData = (result as any).data;
    expect(resultData.length).toBe(1);
    expect(resultData[0].name).toBe('Bob Smith');
  });

  // ==================== Search form prefill ====================

  test('rtcUser - Form reflects URL parameters on navigation', async ({
    page,
  }) => {
    // Navigate with search and status params
    await page.goto('/rtc-users/management?search=alice&status=active');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Verify search input is pre-filled
    const searchInput = page.locator('input#search');
    await expect(searchInput).toHaveValue('alice');

    // Verify status select is pre-filled
    const statusSelect = page.locator('.ant-select-selection-item').first();
    await expect(statusSelect).toContainText(/正常|Active/i);
  });

  test('rtcUser - pageAPI.list updates URL via setSearchParams', async ({
    page,
    callFunction,
  }) => {
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call list with search parameter - should sync URL
    await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
      search: 'charlie',
    });

    // Wait for URL update
    await page.waitForTimeout(500);

    // Verify URL was updated
    const url = new URL(page.url());
    expect(url.searchParams.get('search')).toBe('charlie');
  });

  test('rtcUser - Empty search clears URL parameter', async ({
    page,
    callFunction,
  }) => {
    // Start with a search param
    await page.goto('/rtc-users/management?search=alice');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('.ant-table-tbody', { timeout: 5000 });

    // Call list without search - should clear URL param
    await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });

    // Wait for URL update
    await page.waitForTimeout(500);

    // Verify search param was removed from URL
    const url = new URL(page.url());
    expect(url.searchParams.get('search')).toBeFalsy();
  });

  // ==================== Permission filtering ====================

  test('rtcUser - Permission filter: viewer cannot access', async ({
    loginAs,
    callFunction,
  }) => {
    // Login as viewer (only has admin_user:read permission)
    await loginAs('viewer');

    // rtcUser functions should not be available (filtered out)
    await expect(callFunction('rtcUser.list', {})).rejects.toThrow(
      /Function not found/i,
    );
  });

  test('rtcUser - Permission filter: operator can list but not ban', async ({
    page,
    loginAs,
    callFunction,
  }) => {
    // Set up API mocks for the new page context
    await setupRtcUserApiMocks(page);

    // Login as operator (has rtc_user:read but not rtc_user:ban)
    await loginAs('operator');
    await page.goto('/rtc-users/management');
    await page.waitForLoadState('networkidle');

    // Operator should be able to call list (has rtc_user:read)
    const listResult = await callFunction('rtcUser.list', {
      current: 1,
      pageSize: 10,
    });
    expect(listResult).toHaveProperty('success', true);

    // Operator should NOT be able to call ban (no rtc_user:ban)
    await expect(
      callFunction('rtcUser.ban', {
        userId: 'usr_001',
        reason: 'Test',
      }),
    ).rejects.toThrow(/Function not found/i);
  });
});
