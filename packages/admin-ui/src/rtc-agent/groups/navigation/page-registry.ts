/**
 * Page Registry
 *
 * Defines all navigable pages in the admin dashboard.
 * Used by navigation.goto to provide dynamic page list in function description.
 */

import {
  PERM_ADMIN_USER_READ,
  PERM_AUDIT_LOG_READ,
  PERM_DASHBOARD_READ,
  PERM_PERMISSION_READ,
  PERM_ROLE_READ,
  PERM_RTC_MESSAGE_READ,
  PERM_RTC_SESSION_READ,
  PERM_RTC_USER_READ,
} from '@/constants/permissions';

export interface PageDefinition {
  path: string;
  name: string;
  description: string;
  requiredPermission?: string; // e.g. "role:read"
}

/**
 * All pages in the admin dashboard
 */
export const pages: PageDefinition[] = [
  {
    path: '/dashboard/grafana',
    name: 'Grafana',
    description: 'Monitoring dashboard powered by Grafana',
    requiredPermission: PERM_DASHBOARD_READ,
  },
  {
    path: '/system/users',
    name: 'Admin Users',
    description: 'Manage administrator accounts',
    requiredPermission: PERM_ADMIN_USER_READ,
  },
  {
    path: '/system/roles',
    name: 'Admin Roles',
    description: 'Manage administrator roles and their permissions',
    requiredPermission: PERM_ROLE_READ,
  },
  {
    path: '/system/permissions',
    name: 'Permissions',
    description: 'Manage system permission definitions',
    requiredPermission: PERM_PERMISSION_READ,
  },
  {
    path: '/system/audit-logs',
    name: 'Audit Logs',
    description: 'View operation audit logs',
    requiredPermission: PERM_AUDIT_LOG_READ,
  },
  {
    path: '/rtc-users/management',
    name: 'RTC Users',
    description: 'Manage RTC users, view devices and token statistics',
    requiredPermission: PERM_RTC_USER_READ,
  },
  {
    path: '/rtc-users/sessions',
    name: 'RTC Sessions',
    description: 'View RTC session history and details',
    requiredPermission: PERM_RTC_SESSION_READ,
  },
  {
    path: '/rtc-users/messages',
    name: 'RTC Messages',
    description: 'View RTC message history',
    requiredPermission: PERM_RTC_MESSAGE_READ,
  },
];

/**
 * Filter pages by user permissions
 */
export function filterPagesByPermissions(
  pages: PageDefinition[],
  userPermissions: Set<string>,
): PageDefinition[] {
  return pages.filter(
    (page) =>
      !page.requiredPermission || userPermissions.has(page.requiredPermission),
  );
}

/**
 * Format page list for function description
 */
export function formatPageListForDescription(pages: PageDefinition[]): string {
  return pages.map((p) => `- ${p.path}: ${p.description}`).join('\n');
}

/**
 * Extract page name from path (for page API lookup)
 */
export function extractPageName(path: string): string {
  const mapping: Record<string, string> = {
    '/system/roles': 'role',
    '/system/users': 'admin',
    '/system/permissions': 'permission',
    '/system/audit-logs': 'auditLog',
    '/rtc-users/management': 'rtcUser',
    '/rtc-users/sessions': 'rtcSession',
    '/rtc-users/messages': 'rtcMessage',
  };
  return mapping[path] || path.split('/').pop() || '';
}
