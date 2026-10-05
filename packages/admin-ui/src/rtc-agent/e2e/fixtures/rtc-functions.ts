import { test as base } from '@playwright/test';
import type { Permission } from '@/rtc-agent/permission-filter';

type RtcFunctionsFixtures = {
  /** 调用 RTC Function */
  callFunction: (
    fullPath: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  /** 登录 helper（默认 admin 管理员角色） */
  login: () => Promise<void>;
  /** 以指定管理员角色登录 */
  loginAs: (role: 'admin' | 'operator' | 'viewer') => Promise<void>;
  /** 列出所有已注册的 Functions */
  listFunctions: () => Promise<
    Array<{ group: string; name: string; description: string }>
  >;
};

// 管理员角色对应的权限映射（与后端一致）
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
  ],
  operator: [
    { resource: 'admin_user', action: 'read' },
    { resource: 'admin_user', action: 'write' },
    { resource: 'role', action: 'read' },
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

  // === 新增：以指定管理员角色登录 ===
  loginAs: async ({ page }, use) => {
    const loginAs = async (role: 'admin' | 'operator' | 'viewer') => {
      // Mock /api/auth/me 接口返回对应管理员角色的权限
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

      // 等待 RTC Agent 初始化完成（带权限过滤）
      await page.waitForFunction(() => {
        // @ts-expect-error
        return window.__rtc__?.listFunctions !== undefined;
      });
    };
    await use(loginAs);
  },

  // === 新增：列出已注册的 Functions ===
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
