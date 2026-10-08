import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Create admin user
 *
 * Permission required: admin_user:write
 *
 * Implementation:
 * - Calls page API to trigger create flow
 * - Page API internally uses React patterns (actionRef, mutation)
 * - Table auto-refreshes after successful creation
 */
export const createAdminUser: PermissionAwareFunctionDef = {
  name: 'create',
  description:
    'Create a new admin user on /system/users page. Requires email, password, and optional name and role_ids. Table auto-refreshes after successful creation.',

  requiredPermissions: [{ resource: 'admin_user', action: 'write' }],

  zodSchema: z.object({
    email: withMeta(z.string().email(), {
      example: 'admin@example.com',
    }).describe(
      'Email address for the new admin user. Must be unique across all users. Used as login credential.',
    ),
    password: withMeta(z.string(), { example: 'SecurePass123!' }).describe(
      'Password for the new admin user. Must meet password complexity requirements.',
    ),
    name: withMeta(z.string(), { example: 'John Doe' })
      .optional()
      .describe(
        'Display name for the admin user. Shown in UI tables and audit logs.',
      ),
    role_ids: withMeta(z.array(z.string()), {
      example: ['role-id-1', 'role-id-2'],
    })
      .optional()
      .describe(
        'Array of role IDs to assign to the new user. Roles determine user permissions.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        id: z.string().optional().describe('Newly created admin user ID'),
      })
      .describe('Creation result'),
  },

  handler: async (params) => {
    const { email, password, name, role_ids } = params as {
      email: string;
      password: string;
      name?: string;
      role_ids?: string[];
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

    return await pageAPI.create({
      email,
      password,
      name,
      role_ids,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[admin.create] Creating admin user...');
    },
    onSuccess: (result) => {
      console.log(
        `[admin.create] Creation successful, ID: ${(result as any).id}`,
      );
    },
    onError: (error) => {
      console.error('[admin.create] Creation failed:', error.message);
    },
  },
};
