import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Assign roles to an admin user
 *
 * Permission required: admin_user_role:write
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.admin.assignRoles)
 * - Page API refreshes the table after assignment
 * - Role list will auto-refresh after successful assignment
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const assignUserRoles: PermissionAwareFunctionDef = {
  name: 'assign',
  description:
    'Assign one or more roles to an admin user on /system/users page. Requires userId and roleIds array. The user must exist and roles must be valid. Table auto-refreshes after successful assignment.',

  requiredPermissions: [{ resource: 'admin_user_role', action: 'write' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin user ID. Required when assigning roles to a specific user.',
    ),
    roleIds: withMeta(z.array(z.string()), {
      example: ['role-id-1', 'role-id-2'],
    }).describe(
      'List of role IDs to assign. Must contain at least one valid role ID.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Assignment result'),
  },

  handler: async (params) => {
    const { userId, roleIds } = params as { userId: string; roleIds: string[] };

    // Ensure page is loaded
    await ensurePageLoaded('admin', '/system/users');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.assignRoles(userId, roleIds);
  },

  hooks: {
    onStart: (params) => {
      const ids = (params as any)?.roleIds || [];
      console.log(`[adminRole.assign] Assigning ${ids.length} role(s)...`);
    },
    onSuccess: () => {
      console.log('[adminRole.assign] Assignment successful');
    },
    onError: (error) => {
      console.error('[adminRole.assign] Assignment failed:', error.message);
    },
  },
};
