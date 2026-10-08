/**
 * Page API for the audit logs page
 *
 * The page component registers this API on mount to window.__pages__
 * Function handlers call this API to operate on the UI
 *
 * Key principles:
 * - Uses React native approach (actionRef, service functions)
 * - Returns data matching what is displayed in the UI
 * - Does not directly manipulate DOM
 */

import type { AuditLogItem } from '@/services/auditLog';

export interface AuditLogPageAPI {
  /**
   * Read the data currently displayed in the table
   * Calls the service function to get backend data, consistent with UI display
   */
  list: (params?: {
    current?: number;
    pageSize?: number;
    actor_id?: string;
    resource_type?: string;
    event_type?: string;
    target_id?: string;
    start_time?: string;
    end_time?: string;
  }) => Promise<{
    success: boolean;
    data: AuditLogItem[];
    total: number;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    auditLog?: AuditLogPageAPI;
  }
}
