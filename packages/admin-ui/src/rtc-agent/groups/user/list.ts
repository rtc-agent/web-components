import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query admin user list
 *
 * Permission required: admin_user:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.admin.list)
 * - Page API reads data from service layer
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listUsers: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query admin user list on /system/users page. Supports pagination and keyword search. Returns users currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'admin_user', action: 'read' }],

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
    keyword: withMeta(z.string(), { example: 'admin@example.com' })
      .optional()
      .describe(
        'Search keyword to filter users by email or name. Leave empty to return all users.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('Admin user ID'),
              email: z.string().describe('Email address'),
              name: z.string().optional().describe('Display name'),
              is_enabled: z.boolean().optional().describe('Whether enabled'),
              created_at: z.string().optional().describe('Creation time'),
              updated_at: z.string().optional().describe('Update time'),
            }),
          )
          .describe('Admin user list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('Admin user list query result'),
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

    // Build query params for URL
    const queryParams: Record<string, string> = {};
    if (keyword) {
      queryParams.keyword = keyword;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('admin', '/system/users', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.list({ current, pageSize, keyword });
  },

  hooks: {
    onStart: () => {
      console.log('[admin.list] Reading admin user list...');
    },
    onSuccess: (result) => {
      console.log(
        `[admin.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[admin.list] Read failed:', error.message);
    },
  },
};
