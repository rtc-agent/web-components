import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query audit log list
 *
 * Permission required: audit_log:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.auditLog.list)
 * - Page API calls the backend API via service function
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listAuditLogs: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query audit log list on /system/audit-logs page. Supports pagination and filtering by actor_id, resource_type, event_type, target_id, and time range. Returns audit logs currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'audit_log', action: 'read' }],

  zodSchema: z.object({
    current: withMeta(z.number().int().positive(), { example: 1 })
      .optional()
      .describe(
        'Current page number for pagination. Defaults to 1. Use with pageSize to control result set size.',
      ),
    pageSize: withMeta(z.number().int().positive(), { example: 20 })
      .optional()
      .describe(
        'Number of items per page for pagination. Defaults to 20. Use with current to navigate through results.',
      ),
    actor_id: withMeta(z.string(), { example: 'user-123' })
      .optional()
      .describe(
        'Filter by actor (operator) ID. Returns only audit logs created by the specified user.',
      ),
    resource_type: withMeta(z.string(), { example: 'role' })
      .optional()
      .describe(
        'Filter by resource type (role, admin_user, permission, admin_user_role, server_config). Returns only logs for the specified resource type.',
      ),
    event_type: withMeta(z.string(), { example: 'create_role' })
      .optional()
      .describe(
        'Filter by event type (create_role, update_role, delete_role, assign_roles, revoke_role, create_user, update_user, delete_user, etc.). Returns only logs for the specified event.',
      ),
    target_id: withMeta(z.string(), { example: '01a10622-...' })
      .optional()
      .describe(
        'Filter by target resource ID. Returns only logs related to the specified resource instance.',
      ),
    start_time: withMeta(z.string(), { example: '2026-01-01T00:00:00Z' })
      .optional()
      .describe(
        'Filter by start time (ISO 8601 format). Returns only logs created after this time.',
      ),
    end_time: withMeta(z.string(), { example: '2026-12-31T23:59:59Z' })
      .optional()
      .describe(
        'Filter by end time (ISO 8601 format). Returns only logs created before this time.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('Audit log entry ID'),
              operator_id: z.string().describe('Operator ID'),
              operator_name: z
                .string()
                .optional()
                .describe('Operator display name'),
              operator_ip: z
                .string()
                .optional()
                .describe('Operator IP address'),
              event_type: z.string().describe('Event type'),
              resource_type: z.string().describe('Resource type'),
              resource_id: z.string().optional().describe('Resource ID'),
              details: z
                .record(z.any())
                .optional()
                .describe('Event details (JSON object)'),
              created_at: z.string().describe('Creation time'),
            }),
          )
          .describe('Audit log list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('Audit log list query result'),
  },

  handler: async (params) => {
    const {
      current = 1,
      pageSize = 20,
      actor_id,
      resource_type,
      event_type,
      target_id,
      start_time,
      end_time,
    } = params as {
      current?: number;
      pageSize?: number;
      actor_id?: string;
      resource_type?: string;
      event_type?: string;
      target_id?: string;
      start_time?: string;
      end_time?: string;
    };

    // Build query params for URL
    const queryParams: Record<string, string> = {};
    if (actor_id) {
      queryParams.actor_id = actor_id;
    }
    if (resource_type) {
      queryParams.resource_type = resource_type;
    }
    if (event_type) {
      queryParams.event_type = event_type;
    }
    if (target_id) {
      queryParams.target_id = target_id;
    }
    if (start_time) {
      queryParams.start_time = start_time;
    }
    if (end_time) {
      queryParams.end_time = end_time;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('auditLog', '/system/audit-logs', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.auditLog;
    if (!pageAPI) {
      throw new Error('Audit log page failed to load. Please try again.');
    }

    return await pageAPI.list({
      current,
      pageSize,
      actor_id,
      resource_type,
      event_type,
      target_id,
      start_time,
      end_time,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[auditLog.list] Reading audit log list...');
    },
    onSuccess: (result) => {
      console.log(
        `[auditLog.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[auditLog.list] Read failed:', error.message);
    },
  },
};
