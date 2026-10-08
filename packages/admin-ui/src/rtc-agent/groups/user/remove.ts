import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Delete admin users
 *
 * Permission required: admin_user:delete
 *
 * Implementation:
 * - Calls page API to trigger delete flow
 * - Page API internally uses React patterns (mutation)
 * - Table auto-refreshes after successful deletion
 *
 * Note: Delete API is not yet implemented in the service layer.
 * This function currently returns success: false.
 */
export const removeAdminUsers: PermissionAwareFunctionDef = {
  name: 'remove',
  description:
    'Delete one or more admin users on /system/users page. Requires array of user ids. Note: Delete API is not yet implemented in service layer. Table auto-refreshes after successful deletion.',

  requiredPermissions: [{ resource: 'admin_user', action: 'delete' }],

  zodSchema: z.object({
    ids: withMeta(z.array(z.string()), { example: ['01a10622-...'] }).describe(
      'Array of admin user IDs to delete. All specified users will be removed from the system.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        deletedCount: z.number().optional().describe('Number of deleted users'),
      })
      .describe('Deletion result'),
  },

  handler: async (params) => {
    const { ids } = params as { ids: string[] };

    // Ensure page is loaded
    await ensurePageLoaded('admin', '/system/users');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.remove(ids);
  },

  hooks: {
    onStart: (params) => {
      const ids = (params as any)?.ids || [];
      console.log(`[admin.remove] Deleting ${ids.length} admin user(s)...`);
    },
    onSuccess: (result) => {
      console.log(
        `[admin.remove] Deletion successful, deleted ${(result as any).deletedCount || 1} user(s)`,
      );
    },
    onError: (error) => {
      console.error('[admin.remove] Deletion failed:', error.message);
    },
  },
};
