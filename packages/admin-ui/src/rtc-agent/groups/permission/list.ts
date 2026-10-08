import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query admin permission policy list
 *
 * Permission required: permission:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.permission.list)
 * - Page API calls the backend API via service function
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listPermissions: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query admin permission policy list on /system/permissions page. Supports pagination and filtering by role_id and resource. Returns permissions currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'permission', action: 'read' }],

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
    role_id: withMeta(z.string(), { example: '01a10622-...' })
      .optional()
      .describe(
        'Filter permissions by admin role ID. Returns only permissions granted to the specified role.',
      ),
    resource: withMeta(z.string(), { example: 'role' })
      .optional()
      .describe(
        'Filter by resource type (e.g., admin_user, role, permission, admin_user_role, audit_log). Returns only permissions for the specified resource.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              role_id: z.string().describe('Admin role ID'),
              resource: z.string().describe('Resource type'),
              action: z
                .string()
                .describe('Action type (read, write, delete, ban)'),
            }),
          )
          .describe('Permission policy list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('Permission policy list query result'),
  },

  handler: async (params) => {
    const {
      current = 1,
      pageSize = 20,
      role_id,
      resource,
    } = params as {
      current?: number;
      pageSize?: number;
      role_id?: string;
      resource?: string;
    };

    // Build query params for URL
    const queryParams: Record<string, string> = {};
    if (role_id) {
      queryParams.role_id = role_id;
    }
    if (resource) {
      queryParams.resource = resource;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('permission', '/system/permissions', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.permission;
    if (!pageAPI) {
      throw new Error('Permission page failed to load. Please try again.');
    }

    return await pageAPI.list({ current, pageSize, role_id, resource });
  },

  hooks: {
    onStart: () => {
      console.log('[permission.list] Reading permission policy list...');
    },
    onSuccess: (result) => {
      console.log(
        `[permission.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[permission.list] Read failed:', error.message);
    },
  },
};
