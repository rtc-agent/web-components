/**
 * Page Registry
 *
 * Defines all navigable pages in the admin dashboard.
 * Used by navigation.goto to provide dynamic page list in function description.
 */

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
  },
  {
    path: '/system/users',
    name: 'Admin Users',
    description: 'Manage administrator accounts',
    requiredPermission: 'admin_user:read',
  },
  {
    path: '/system/roles',
    name: 'Admin Roles',
    description: 'Manage administrator roles and their permissions',
    requiredPermission: 'role:read',
  },
  {
    path: '/system/permissions',
    name: 'Permissions',
    description: 'Manage system permission definitions',
    requiredPermission: 'permission:read',
  },
  {
    path: '/system/audit-logs',
    name: 'Audit Logs',
    description: 'View operation audit logs',
    requiredPermission: 'audit_log:read',
  },
  {
    path: '/system/configs',
    name: 'Server Configs',
    description: 'Manage system configuration settings',
    requiredPermission: 'server_config:read',
  },
  {
    path: '/rtc-users/management',
    name: 'RTC Users',
    description: 'Manage RTC users and their status',
    requiredPermission: 'rtc_user:read',
  },
  {
    path: '/rtc-users/sessions',
    name: 'RTC Sessions',
    description: 'View RTC sessions and their details',
    requiredPermission: 'rtc_session:read',
  },
  {
    path: '/rtc-users/messages',
    name: 'RTC Messages',
    description: 'View RTC messages for sessions',
    requiredPermission: 'rtc_message:read',
  },
  {
    path: '/account/settings',
    name: 'Account Settings',
    description: 'Personal account settings',
  },
  {
    path: '/account/center',
    name: 'Account Center',
    description: 'Personal account center',
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
 *
 * Maps URL paths to their corresponding page API keys.
 * These keys must match the keys used in window.__pages__ registration.
 */
export function extractPageName(path: string): string {
  const mapping: Record<string, string> = {
    // System pages
    '/system/roles': 'role',
    '/system/users': 'admin',
    '/system/permissions': 'permission',
    '/system/audit-logs': 'auditLog',
    '/system/configs': 'serverConfig',

    // RTC pages
    '/rtc-users/management': 'rtcUser',
    '/rtc-users/sessions': 'rtcSession',
    '/rtc-users/messages': 'rtcMessage',

    // Account pages
    '/account/settings': 'selfAccountSettings',
    '/account/center': 'selfAccountCenter',
  };

  return mapping[path] || path.split('/').pop() || '';
}
