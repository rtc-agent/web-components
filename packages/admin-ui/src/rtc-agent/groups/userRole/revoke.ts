import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Revoke a role from an admin user
 *
 * Permission required: admin_user_role:write
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.admin.revokeRole)
 * - Page API refreshes the table after revocation
 * - Role list will auto-refresh after successful revocation
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const revokeUserRole: PermissionAwareFunctionDef = {
  name: 'revoke',
  description:
    'Revoke a specific role from an admin user on /system/users page. Requires userId and roleId. The role assignment must exist. Table auto-refreshes after successful revocation.',

  requiredPermissions: [{ resource: 'admin_user_role', action: 'write' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin user ID. Required when revoking a role from a specific user.',
    ),
    roleId: withMeta(z.string(), { example: 'role-id-1' }).describe(
      'Role ID to revoke. Must be a role currently assigned to the user.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Revocation result'),
  },

  handler: async (params) => {
    const { userId, roleId } = params as { userId: string; roleId: string };

    // Ensure page is loaded
    await ensurePageLoaded('admin', '/system/users');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.revokeRole(userId, roleId);
  },

  hooks: {
    onStart: () => {
      console.log('[adminRole.revoke] Revoking role...');
    },
    onSuccess: () => {
      console.log('[adminRole.revoke] Revocation successful');
    },
    onError: (error) => {
      console.error('[adminRole.revoke] Revocation failed:', error.message);
    },
  },
};
