import { getUserPermissions } from '@/utils/auth-storage';
import { createAllGroups } from './index';
import type { Permission } from './permission-filter';
import { filterGroupsByPermissions } from './permission-filter';

/**
 * Test Harness Module
 *
 * In development/test environments, exposes the Function Registry
 * to the window object for Playwright E2E tests to call directly.
 *
 * Usage (in Playwright):
 *   const result = await page.evaluate(() => {
 *     return window.__rtc__.callFunction('role.list', { current: 1 });
 *   });
 */

interface RtcTestHarness {
  /**
   * Call a specific Function
   * @param fullPath - Full path, e.g. 'role.list'
   * @param params - Function parameters
   */
  callFunction: (
    fullPath: string,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;

  /**
   * List all available Functions
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

// Build function map (based on permission-filtered groups)
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
 * Initialize test harness
 * Only active in development or test environments
 */
export function initTestHarness(): void {
  // Safety check: only expose in non-production environments
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

  // Expose to window
  (window as any).__rtc__ = harness;

  console.log(
    '[RTC Test Harness] Initialized. Use window.__rtc__ to call functions.',
  );
  console.log(
    `[RTC Test Harness] Available functions: ${harness.listFunctions().length}`,
  );
}
