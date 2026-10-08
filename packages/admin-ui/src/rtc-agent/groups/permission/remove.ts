import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Delete admin permission policies
 *
 * Permission required: permission:write
 *
 * Implementation:
 * - Calls page API to trigger delete flow
 * - Table auto-refreshes after successful deletion
 *
 * Note: Permission uses composite key (role_id, resource, action) for deletion
 */
export const removePermissionPolicies: PermissionAwareFunctionDef = {
  name: 'remove',
  description:
    'Delete one or more permission policies on /system/permissions page. Requires array of items with composite keys (role_id, resource, action). Table auto-refreshes after successful deletion.',

  requiredPermissions: [{ resource: 'permission', action: 'write' }],

  zodSchema: z.object({
    items: withMeta(
      z.array(
        z.object({
          role_id: z.string().describe('Admin role ID that has the permission'),
          resource: z.string().describe('Resource type being protected'),
          action: z.string().describe('Action type being revoked'),
        }),
      ),
      {
        example: [
          { role_id: '01a10622-...', resource: 'role', action: 'read' },
        ],
      },
    ).describe(
      'Array of permission policies to delete. Each item uses composite key (role_id, resource, action) to identify the permission.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        deletedCount: z
          .number()
          .optional()
          .describe('Number of deleted permission policies'),
      })
      .describe('Deletion result'),
  },

  handler: async (params) => {
    const { items } = params as {
      items: Array<{ role_id: string; resource: string; action: string }>;
    };

    // Ensure page is loaded
    await ensurePageLoaded('permission', '/system/permissions');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.permission;
    if (!pageAPI) {
      throw new Error('Permission page failed to load. Please try again.');
    }

    return await pageAPI.remove(items);
  },

  hooks: {
    onStart: (params) => {
      const items = (params as any)?.items || [];
      console.log(
        `[permission.remove] Deleting ${items.length} permission policy(ies)...`,
      );
    },
    onSuccess: (result) => {
      console.log(
        `[permission.remove] Deletion successful, deleted ${(result as any).deletedCount || 1} policy(ies)`,
      );
    },
    onError: (error) => {
      console.error('[permission.remove] Deletion failed:', error.message);
    },
  },
};
