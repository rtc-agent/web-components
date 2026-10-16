/**
 * Service layer for the audit logs page
 *
 * Re-exports shared API from @/services/ for page-level consistency.
 * All page components should import API functions from this file rather than @/services/ directly.
 */

export { getAuditLogList } from '@/services/audit-log';
