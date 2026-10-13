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
export const PERM_ADMIN_USER_READ = 'admin_user:read';
export const PERM_ADMIN_USER_WRITE = 'admin_user:write';
export const PERM_ADMIN_USER_DELETE = 'admin_user:delete';
export const PERM_ADMIN_USER_ROLE_WRITE = 'admin_user_role:write';

// ============================================================================
// Role Management
// ============================================================================
export const PERM_ROLE_READ = 'role:read';
export const PERM_ROLE_WRITE = 'role:write';

// ============================================================================
// Permission Management
// ============================================================================
export const PERM_PERMISSION_READ = 'permission:read';
export const PERM_PERMISSION_WRITE = 'permission:write';

// ============================================================================
// Audit Log
// ============================================================================
export const PERM_AUDIT_LOG_READ = 'audit_log:read';

// ============================================================================
// RTC User Management
// ============================================================================
export const PERM_RTC_USER_READ = 'rtc_user:read';
export const PERM_RTC_USER_BAN = 'rtc_user:ban';
export const PERM_RTC_SESSION_READ = 'rtc_session:read';
export const PERM_RTC_MESSAGE_READ = 'rtc_message:read';

// ============================================================================
// Server Configuration
// ============================================================================
export const PERM_SERVER_CONFIG_READ = 'server_config:read';
export const PERM_SERVER_CONFIG_WRITE = 'server_config:write';
export const PERM_SERVER_CONFIG_DELETE = 'server_config:delete';

// ============================================================================
// Dashboard
// ============================================================================
export const PERM_DASHBOARD_READ = 'dashboard:read';
