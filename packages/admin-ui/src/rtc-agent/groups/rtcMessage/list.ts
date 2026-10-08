import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Query RTC message list
 *
 * Permission required: rtc_message:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcMessage.list)
 * - Page API reads data from service layer
 * - Returned data matches what is displayed in the UI table
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */

export const listRtcMessages: PermissionAwareFunctionDef = {
  name: 'list',
  description:
    'Query RTC message list on /rtc-users/messages page. Supports pagination, role filter (user/assistant), time range filter, and sorting. Requires session_id to filter messages by session. Returns messages currently displayed in the UI table.',

  requiredPermissions: [{ resource: 'rtc_message', action: 'read' }],

  zodSchema: z.object({
    sessionId: withMeta(z.string(), { example: 'sess_001' }).describe(
      'RTC session ID to filter messages. Required — messages are always scoped to a specific session.',
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
    role: withMeta(z.enum(['user', 'assistant']), { example: 'user' })
      .optional()
      .describe(
        'Filter by message role: "user" or "assistant". Leave empty to return all messages regardless of role.',
      ),
    startTime: withMeta(z.string(), { example: '2026-01-01T00:00:00Z' })
      .optional()
      .describe(
        'Start of time range filter (ISO 8601 format). Messages created before this time will be excluded.',
      ),
    endTime: withMeta(z.string(), { example: '2026-12-31T23:59:59Z' })
      .optional()
      .describe(
        'End of time range filter (ISO 8601 format). Messages created after this time will be excluded.',
      ),
    sortBy: withMeta(z.string(), { example: 'created_at' })
      .optional()
      .describe(
        'Field to sort results by. Common values: "created_at", "input_tokens", "output_tokens", "global_offset".',
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
              id: z.string().describe('Message ID'),
              session_id: z
                .string()
                .describe('Session ID this message belongs to'),
              role: z
                .enum(['user', 'assistant'])
                .describe('Message role: user or assistant'),
              content: z.string().describe('Message content (JSON string)'),
              created_at: z.string().describe('Message creation time'),
              global_offset: z
                .number()
                .describe('Global offset in the session'),
              input_tokens: z
                .number()
                .nullable()
                .describe('Input tokens consumed (null if not applicable)'),
              output_tokens: z
                .number()
                .nullable()
                .describe('Output tokens consumed (null if not applicable)'),
              total_tokens: z
                .number()
                .nullable()
                .describe('Total tokens consumed (null if not applicable)'),
            }),
          )
          .describe('RTC message list (matches UI table display)'),
        total: z.number().describe('Total count'),
      })
      .describe('RTC message list query result'),
  },

  handler: async (params) => {
    const {
      sessionId,
      current = 1,
      pageSize = 10,
      role,
      startTime,
      endTime,
      sortBy,
      sortOrder,
    } = params as {
      sessionId: string;
      current?: number;
      pageSize?: number;
      role?: string;
      startTime?: string;
      endTime?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    if (!sessionId) {
      throw new Error(
        'sessionId is required to query messages. Messages are scoped to a specific session.',
      );
    }

    // Build query params for URL
    const queryParams: Record<string, string> = {
      session_id: sessionId,
    };
    if (role) {
      queryParams.role = role;
    }
    if (startTime) {
      queryParams.created_after = startTime;
    }
    if (endTime) {
      queryParams.created_before = endTime;
    }

    // Ensure page is loaded (with query params in URL)
    await ensurePageLoaded('rtcMessage', '/rtc-users/messages', queryParams);

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.rtcMessage;
    if (!pageAPI) {
      throw new Error('RTC message page failed to load. Please try again.');
    }

    return await pageAPI.list({
      current,
      pageSize,
      sessionId,
      role,
      startTime,
      endTime,
      sortBy,
      sortOrder,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[rtcMessage.list] Reading RTC message list...');
    },
    onSuccess: (result) => {
      console.log(
        `[rtcMessage.list] Read successful, total ${(result as any).total} records`,
      );
    },
    onError: (error) => {
      console.error('[rtcMessage.list] Read failed:', error.message);
    },
  },
};
