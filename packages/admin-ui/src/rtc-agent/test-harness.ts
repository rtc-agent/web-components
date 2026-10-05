import { getUserPermissions } from '@/utils/auth-storage';
import { createAllGroups } from './index';
import type { Permission } from './permission-filter';
import { filterGroupsByPermissions } from './permission-filter';

/**
 * 测试桥接模块
 *
 * 在开发/测试环境下，将 Function Registry 暴露到 window 对象
 * 供 Playwright E2E 测试直接调用
 *
 * 用法（在 Playwright 中）：
 *   const result = await page.evaluate(() => {
 *     return window.__rtc__.callFunction('role.list', { current: 1 });
 *   });
 */

interface RtcTestHarness {
  /**
   * 调用指定 Function
   * @param fullPath - 完整路径，如 'role.list'
   * @param params - 函数参数
   */
  callFunction: (
    fullPath: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;

  /**
   * 列出所有可用的 Functions
   */
  listFunctions: () => Array<{
    group: string;
    name: string;
    description: string;
  }>;
}

// Get groups filtered by current admin's permissions
function getFilteredGroups() {
  const permissions: Permission[] = getUserPermissions();
  const allGroups = createAllGroups(permissions);
  return filterGroupsByPermissions(allGroups, permissions);
}

// 构建 function map（基于权限过滤后的 groups）
function buildFunctionMap(): Map<
  string,
  (params?: Record<string, unknown>) => Promise<unknown>
> {
  const map = new Map();
  const filteredGroups = getFilteredGroups();

  for (const group of filteredGroups) {
    for (const fn of group.functions) {
      const fullPath = `${group.name}.${fn.name}`;
      map.set(fullPath, async (params?: Record<string, unknown>) => {
        return fn.handler(params || {}, () => {});
      });
    }
  }

  return map;
}

/**
 * 初始化测试桥接
 * 仅在开发环境或测试环境生效
 */
export function initTestHarness(): void {
  // 安全检查：仅在非生产环境暴露
  if (process.env.NODE_ENV === 'production') {
    return;
  }

  const functionMap = buildFunctionMap();

  const harness: RtcTestHarness = {
    callFunction: async (fullPath, params) => {
      const fn = functionMap.get(fullPath);
      if (!fn) {
        throw new Error(`Function not found: ${fullPath}`);
      }
      return fn(params);
    },

    listFunctions: () => {
      const result: Array<{
        group: string;
        name: string;
        description: string;
      }> = [];
      const filteredGroups = getFilteredGroups();

      for (const group of filteredGroups) {
        for (const fn of group.functions) {
          result.push({
            group: group.name,
            name: fn.name,
            description: fn.description,
          });
        }
      }
      return result;
    },
  };

  // 暴露到 window
  (window as any).__rtc__ = harness;

  console.log(
    '[RTC Test Harness] Initialized. Use window.__rtc__ to call functions.',
  );
  console.log(
    `[RTC Test Harness] Available functions: ${harness.listFunctions().length}`,
  );
}
