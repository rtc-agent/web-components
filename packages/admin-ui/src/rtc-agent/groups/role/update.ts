import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Update admin role
 *
 * Permission required: role:write
 *
 * Implementation:
 * - Calls page API to trigger update flow
 * - Page API internally uses React patterns
 * - Table auto-refreshes after successful update
 */
export const updateRole: PermissionAwareFunctionDef = {
  name: 'update',
  description:
    'Update admin role information on /system/roles page. Requires role id. Can update name, display_name, description, and/or is_enabled. Table auto-refreshes after successful update.',

  requiredPermissions: [{ resource: 'role', action: 'write' }],

  zodSchema: z.object({
    id: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin role ID to update. Required to identify which role to modify.',
    ),
    name: withMeta(z.string(), { example: 'editor' })
      .optional()
      .describe(
        'New unique role name identifier. Must remain unique across all roles.',
      ),
    display_name: withMeta(z.string(), { example: 'Editor' })
      .optional()
      .describe('New human-readable display name shown in UI.'),
    description: withMeta(z.string(), {
      example: 'A role that can edit content',
    })
      .optional()
      .describe('New description explaining the role purpose and permissions.'),
    is_enabled: withMeta(z.boolean(), { example: true })
      .optional()
      .describe('Whether the role is active and can be assigned to users.'),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Update result'),
  },

  handler: async (params) => {
    const { id, name, display_name, description, is_enabled } = params as {
      id: string;
      name?: string;
      display_name?: string;
      description?: string;
      is_enabled?: boolean;
    };

    // Ensure page is loaded
    await ensurePageLoaded('role', '/system/roles');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.role;
    if (!pageAPI) {
      throw new Error('Role page failed to load. Please try again.');
    }

    return await pageAPI.update({
      id,
      name,
      display_name,
      description,
      is_enabled,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[role.update] Updating admin role...');
    },
    onSuccess: () => {
      console.log('[role.update] Update successful');
    },
    onError: (error) => {
      console.error('[role.update] Update failed:', error.message);
    },
  },
};
