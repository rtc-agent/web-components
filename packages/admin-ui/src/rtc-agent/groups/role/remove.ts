import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Delete admin role
 *
 * Permission required: role:write
 *
 * Implementation:
 * - Calls page API to trigger delete flow
 * - Page API internally uses React patterns (mutation)
 * - Table auto-refreshes after successful deletion
 */
export const removeRole: PermissionAwareFunctionDef = {
  name: 'remove',
  description:
    'Delete admin roles, the table will auto-refresh after successful deletion',

  requiredPermissions: [{ resource: 'role', action: 'write' }],

  zodSchema: z.object({
    ids: withMeta(z.array(z.string()), { example: ['01a10622-...'] }).describe(
      'List of admin role IDs to delete',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        deletedCount: z.number().optional().describe('Number of deleted roles'),
      })
      .describe('Deletion result'),
  },

  handler: async (params) => {
    const { ids } = params as { ids: string[] };

    // Ensure page is loaded
    await ensurePageLoaded('role', '/system/roles');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.role;
    if (!pageAPI) {
      throw new Error('Role page failed to load. Please try again.');
    }

    return await pageAPI.remove(ids);
  },

  hooks: {
    onStart: (params) => {
      const ids = (params as any)?.ids || [];
      console.log(`[role.remove] Deleting ${ids.length} admin role(s)...`);
    },
    onSuccess: (result) => {
      console.log(
        `[role.remove] Deletion successful, deleted ${(result as any).deletedCount || 1} role(s)`,
      );
    },
    onError: (error) => {
      console.error('[role.remove] Deletion failed:', error.message);
    },
  },
};
