import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Delete server config (reset to YAML default)
 *
 * Permission required: server_config:delete
 *
 * Implementation:
 * - Calls page API to trigger delete flow
 * - Table auto-refreshes after successful deletion
 */
export const removeServerConfig: PermissionAwareFunctionDef = {
  name: 'remove',
  description:
    'Delete a server configuration on /system/configs page (resets to YAML default value). Requires config key and current version for optimistic locking. Table auto-refreshes after successful deletion.',

  requiredPermissions: [{ resource: 'server_config', action: 'delete' }],

  zodSchema: z.object({
    key: withMeta(z.string(), { example: 'llm.model_name' }).describe(
      'Configuration key to delete. The config will be reset to its YAML default value.',
    ),
    version: withMeta(z.number(), { example: 1 }).describe(
      'Current version number for optimistic locking. Required to prevent concurrent deletions.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
      })
      .describe('Deletion result'),
  },

  handler: async (params) => {
    const { key, version } = params as { key: string; version: number };

    // Ensure page is loaded
    await ensurePageLoaded('serverConfig', '/system/configs');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.serverConfig;
    if (!pageAPI) {
      throw new Error('Server config page failed to load. Please try again.');
    }

    return await pageAPI.remove({ key, version });
  },

  hooks: {
    onStart: (params) => {
      const key = (params as any)?.key || '';
      console.log(`[serverConfig.remove] Deleting config: ${key}...`);
    },
    onSuccess: () => {
      console.log('[serverConfig.remove] Deletion successful');
    },
    onError: (error) => {
      console.error('[serverConfig.remove] Deletion failed:', error.message);
    },
  },
};
