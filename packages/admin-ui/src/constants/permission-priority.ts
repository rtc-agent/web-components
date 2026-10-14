/**
 * Permission Priority Configuration
 *
 * Centralizes the priority order for permission-based redirects.
 * Used by:
 * - app.tsx: redirectByPermissions() for top-level page redirect
 * - system/index.tsx: System sub-page redirect
 *
 * Design rationale:
 * - Avoids duplicating priority logic across multiple files
 * - Single source of truth for permission hierarchy
 * - Easy to modify priority order in one place
 */

/**
 * Top-level page redirect priority
 *
 * Order: Dashboard > RTC Users > System > 403 (no permissions)
 *
 * This priority determines which page to redirect to when a user
 * has multiple permissions. Higher priority pages are preferred.
 */
export const TOP_LEVEL_REDIRECT_PRIORITY = {
  /** Highest priority: Dashboard and analytics */
  dashboard: {
    /** Access check key from access.ts */
    accessKey: 'canDashboardView',
    /** Target route path */
    targetPath: '/dashboard/grafana/rtc-agent',
  },
  /** Second priority: RTC user management */
  rtcUsers: {
    /** Access check keys (any one matches = redirect) */
    accessKeys: ['canRtcUserView', 'canRtcSessionView', 'canRtcMessageView'],
    /** Target route path */
    targetPath: '/rtc-users/management',
  },
  /** Third priority: System management */
  system: {
    /** Access check key from access.ts */
    accessKey: 'canSystemView',
    /** Target route path */
    targetPath: '/system',
  },
  /** Fallback: No permissions, redirect to 403 */
  noPermission: {
    /** Target route path */
    targetPath: '/exception/403',
  },
} as const;

/**
 * System sub-page redirect priority
 *
 * Order: Admin Users > Roles > Permissions > Audit Logs > Server Configs
 *
 * This priority determines which system sub-page to redirect to
 * when a user has multiple system permissions.
 */
export const SYSTEM_SUB_PAGE_PRIORITY = [
  {
    /** Access check key from access.ts */
    accessKey: 'canAdminUserView',
    /** Target route path */
    targetPath: '/system/users',
  },
  {
    accessKey: 'canAdminRoleView',
    targetPath: '/system/roles',
  },
  {
    accessKey: 'canPermissionView',
    targetPath: '/system/permissions',
  },
  {
    accessKey: 'canAuditLogView',
    targetPath: '/system/audit-logs',
  },
  {
    accessKey: 'canServerConfigView',
    targetPath: '/system/configs',
  },
] as const;

/**
 * Type for access object returned by access.ts
 */
export type AccessObject = {
  canDashboardView?: boolean;
  canRtcUserView?: boolean;
  canRtcSessionView?: boolean;
  canRtcMessageView?: boolean;
  canSystemView?: boolean;
  canAdminUserView?: boolean;
  canAdminRoleView?: boolean;
  canPermissionView?: boolean;
  canAuditLogView?: boolean;
  canServerConfigView?: boolean;
  [key: string]: boolean | undefined;
};

/**
 * Determine the target path based on access permissions and priority
 *
 * @param accessObj - Access object from access.ts
 * @returns Target path to redirect to, or null if no permissions match
 */
export function getTopLevelRedirectTarget(
  accessObj: AccessObject,
): string | null {
  // Check dashboard permission
  if (accessObj[TOP_LEVEL_REDIRECT_PRIORITY.dashboard.accessKey]) {
    return TOP_LEVEL_REDIRECT_PRIORITY.dashboard.targetPath;
  }

  // Check RTC users permissions (any one matches)
  const rtcUsersKeys = TOP_LEVEL_REDIRECT_PRIORITY.rtcUsers.accessKeys;
  if (rtcUsersKeys.some((key) => accessObj[key])) {
    return TOP_LEVEL_REDIRECT_PRIORITY.rtcUsers.targetPath;
  }

  // Check system permission
  if (accessObj[TOP_LEVEL_REDIRECT_PRIORITY.system.accessKey]) {
    return TOP_LEVEL_REDIRECT_PRIORITY.system.targetPath;
  }

  // No permissions match
  return TOP_LEVEL_REDIRECT_PRIORITY.noPermission.targetPath;
}

/**
 * Determine the system sub-page target based on access permissions and priority
 *
 * @param accessObj - Access object from access.ts
 * @returns Target path to redirect to, or null if no system permissions match
 */
export function getSystemSubPageRedirectTarget(
  accessObj: AccessObject,
): string | null {
  for (const priority of SYSTEM_SUB_PAGE_PRIORITY) {
    if (accessObj[priority.accessKey]) {
      return priority.targetPath;
    }
  }
  return null;
}
