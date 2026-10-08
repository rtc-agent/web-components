import { expect, test } from '../fixtures/rtc-functions';

// Mock data for user profile API
const MOCK_USER_PROFILE = {
  name: 'Serati Ma',
  avatar:
    'https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png',
  userid: '00000001',
  email: 'antdesign@alipay.com',
  signature: '海纳百川，有容乃大',
  title: '交互专家',
  group: '蚂蚁集团－某某某事业群－某某平台部－某某技术部－UED',
  tags: [
    { key: '0', label: '很有想法的' },
    { key: '1', label: '专注设计' },
    { key: '2', label: '辣~' },
    { key: '3', label: '大长腿' },
    { key: '4', label: '川妹子' },
    { key: '5', label: '海纳百川' },
  ],
  notifyCount: 12,
  unreadCount: 11,
  country: 'China',
  geographic: {
    province: { label: '浙江省', key: '330000' },
    city: { label: '杭州市', key: '330100' },
  },
  address: '西湖区工专路 77 号',
  phone: '0752-268888888',
  notice: [
    {
      id: 'notice-001',
      title: 'Alipay',
      logo: 'https://gw.alipayobjects.com/zos/rmsportal/WdGqmHpayyMjiEhcKoVE.png',
      description: '那是一种内在的东西， 他们到达不了，也无法触及的',
      updatedAt: '2026-10-01T10:00:00Z',
      member: '科学搬砖组',
      href: '',
      memberLink: '',
    },
  ],
};

/**
 * Helper: Set up API route mocks for account endpoints.
 */
async function setupAccountApiMocks(page: any) {
  // Mock center page profile API
  await page.route('**/api/currentUserDetail*', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: MOCK_USER_PROFILE,
      }),
    });
  });

  // Mock settings page profile API (GET)
  await page.route('**/api/accountSettingCurrentUser*', async (route: any) => {
    const method = route.request().method();
    if (method === 'PUT') {
      // Handle profile update
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
        }),
      });
    } else {
      // Handle profile query (GET)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: MOCK_USER_PROFILE,
        }),
      });
    }
  });

  // Mock geographic APIs
  await page.route('**/api/geographic/province*', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { name: '浙江省', id: '330000' },
          { name: '江苏省', id: '320000' },
        ],
      }),
    });
  });

  await page.route('**/api/geographic/city/*', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          { name: '杭州市', id: '330100' },
          { name: '宁波市', id: '330200' },
        ],
      }),
    });
  });
}

test.describe('selfAccount Group - Self Account Management', () => {
  // ==================== getProfile ====================

  test.describe('getProfile', () => {
    test.beforeEach(async ({ page, login }) => {
      await setupAccountApiMocks(page);
      await login();
    });

    test('selfAccount.getProfile - Returns user profile data', async ({
      callFunction,
    }) => {
      // Call getProfile function
      const result = await callFunction('selfAccount.getProfile');

      // Verify return value structure
      expect(result).toHaveProperty('success', true);
      expect(result).toHaveProperty('data');

      const data = (result as any).data;
      expect(data).toBeTruthy();

      // Verify required fields
      expect(typeof data.name).toBe('string');
      expect(data.name).toBe(MOCK_USER_PROFILE.name);
      expect(typeof data.avatar).toBe('string');
      expect(typeof data.email).toBe('string');
      expect(data.email).toBe(MOCK_USER_PROFILE.email);
      expect(typeof data.userid).toBe('string');
    });

    test('selfAccount.getProfile - Returns all profile fields', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.getProfile');

      const data = (result as any).data;

      // Verify extended fields
      expect(data.signature).toBe(MOCK_USER_PROFILE.signature);
      expect(data.title).toBe(MOCK_USER_PROFILE.title);
      expect(data.group).toBe(MOCK_USER_PROFILE.group);
      expect(data.country).toBe(MOCK_USER_PROFILE.country);
      expect(data.address).toBe(MOCK_USER_PROFILE.address);
      expect(data.phone).toBe(MOCK_USER_PROFILE.phone);

      // Verify tags
      expect(Array.isArray(data.tags)).toBe(true);
      expect(data.tags.length).toBe(MOCK_USER_PROFILE.tags.length);
      expect(data.tags[0]).toHaveProperty('key');
      expect(data.tags[0]).toHaveProperty('label');

      // Verify geographic
      expect(data.geographic).toHaveProperty('province');
      expect(data.geographic).toHaveProperty('city');
      expect(data.geographic.province).toHaveProperty('label');
      expect(data.geographic.province).toHaveProperty('key');
    });

    test('selfAccount.getProfile - Returns notice/team data', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.getProfile');

      const data = (result as any).data;

      // Verify notice array
      expect(Array.isArray(data.notice)).toBe(true);
      if (data.notice.length > 0) {
        const notice = data.notice[0];
        expect(notice).toHaveProperty('id');
        expect(notice).toHaveProperty('title');
        expect(notice).toHaveProperty('logo');
        expect(notice).toHaveProperty('member');
      }
    });

    test('selfAccount.getProfile - Data matches UI display', async ({
      page,
      callFunction,
    }) => {
      // Navigate to center page and wait for it to load
      await page.goto('/account/center');
      await page.waitForLoadState('networkidle');

      // Wait for profile to render
      await page.waitForSelector('text=Serati Ma', { timeout: 5000 });

      // Call function
      const result = await callFunction('selfAccount.getProfile');
      const data = (result as any).data;

      // Verify name matches what's displayed in UI
      const nameElement = page.locator('text=Serati Ma');
      await expect(nameElement).toBeVisible();
      expect(data.name).toBe('Serati Ma');
    });

    test('selfAccount.getProfile - URL navigates to center page', async ({
      page,
      callFunction,
    }) => {
      // Start from a different page
      await page.goto('/dashboard/grafana/rtc-agent');
      await page.waitForLoadState('networkidle');

      // Call getProfile (should navigate to center page)
      await callFunction('selfAccount.getProfile');

      // Verify URL changed to center page
      const url = page.url();
      expect(url).toContain('/account/center');
    });
  });

  // ==================== updateProfile ====================

  test.describe('updateProfile', () => {
    test.beforeEach(async ({ page, login }) => {
      await setupAccountApiMocks(page);
      await login();
      await page.goto('/account/settings');
      await page.waitForLoadState('networkidle');
    });

    test('selfAccount.updateProfile - Successfully updates profile', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.updateProfile', {
        name: 'New Name',
        email: 'newemail@example.com',
      });

      expect(result).toHaveProperty('success', true);
    });

    test('selfAccount.updateProfile - Validates required name', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.updateProfile', {
        name: '',
        email: 'test@example.com',
      });

      // Empty name should fail validation
      expect(result).toHaveProperty('success', false);
      expect((result as any).error).toContain('Name is required');
    });

    test('selfAccount.updateProfile - Validates required email', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.updateProfile', {
        name: 'Test User',
        email: '',
      });

      // Empty email should fail validation
      expect(result).toHaveProperty('success', false);
      expect((result as any).error).toContain('Email is required');
    });

    test('selfAccount.updateProfile - Updates all fields', async ({
      callFunction,
    }) => {
      const result = await callFunction('selfAccount.updateProfile', {
        name: 'Updated Name',
        email: 'updated@example.com',
        profile: 'A passionate developer',
        country: 'China',
        province: '330000',
        city: '330100',
        address: '123 New Street',
        phone: '0571-88888888',
      });

      expect(result).toHaveProperty('success', true);
    });

    test('selfAccount.updateProfile - Navigates to settings page', async ({
      page,
      callFunction,
    }) => {
      // Start from a different page
      await page.goto('/dashboard/grafana/rtc-agent');
      await page.waitForLoadState('networkidle');

      // Call updateProfile (should navigate to settings page)
      await callFunction('selfAccount.updateProfile', {
        name: 'Test',
        email: 'test@example.com',
      });

      // Verify URL changed to settings page
      const url = page.url();
      expect(url).toContain('/account/settings');
    });
  });

  // ==================== Permission filtering ====================

  test.describe('Permission filtering', () => {
    test('selfAccount - No permission required, available to all roles', async ({
      page,
      loginAs,
      callFunction,
    }) => {
      // Set up API mocks for the new page context
      await setupAccountApiMocks(page);

      // Login as viewer (only has admin_user:read permission)
      await loginAs('viewer');

      // selfAccount functions should be available (no permission required)
      // But viewer doesn't have selfAccount in their filtered functions
      // because the group requires no permissions, but the viewer role
      // in ROLE_PERMISSIONS doesn't include any selfAccount-related permissions.
      // Since selfAccount has requiredPermissions: [], it should be available to ALL roles.
      // However, the viewer role in our test fixture has limited permissions.
      // The filter logic: empty requiredPermissions = available to all.
      // So this should work:
      await page.goto('/account/center');
      await page.waitForLoadState('networkidle');

      const result = await callFunction('selfAccount.getProfile');
      expect(result).toHaveProperty('success', true);
    });

    test('selfAccount - Operator can access profile', async ({
      page,
      loginAs,
      callFunction,
    }) => {
      await setupAccountApiMocks(page);
      await loginAs('operator');

      await page.goto('/account/center');
      await page.waitForLoadState('networkidle');

      const result = await callFunction('selfAccount.getProfile');
      expect(result).toHaveProperty('success', true);
      expect((result as any).data).toBeTruthy();
    });
  });
});
