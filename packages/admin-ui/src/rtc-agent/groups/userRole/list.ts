import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query roles assigned to an admin user
 *
 * Permission required: admin_user_role:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.admin.listUserRoles)
 * - Page API reads data from React Query cache
 * - Returned data matches what is displayed in the UI role modal
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listUserRoles: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query roles assigned to a specific admin user on /system/users page. Requires userId parameter. Returns list of role assignments including role_id, role_name, and assigned_at timestamp.',

  requiredPermissions: [{ resource: 'admin_user_role', action: 'read' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin user ID. Required when querying, assigning, or revoking roles for a specific user.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              user_id: z.string().describe('User ID'),
              role_id: z.string().describe('Role ID'),
              role_name: z.string().describe('Role display name'),
              assigned_at: z.string().describe('Assignment timestamp'),
            }),
          )
          .describe('List of role assignments'),
        total: z.number().describe('Total count'),
      })
      .describe('User role list query result'),
  },

  handler: async (params) => {
    if (!params?.userId) {
      throw new Error('userId is required');
    }
    const { userId } = params as { userId: string };

    // Ensure page is loaded
    await ensurePageLoaded('admin', '/system/users');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.listUserRoles(userId);
  },

  hooks: {
    onStart: () => {
      console.log('[adminRole.list] Querying user roles...');
    },
    onSuccess: (result) => {
      console.log(
        `[adminRole.list] Query successful, ${(result as any).total} role(s)`,
      );
    },
    onError: (error) => {
      console.error('[adminRole.list] Query failed:', error.message);
    },
  },
};
