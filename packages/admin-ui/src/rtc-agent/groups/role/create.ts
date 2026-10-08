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
  description:
    'Create a new admin role on /system/roles page. Requires name, display_name, and optional description and is_enabled. Table auto-refreshes after successful creation.',

  requiredPermissions: [{ resource: 'role', action: 'write' }],

  zodSchema: z.object({
    name: withMeta(z.string(), { example: 'editor' }).describe(
      'Unique role name identifier. Used internally to reference the role. Must be unique across all roles.',
    ),
    display_name: withMeta(z.string(), { example: 'Editor' }).describe(
      'Human-readable display name shown in UI tables and forms.',
    ),
    description: withMeta(z.string(), {
      example: 'A role that can edit content',
    })
      .optional()
      .describe(
        'Optional description explaining the role purpose and permissions.',
      ),
    is_enabled: withMeta(z.boolean(), { example: true })
      .optional()
      .describe(
        'Whether the role is active and can be assigned to users. Defaults to true.',
      ),
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
      console.log(
        `[role.create] Creation successful, ID: ${(result as any).id}`,
      );
    },
    onError: (error) => {
      console.error('[role.create] Creation failed:', error.message);
    },
  },
};
