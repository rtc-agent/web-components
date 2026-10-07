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
    '/system/users': 'user',
    '/system/permissions': 'permission',
    '/system/audit-logs': 'auditLog',
  };
  return mapping[path] || path.split('/').pop() || '';
}
