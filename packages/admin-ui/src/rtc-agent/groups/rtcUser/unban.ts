import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Unban an RTC user
 *
 * Permission required: rtc_user:ban
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcUser.unban)
 * - Page API calls unbanRtcUser service, then refreshes the table
 * - User status changes from "banned" to "active" in the UI
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const unbanRtcUserFn: PermissionAwareFunctionDef = {
  name: 'unban',
  description:
    'Unban an RTC user on /rtc-users/management page. Requires user ID. The user status changes to "active" in the UI table after successful operation.',

  requiredPermissions: [{ resource: 'rtc_user', action: 'ban' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), {
      example: 'usr_abc123',
    }).describe(
      'The ID of the RTC user to unban. Must be a valid user ID that is currently banned.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z
          .boolean()
          .describe('Whether the unban operation was successful'),
      })
      .describe('Unban operation result'),
  },

  handler: async (params) => {
    const { userId } = params as {
      userId: string;
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

    return await pageAPI.unban(userId);
  },

  hooks: {
    onStart: (params) => {
      const { userId } = params as { userId: string };
      console.log(`[rtcUser.unban] Unbanning user: ${userId}...`);
    },
    onSuccess: (_result) => {
      console.log('[rtcUser.unban] User unbanned successfully');
    },
    onError: (error) => {
      console.error('[rtcUser.unban] Unban failed:', error.message);
    },
  },
};
