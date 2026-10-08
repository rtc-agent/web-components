import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Update server config value
 *
 * Permission required: server_config:write
 *
 * Implementation:
 * - Calls page API to update config value
 * - Table auto-refreshes after successful update
 */
export const updateServerConfig: PermissionAwareFunctionDef = {
  name: 'update',
  description:
    'Update a server configuration value on /system/configs page. Requires config key and new value. Optional version for optimistic locking and change_note for audit trail. Table auto-refreshes after successful update.',

  requiredPermissions: [{ resource: 'server_config', action: 'write' }],

  zodSchema: z.object({
    key: withMeta(z.string(), { example: 'llm.model_name' }).describe(
      'Configuration key to update. Must match an existing config key in the system.',
    ),
    value: withMeta(z.unknown(), { example: 'gpt-4' }).describe(
      'New configuration value. Type must match the config value_type (string, int, float, bool, duration, json).',
    ),
    version: withMeta(z.number(), { example: 1 })
      .optional()
      .describe(
        'Current version number for optimistic locking. Prevents concurrent updates. Omit to skip version check.',
      ),
    change_note: withMeta(z.string(), { example: 'Upgrade to GPT-4' })
      .optional()
      .describe(
        'Note explaining the change reason. Recorded in audit trail for accountability.',
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
    const { key, value, version, change_note } = params as {
      key: string;
      value: unknown;
      version?: number;
      change_note?: string;
    };

    // Ensure page is loaded
    await ensurePageLoaded('serverConfig', '/system/configs');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.serverConfig;
    if (!pageAPI) {
      throw new Error('Server config page failed to load. Please try again.');
    }

    return await pageAPI.update({
      key,
      value,
      version,
      change_note,
    });
  },

  hooks: {
    onStart: (params) => {
      const key = (params as any)?.key || '';
      console.log(`[serverConfig.update] Updating config: ${key}...`);
    },
    onSuccess: () => {
      console.log('[serverConfig.update] Update successful');
    },
    onError: (error) => {
      console.error('[serverConfig.update] Update failed:', error.message);
    },
  },
};
