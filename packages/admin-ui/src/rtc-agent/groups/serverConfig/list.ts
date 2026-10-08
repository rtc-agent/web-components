import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query server config list
 *
 * Permission required: server_config:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.serverConfig.list)
 * - Page API reads data from React Query cache
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listServerConfigs: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query server configuration list on /system/configs page. Supports pagination and filtering by category. Returns configurations currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'server_config', action: 'read' }],

  zodSchema: z.object({
    current: withMeta(z.number().int().positive(), { example: 1 })
      .optional()
      .describe(
        'Current page number for pagination. Defaults to 1. Use with pageSize to control result set size.',
      ),
    pageSize: withMeta(z.number().int().positive(), { example: 20 })
      .optional()
      .describe(
        'Number of items per page for pagination. Defaults to 20. Use with current to navigate through results.',
      ),
    category: withMeta(z.string(), { example: 'llm' })
      .optional()
      .describe(
        'Filter by configuration category (llm, worker, feature, storage, system). Returns only configs in the specified category.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              key: z.string().describe('Config key'),
              value: z.unknown().describe('Current value'),
              category: z.string().describe('Category'),
              value_type: z.string().describe('Value type'),
              description: z.string().optional().describe('Description'),
              source: z.string().describe('Source (yaml or system)'),
              yaml_default: z
                .unknown()
                .optional()
                .describe('YAML default value'),
              version: z.number().describe('Version for optimistic locking'),
              change_note: z.string().optional().describe('Last change note'),
            }),
          )
          .describe('Server config list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('Server config list query result'),
  },

  handler: async (params) => {
    const {
      current = 1,
      pageSize = 20,
      category,
    } = params as {
      current?: number;
      pageSize?: number;
      category?: string;
    };

    // Build query params for URL
    const queryParams: Record<string, string> = {};
    if (category) {
      queryParams.category = category;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('serverConfig', '/system/configs', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.serverConfig;
    if (!pageAPI) {
      throw new Error('Server config page failed to load. Please try again.');
    }

    return await pageAPI.list({ current, pageSize, category });
  },

  hooks: {
    onStart: () => {
      console.log('[serverConfig.list] Reading server config list...');
    },
    onSuccess: (result) => {
      console.log(
        `[serverConfig.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[serverConfig.list] Read failed:', error.message);
    },
  },
};
