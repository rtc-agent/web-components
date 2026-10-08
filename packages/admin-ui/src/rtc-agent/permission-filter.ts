/**
 * Permission Filter Module
 *
 * Filters Functions based on admin permissions, only registering
 * Functions that the admin has permission to use.
 */

import type { FunctionDef } from '@rtc-agent/component';

/**
 * Permission definition (consistent with backend API response)
 */
export interface Permission {
  resource: string;
  action: string;
}

/**
 * Function definition with permission requirements
 *
 * Extends FunctionDef by adding requiredPermissions property
 */
export interface PermissionAwareFunctionDef extends FunctionDef {
  /** Required permissions list; empty means no permission required (available to all admins) */
  requiredPermissions?: Permission[];
}

/**
 * Convert permission array to Set<string> for O(1) lookup
 */
export function buildPermissionSet(permissions: Permission[]): Set<string> {
  return new Set(permissions.map((p) => `${p.resource}:${p.action}`));
}

/**
 * Check if admin has all permissions required by a Function
 */
export function hasRequiredPermissions(
  fn: PermissionAwareFunctionDef,
  userPermissionSet: Set<string>,
): boolean {
  // No permission required = available to all admins
  if (!fn.requiredPermissions || fn.requiredPermissions.length === 0) {
    return true;
  }

  // Check if admin has all required permissions
  return fn.requiredPermissions.every((p) =>
    userPermissionSet.has(`${p.resource}:${p.action}`),
  );
}

/**
 * Filter Functions: only keep those the admin has permission to use
 */
export function filterFunctionsByPermissions<
  T extends PermissionAwareFunctionDef,
>(functions: T[], userPermissions: Permission[]): T[] {
  const userPermissionSet = buildPermissionSet(userPermissions);

  const filtered = functions.filter((fn) =>
    hasRequiredPermissions(fn, userPermissionSet),
  );

  console.log(
    `[Permission Filter] ${filtered.length}/${functions.length} functions available`,
  );

  return filtered;
}

/**
 * Filter Function Groups: filter functions within each group, remove empty groups
 */
export function filterGroupsByPermissions<T extends PermissionAwareFunctionDef>(
  groups: Array<{ name: string; description?: string; functions: T[] }>,
  userPermissions: Permission[],
): Array<{ name: string; description?: string; functions: T[] }> {
  return groups
    .map((group) => ({
      ...group,
      functions: filterFunctionsByPermissions(group.functions, userPermissions),
    }))
    .filter((group) => group.functions.length > 0); // Remove empty groups
}
