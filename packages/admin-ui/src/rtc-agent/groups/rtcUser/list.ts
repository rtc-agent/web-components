import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query RTC user list
 *
 * Permission required: rtc_user:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcUser.list)
 * - Page API reads data from service layer
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listRtcUsers: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query RTC user list on /rtc-users/management page. Supports pagination, keyword search (by email or name), and status filter (active/banned). Returns users currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'rtc_user', action: 'read' }],

  zodSchema: z.object({
    current: withMeta(z.number().int().positive(), { example: 1 })
      .optional()
      .describe(
        'Current page number for pagination. Defaults to 1. Use with pageSize to control result set size.',
      ),
    pageSize: withMeta(z.number().int().positive(), { example: 10 })
      .optional()
      .describe(
        'Number of items per page for pagination. Defaults to 10. Use with current to navigate through results.',
      ),
    search: withMeta(z.string(), { example: 'john@example.com' })
      .optional()
      .describe(
        'Search keyword to filter users by email or name. Leave empty to return all users.',
      ),
    status: withMeta(z.enum(['active', 'banned']), { example: 'active' })
      .optional()
      .describe(
        'Filter by user status: "active" or "banned". Leave empty to return all users regardless of status.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('RTC user ID'),
              provider: z.string().describe('Authentication provider'),
              sub: z.string().describe('Subject identifier from provider'),
              email: z.string().optional().describe('Email address'),
              name: z.string().optional().describe('Display name'),
              avatar_url: z.string().optional().describe('Avatar URL'),
              status: z
                .enum(['active', 'banned'])
                .describe('User status: active or banned'),
              banned_at: z
                .string()
                .optional()
                .describe('Timestamp when user was banned'),
              banned_reason: z
                .string()
                .optional()
                .describe('Reason for ban, if banned'),
              created_at: z.string().describe('Account creation time'),
              updated_at: z.string().describe('Last update time'),
            }),
          )
          .describe('RTC user list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('RTC user list query result'),
  },

  handler: async (params) => {
    const {
      current = 1,
      pageSize = 10,
      search,
      status,
    } = params as {
      current?: number;
      pageSize?: number;
      search?: string;
      status?: string;
    };

    // Build query params for URL
    const queryParams: Record<string, string> = {};
    if (search) {
      queryParams.search = search;
    }
    if (status) {
      queryParams.status = status;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('rtcUser', '/rtc-users/management', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.rtcUser;
    if (!pageAPI) {
      throw new Error(
        'RTC user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.list({ current, pageSize, search, status });
  },

  hooks: {
    onStart: () => {
      console.log('[rtcUser.list] Reading RTC user list...');
    },
    onSuccess: (result) => {
      console.log(
        `[rtcUser.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[rtcUser.list] Read failed:', error.message);
    },
  },
};
