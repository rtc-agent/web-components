import { test as base } from '@playwright/test';
import type { Permission } from '@/rtc-agent/permission-filter';

type RtcFunctionsFixtures = {
  /** Call RTC Function */
  callFunction: (
    fullPath: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  /** Login helper (defaults to admin role) */
  login: () => Promise<void>;
  /** Login as a specific admin role */
  loginAs: (role: 'admin' | 'operator' | 'viewer') => Promise<void>;
  /** List all registered Functions */
  listFunctions: () => Promise<
    Array<{ group: string; name: string; description: string }>
  >;
};

// Permission mapping for admin roles (consistent with backend)
const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [
    { resource: 'admin_user', action: 'read' },
    { resource: 'admin_user', action: 'write' },
    { resource: 'admin_user', action: 'delete' },
    { resource: 'role', action: 'read' },
    { resource: 'role', action: 'write' },
    { resource: 'role', action: 'delete' },
    { resource: 'permission', action: 'read' },
    { resource: 'permission', action: 'write' },
    { resource: 'permission', action: 'delete' },
    { resource: 'admin_user_role', action: 'read' },
    { resource: 'admin_user_role', action: 'write' },
    { resource: 'admin_user_role', action: 'delete' },
    { resource: 'audit_log', action: 'read' },
    { resource: 'server_config', action: 'read' },
    { resource: 'server_config', action: 'write' },
    { resource: 'server_config', action: 'delete' },
    { resource: 'rtc_user', action: 'read' },
    { resource: 'rtc_user', action: 'ban' },
    { resource: 'rtc_session', action: 'read' },
    { resource: 'rtc_message', action: 'read' },
  ],
  operator: [
    { resource: 'admin_user', action: 'read' },
    { resource: 'admin_user', action: 'write' },
    { resource: 'role', action: 'read' },
    { resource: 'rtc_user', action: 'read' },
    { resource: 'rtc_session', action: 'read' },
    { resource: 'rtc_message', action: 'read' },
  ],
  viewer: [{ resource: 'admin_user', action: 'read' }],
};

export const test = base.extend<RtcFunctionsFixtures>({
  callFunction: async ({ page }, use) => {
    const callFunction = async (
      fullPath: string,
      params?: Record<string, unknown>,
    ) => {
      return page.evaluate(
        ({ path, args }) => {
          // @ts-expect-error
          return window.__rtc__?.callFunction(path, args);
        },
        { path: fullPath, args: params },
      );
    };
    await use(callFunction);
  },

  login: async ({ page }, use) => {
    const login = async () => {
      await page.goto('/user/login');
      await page.fill('input[name="email"]', 'admin');
      await page.fill('input[name="password"]', 'ant.design');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard/**');
    };
    await use(login);
  },

  // === Login as a specific admin role ===
  loginAs: async ({ page }, use) => {
    const loginAs = async (role: 'admin' | 'operator' | 'viewer') => {
      // Mock /api/auth/me endpoint to return permissions for the specified role
      await page.route('**/api/auth/me', async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'test-user-id',
              email: `${role}@example.com`,
              name: role.toUpperCase(),
              roles: [{ id: 'role-id', name: role, display_name: role }],
              permissions: ROLE_PERMISSIONS[role],
            },
          }),
        });
      });

      await page.goto('/user/login');
      await page.fill('input[name="email"]', role);
      await page.fill('input[name="password"]', 'ant.design');
      await page.click('button[type="submit"]');
      await page.waitForURL('**/dashboard/**');

      // Wait for RTC Agent initialization to complete (with permission filtering)
      await page.waitForFunction(() => {
        // @ts-expect-error
        return window.__rtc__?.listFunctions !== undefined;
      });
    };
    await use(loginAs);
  },

  // === List registered Functions ===
  listFunctions: async ({ page }, use) => {
    const listFunctions = async () => {
      return page.evaluate(() => {
        // @ts-expect-error
        return window.__rtc__?.listFunctions() || [];
      });
    };
    await use(listFunctions);
  },
});

export { expect } from '@playwright/test';
