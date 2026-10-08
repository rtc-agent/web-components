import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Get RTC user token statistics
 *
 * Permission required: rtc_user:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcUser.tokenStats)
 * - Page API calls getUserTokenStats service
 * - Returns token consumption data including daily stats, summary, and top sessions
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const getRtcUserTokenStats: PermissionAwareFunctionDef = {
  name: 'tokenStats',
  description:
    'Get token consumption statistics for an RTC user on /rtc-users/management page. Requires user ID and optional time range (days). Returns daily token usage breakdown, summary totals (today/week/month/all-time), and top sessions by token consumption.',

  requiredPermissions: [{ resource: 'rtc_user', action: 'read' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), {
      example: 'usr_abc123',
    }).describe(
      'The ID of the RTC user whose token statistics to retrieve. Must be a valid user ID.',
    ),
    days: withMeta(z.number().int().positive(), { example: 30 })
      .optional()
      .describe(
        'Number of days to include in the statistics. Defaults to 30. Controls the time range for daily_stats breakdown.',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .object({
            daily_stats: z
              .array(
                z.object({
                  date: z.string().describe('Date string (YYYY-MM-DD)'),
                  total_tokens: z
                    .number()
                    .describe('Total tokens used on this date'),
                  total_input_tokens: z
                    .number()
                    .describe('Total input tokens on this date'),
                  total_output_tokens: z
                    .number()
                    .describe('Total output tokens on this date'),
                  total_cached_read_tokens: z
                    .number()
                    .describe('Total cached read tokens on this date'),
                }),
              )
              .describe('Daily token usage breakdown'),
            summary: z
              .object({
                today_tokens: z.number().describe('Tokens used today'),
                week_tokens: z.number().describe('Tokens used this week'),
                month_tokens: z.number().describe('Tokens used this month'),
                total_tokens: z.number().describe('Total tokens used all time'),
              })
              .describe('Token usage summary'),
            top_sessions: z
              .array(
                z.object({
                  session_id: z.string().describe('Session ID'),
                  title: z.string().describe('Session title'),
                  total_tokens: z
                    .number()
                    .describe('Total tokens consumed in this session'),
                  created_at: z.string().describe('Session creation time'),
                }),
              )
              .describe('Top sessions by token consumption'),
          })
          .describe('Token statistics data'),
      })
      .describe('Token statistics query result'),
  },

  handler: async (params) => {
    const { userId, days } = params as {
      userId: string;
      days?: number;
    };

    // Ensure page is loaded
    await ensurePageLoaded('rtcUser', '/rtc-users/management');

    // Page is loaded, call API directly
    const pageAPI = window.__pages__?.rtcUser;
    if (!pageAPI) {
      throw new Error(
        'RTC user management page failed to load. Please try again.',
      );
    }

    return await pageAPI.tokenStats(userId, days);
  },

  hooks: {
    onStart: (params) => {
      const { userId, days } = params as { userId: string; days?: number };
      console.log(
        `[rtcUser.tokenStats] Fetching token stats for user: ${userId}, days: ${days || 30}...`,
      );
    },
    onSuccess: (result) => {
      const data = (result as any).data;
      const totalTokens = data?.summary?.total_tokens ?? 0;
      console.log(
        `[rtcUser.tokenStats] Fetched successfully, total tokens: ${totalTokens}`,
      );
    },
    onError: (error) => {
      console.error('[rtcUser.tokenStats] Fetch failed:', error.message);
    },
  },
};
