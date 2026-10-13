/**
 * Service layer for the audit logs page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import from this file rather than @/services/ directly.
 */

export { getAuditLogList } from '@/services/audit-log';
export type { AuditLogItem } from '@/services/audit-log';
