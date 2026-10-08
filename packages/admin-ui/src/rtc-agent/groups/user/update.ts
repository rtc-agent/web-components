import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Update admin user
 *
 * Permission required: admin_user:write
 *
 * Implementation:
 * - Calls page API to trigger update flow
 * - Page API internally uses React patterns
 * - Table auto-refreshes after successful update
 */
export const updateAdminUser: PermissionAwareFunctionDef = {
  name: 'update',
  description:
    'Update admin user information on /system/users page. Requires user id. Can update name and/or password. Table auto-refreshes after successful update.',

  requiredPermissions: [{ resource: 'admin_user', action: 'write' }],

  zodSchema: z.object({
    id: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin user ID to update. Required to identify which user to modify.',
    ),
    name: withMeta(z.string(), { example: 'John Doe' })
      .optional()
      .describe(
        'New display name for the admin user. Updates the name shown in UI.',
      ),
    password: withMeta(z.string(), { example: 'NewSecurePass456!' })
      .optional()
      .describe(
        'New password for the admin user. Leave empty to keep current password unchanged.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Update result'),
  },

  handler: async (params) => {
    const { id, name, password } = params as {
      id: string;
      name?: string;
      password?: string;
    };

    // Ensure page is loaded
    await ensurePageLoaded('admin', '/system/users');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.admin;
    if (!pageAPI) {
      throw new Error(
        'Admin user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.update({
      id,
      name,
      password,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[admin.update] Updating admin user...');
    },
    onSuccess: () => {
      console.log('[admin.update] Update successful');
    },
    onError: (error) => {
      console.error('[admin.update] Update failed:', error.message);
    },
  },
};
