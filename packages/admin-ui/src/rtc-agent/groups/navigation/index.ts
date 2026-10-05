import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { createGotoFunction } from './goto';
import { pages, filterPagesByPermissions } from './page-registry';

/**
 * Page Navigation Function Group
 *
 * No permission required, available to all administrators
 */
export const createNavigationGroup = (
  userPermissions: Set<string>,
): {
  name: string;
  description: string;
  functions: PermissionAwareFunctionDef[];
} => {
  // Filter pages by user permissions
  const availablePages = filterPagesByPermissions(pages, userPermissions);

  // Create goto function with available pages in description
  const goto = createGotoFunction(availablePages);

  return {
    name: 'navigation',
    description: 'Page navigation module, supports page navigation',
    functions: [goto] as PermissionAwareFunctionDef[],
  };
};
