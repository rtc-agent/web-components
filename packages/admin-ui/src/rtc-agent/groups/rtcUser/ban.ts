import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Ban an RTC user
 *
 * Permission required: rtc_user:ban
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcUser.ban)
 * - Page API calls banRtcUser service, then refreshes the table
 * - User status changes from "active" to "banned" in the UI
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const banRtcUserFn: PermissionAwareFunctionDef = {
  name: 'ban',
  description:
    'Ban an RTC user on /rtc-users/management page. Requires user ID and a ban reason. The user status changes to "banned" in the UI table after successful operation.',

  requiredPermissions: [{ resource: 'rtc_user', action: 'ban' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), {
      example: 'usr_abc123',
    }).describe(
      'The ID of the RTC user to ban. Must be a valid user ID that exists in the system.',
    ),
    reason: withMeta(z.string(), {
      example: 'Violation of terms of service',
    }).describe(
      'Reason for banning the user. This reason is recorded and displayed in the UI. Must be a non-empty string.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z
          .boolean()
          .describe('Whether the ban operation was successful'),
      })
      .describe('Ban operation result'),
  },

  handler: async (params) => {
    const { userId, reason } = params as {
      userId: string;
      reason: string;
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

    return await pageAPI.ban({ userId, reason });
  },

  hooks: {
    onStart: (params) => {
      const { userId } = params as { userId: string };
      console.log(`[rtcUser.ban] Banning user: ${userId}...`);
    },
    onSuccess: (_result) => {
      console.log('[rtcUser.ban] User banned successfully');
    },
    onError: (error) => {
      console.error('[rtcUser.ban] Ban failed:', error.message);
    },
  },
};
