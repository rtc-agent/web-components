import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Create admin role
 *
 * Permission required: role:write
 *
 * Implementation:
 * - Calls page API to trigger create flow
 * - Page API internally uses React patterns (actionRef, mutation)
 * - Table auto-refreshes after successful creation
 */
export const createRole: PermissionAwareFunctionDef = {
  name: 'create',
  description: 'Create a new admin role, the table will auto-refresh after successful creation',

  requiredPermissions: [{ resource: 'role', action: 'write' }],

  zodSchema: z.object({
    name: withMeta(z.string(), { example: 'editor' }).describe(
      'Admin role name (unique identifier)',
    ),
    display_name: withMeta(z.string(), { example: 'Editor' }).describe(
      'Display name',
    ),
    description: withMeta(z.string(), { example: 'A role that can edit content' })
      .optional()
      .describe('Admin role description'),
    is_enabled: withMeta(z.boolean(), { example: true })
      .optional()
      .describe('Whether enabled, defaults to true'),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        id: z.string().optional().describe('Newly created admin role ID'),
      })
      .describe('Creation result'),
  },

  handler: async (params) => {
    const {
      name,
      display_name,
      description,
      is_enabled = true,
    } = params as {
      name: string;
      display_name: string;
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

    return await pageAPI.create({
      name,
      display_name,
      description,
      is_enabled,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[role.create] Creating admin role...');
    },
    onSuccess: (result) => {
      console.log(`[role.create] Creation successful, ID: ${(result as any).id}`);
    },
    onError: (error) => {
      console.error('[role.create] Creation failed:', error.message);
    },
  },
};
