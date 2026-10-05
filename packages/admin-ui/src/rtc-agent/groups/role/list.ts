import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query admin role list
 *
 * Permission required: role:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.role.list)
 * - Page API reads data from React Query cache
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listRoles: PermissionAwareFunctionDef = {
  name: 'list',
  description: 'Query admin role list, returns the data currently displayed in the table',

  requiredPermissions: [{ resource: 'role', action: 'read' }],

  zodSchema: z.object({
    current: withMeta(z.number().int().positive(), { example: 1 })
      .optional()
      .describe('Current page number, defaults to 1'),
    pageSize: withMeta(z.number().int().positive(), { example: 20 })
      .optional()
      .describe('Items per page, defaults to 20'),
    keyword: withMeta(z.string(), { example: 'admin' })
      .optional()
      .describe('Keyword search (admin role name, display name, or description)'),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('Admin role ID'),
              name: z.string().describe('Admin role name'),
              display_name: z.string().describe('Display name'),
              description: z.string().optional().describe('Description'),
              is_system: z.boolean().optional().describe('Whether it is a system admin role'),
              is_enabled: z.boolean().optional().describe('Whether enabled'),
              created_at: z.string().optional().describe('Creation time'),
              updated_at: z.string().optional().describe('Update time'),
            }),
          )
          .describe('Admin role list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('Admin role list query result'),
  },

  handler: async (params) => {
    const {
      current = 1,
      pageSize = 20,
      keyword,
    } = params as {
      current?: number;
      pageSize?: number;
      keyword?: string;
    };

    // Ensure page is loaded
    await ensurePageLoaded('role', '/system/roles');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.role;
    if (!pageAPI) {
      throw new Error('Role page failed to load. Please try again.');
    }

    return await pageAPI.list({ current, pageSize, keyword });
  },

  hooks: {
    onStart: () => {
      console.log('[role.list] Reading admin role list...');
    },
    onSuccess: (result) => {
      console.log(`[role.list] Read successful, total ${(result as any).total} records`);
    },
    onError: (error) => {
      console.error('[role.list] Read failed:', error.message);
    },
  },
};
