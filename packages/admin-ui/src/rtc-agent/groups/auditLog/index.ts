import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { listAuditLogs } from './list';

/**
 * Audit Log Function Group
 *
 * Corresponds to route: /system/audit-logs
 *
 * All functions call the page-exposed React API:
 * - window.__pages__.auditLog.list()
 *
 * Permission requirements:
 * - list: audit_log:read
 *
 * Note: Audit logs are read-only, no create/update/remove operations.
 */
export const auditLogGroup = {
  name: 'auditLog',
  description:
    'Admin audit log module for /system/audit-logs page. Supports querying audit logs with pagination and filtering. Read-only - no create/update/delete operations.',
  functions: [listAuditLogs] as PermissionAwareFunctionDef[],
};
