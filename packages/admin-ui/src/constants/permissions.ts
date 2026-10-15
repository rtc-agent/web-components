/**
 * Permission constants
 *
 * Centralizes permission strings (format: "resource:action") to avoid
 * hardcoding across access.ts, app.tsx, and route configs.
 *
 * Design doc reference: Section 6.2 defines the 13 permission points.
 */

// ============================================================================
// Admin User Management
// ============================================================================

/** Permission to read admin user list and details */
export const PERM_ADMIN_USER_READ = 'admin_user:read';

/** Permission to create and update admin users */
export const PERM_ADMIN_USER_WRITE = 'admin_user:write';

/** Permission to delete admin users */
export const PERM_ADMIN_USER_DELETE = 'admin_user:delete';

/** Permission to assign or modify admin user roles */
export const PERM_ADMIN_USER_ROLE_WRITE = 'admin_user_role:write';

// ============================================================================
// Role Management
// ============================================================================

/** Permission to read role list and details */
export const PERM_ROLE_READ = 'role:read';

/** Permission to create and update roles */
export const PERM_ROLE_WRITE = 'role:write';

// ============================================================================
// Permission Management
// ============================================================================

/** Permission to read permission list */
export const PERM_PERMISSION_READ = 'permission:read';

/** Permission to create and update permissions */
export const PERM_PERMISSION_WRITE = 'permission:write';

// ============================================================================
// Audit Log
// ============================================================================

/** Permission to read audit logs (read-only, critical for compliance) */
export const PERM_AUDIT_LOG_READ = 'audit_log:read';

// ============================================================================
// RTC User Management
// ============================================================================

/** Permission to read RTC user list and details */
export const PERM_RTC_USER_READ = 'rtc_user:read';

/** Permission to ban or unban RTC users (affects real-time access) */
export const PERM_RTC_USER_BAN = 'rtc_user:ban';

/** Permission to read RTC session list */
export const PERM_RTC_SESSION_READ = 'rtc_session:read';

/** Permission to read RTC message history */
export const PERM_RTC_MESSAGE_READ = 'rtc_message:read';

// ============================================================================
// Server Configuration
// ============================================================================

/** Permission to read server configuration */
export const PERM_SERVER_CONFIG_READ = 'server_config:read';

/** Permission to create and update server configuration */
export const PERM_SERVER_CONFIG_WRITE = 'server_config:write';

/** Permission to delete server configuration entries */
export const PERM_SERVER_CONFIG_DELETE = 'server_config:delete';

// ============================================================================
// Dashboard
// ============================================================================

/** Permission to view the dashboard and analytics */
export const PERM_DASHBOARD_READ = 'dashboard:read';

// ============================================================================
// Resource and Action Type Helpers
// ============================================================================

/**
 * Get resource type options for UI selectors
 * Extracts unique resources from permission strings
 */
export function getResourceTypes(intl: { formatMessage: (descriptor: { id: string; defaultMessage: string }) => string }): Array<{ value: string; label: string }> {
  const resources = [
    'admin_user',
    'admin_user_role',
    'role',
    'permission',
    'audit_log',
    'rtc_user',
    'rtc_session',
    'rtc_message',
    'server_config',
    'dashboard',
  ];

  const resourceLabels: Record<string, string> = {
    admin_user: intl.formatMessage({ id: 'pages.permissions.resource.adminUser', defaultMessage: 'Admin User' }),
    admin_user_role: intl.formatMessage({ id: 'pages.permissions.resource.adminUserRole', defaultMessage: 'Admin User Role' }),
    role: intl.formatMessage({ id: 'pages.permissions.resource.role', defaultMessage: 'Role' }),
    permission: intl.formatMessage({ id: 'pages.permissions.resource.permission', defaultMessage: 'Permission' }),
    audit_log: intl.formatMessage({ id: 'pages.permissions.resource.auditLog', defaultMessage: 'Audit Log' }),
    rtc_user: intl.formatMessage({ id: 'pages.permissions.resource.rtcUser', defaultMessage: 'RTC User' }),
    rtc_session: intl.formatMessage({ id: 'pages.permissions.resource.rtcSession', defaultMessage: 'RTC Session' }),
    rtc_message: intl.formatMessage({ id: 'pages.permissions.resource.rtcMessage', defaultMessage: 'RTC Message' }),
    server_config: intl.formatMessage({ id: 'pages.permissions.resource.serverConfig', defaultMessage: 'Server Config' }),
    dashboard: intl.formatMessage({ id: 'pages.permissions.resource.dashboard', defaultMessage: 'Dashboard' }),
  };

  return resources.map((resource) => ({
    value: resource,
    label: resourceLabels[resource] || resource,
  }));
}

/**
 * Get action type options for UI selectors
 */
export function getActionTypes(intl: { formatMessage: (descriptor: { id: string; defaultMessage: string }) => string }): Array<{ value: string; label: string }> {
  return [
    {
      value: 'read',
      label: intl.formatMessage({ id: 'pages.permissions.action.read', defaultMessage: 'Read' }),
    },
    {
      value: 'write',
      label: intl.formatMessage({ id: 'pages.permissions.action.write', defaultMessage: 'Write' }),
    },
    {
      value: 'delete',
      label: intl.formatMessage({ id: 'pages.permissions.action.delete', defaultMessage: 'Delete' }),
    },
    {
      value: 'ban',
      label: intl.formatMessage({ id: 'pages.permissions.action.ban', defaultMessage: 'Ban' }),
    },
  ];
}
