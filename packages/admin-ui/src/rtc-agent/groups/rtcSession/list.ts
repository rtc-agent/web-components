import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query RTC session list
 *
 * Permission required: rtc_session:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcSession.list)
 * - Page API reads data from service layer
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const listRtcSessions: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query RTC session list on /rtc-users/sessions page. Supports pagination, keyword search, status filter (active/closed), time range filter, and sorting. Requires user_id to filter sessions by user. Returns sessions currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'rtc_session', action: 'read' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), { example: 'usr_001' }).describe(
      'RTC user ID to filter sessions. Required — sessions are always scoped to a specific user.',
    ),
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
    status: withMeta(z.enum(['active', 'closed']), { example: 'active' })
      .optional()
      .describe(
        'Filter by session status: "active" or "closed". Leave empty to return all sessions regardless of status.',
      ),
    search: withMeta(z.string(), { example: 'debug' })
      .optional()
      .describe(
        'Search keyword to filter sessions by title or content. Leave empty to return all sessions.',
      ),
    startTime: withMeta(z.string(), { example: '2026-01-01T00:00:00Z' })
      .optional()
      .describe(
        'Start of time range filter (ISO 8601 format). Sessions created before this time will be excluded.',
      ),
    endTime: withMeta(z.string(), { example: '2026-12-31T23:59:59Z' })
      .optional()
      .describe(
        'End of time range filter (ISO 8601 format). Sessions created after this time will be excluded.',
      ),
    sortBy: withMeta(z.string(), { example: 'created_at' })
      .optional()
      .describe(
        'Field to sort results by. Common values: "created_at", "updated_at", "total_tokens".',
      ),
    sortOrder: withMeta(z.enum(['asc', 'desc']), { example: 'desc' })
      .optional()
      .describe(
        'Sort order: "asc" for ascending, "desc" for descending. Use with sortBy.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('Session ID'),
              client_id: z.string().describe('Client ID'),
              title: z.string().describe('Session title'),
              status: z
                .enum(['active', 'closed'])
                .describe('Session status: active or closed'),
              created_at: z.string().describe('Session creation time'),
              updated_at: z.string().describe('Last activity time'),
              total_input_tokens: z
                .number()
                .describe('Total input tokens consumed'),
              total_output_tokens: z
                .number()
                .describe('Total output tokens consumed'),
              total_tokens: z
                .number()
                .describe('Total tokens consumed (input + output)'),
              total_cached_read_tokens: z
                .number()
                .describe('Total cached read tokens'),
              total_cost_micros: z
                .number()
                .describe('Total cost in micros (millionths)'),
            }),
          )
          .describe('RTC session list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('RTC session list query result'),
  },

  handler: async (params) => {
    const {
      userId,
      current = 1,
      pageSize = 10,
      status,
      search,
      startTime,
      endTime,
      sortBy,
      sortOrder,
    } = params as {
      userId: string;
      current?: number;
      pageSize?: number;
      status?: string;
      search?: string;
      startTime?: string;
      endTime?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    if (!userId) {
      throw new Error(
        'userId is required to query sessions. Sessions are scoped to a specific user.',
      );
    }

    // Build query params for URL
    const queryParams: Record<string, string> = {
      user_id: userId,
    };
    if (status) {
      queryParams.status = status;
    }
    if (search) {
      queryParams.search = search;
    }
    if (startTime) {
      queryParams.start_time = startTime;
    }
    if (endTime) {
      queryParams.end_time = endTime;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('rtcSession', '/rtc-users/sessions', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.rtcSession;
    if (!pageAPI) {
      throw new Error('RTC session page failed to load. Please try again.');
    }

    return await pageAPI.list({
      current,
      pageSize,
      userId,
      status,
      search,
      startTime,
      endTime,
      sortBy,
      sortOrder,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[rtcSession.list] Reading RTC session list...');
    },
    onSuccess: (result) => {
      console.log(
        `[rtcSession.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[rtcSession.list] Read failed:', error.message);
    },
  },
};
