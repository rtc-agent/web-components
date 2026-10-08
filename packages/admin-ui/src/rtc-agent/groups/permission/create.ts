import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Create admin permission policy
 *
 * Permission required: permission:write
 *
 * Implementation:
 * - Calls page API to create a new permission policy
 * - Table auto-refreshes after successful creation
 *
 * Note: Permission uses composite key (role_id, resource, action)
 */
export const createPermissionPolicy: PermissionAwareFunctionDef = {
  name: 'create',
  description:
    'Create a new permission policy on /system/permissions page. Requires role_id, resource, and action. Table auto-refreshes after successful creation.',

  requiredPermissions: [{ resource: 'permission', action: 'write' }],

  zodSchema: z.object({
    role_id: withMeta(z.string(), { example: '01a10622-...' }).describe(
      'Admin role ID to grant the permission to. The role must exist in the system.',
    ),
    resource: withMeta(z.string(), { example: 'role' }).describe(
      'Resource type being protected (e.g., admin_user, role, permission, admin_user_role, audit_log, server_config).',
    ),
    action: withMeta(z.string(), { example: 'read' }).describe(
      'Action type being granted: read (view), write (create/update), delete (remove), or ban (block).',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Creation result'),
  },

  handler: async (params) => {
    const { role_id, resource, action } = params as {
      role_id: string;
      resource: string;
      action: string;
    };

    // Ensure page is loaded
    await ensurePageLoaded('permission', '/system/permissions');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.permission;
    if (!pageAPI) {
      throw new Error('Permission page failed to load. Please try again.');
    }

    return await pageAPI.create({ role_id, resource, action });
  },

  hooks: {
    onStart: () => {
      console.log('[permission.create] Creating permission policy...');
    },
    onSuccess: () => {
      console.log('[permission.create] Creation successful');
    },
    onError: (error) => {
      console.error('[permission.create] Creation failed:', error.message);
    },
  },
};
