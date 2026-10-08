import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Get RTC user devices
 *
 * Permission required: rtc_user:read
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.rtcUser.devices)
 * - Page API calls getUserDevices service
 * - Returns device list for the specified user
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const getRtcUserDevices: PermissionAwareFunctionDef = {
  name: 'devices',
  description:
    'Get device list for an RTC user on /rtc-users/management page. Requires user ID. Returns all devices registered for the user, including online status, device name, and last active time.',

  requiredPermissions: [{ resource: 'rtc_user', action: 'read' }],

  zodSchema: z.object({
    userId: withMeta(z.string(), {
      example: 'usr_abc123',
    }).describe(
      'The ID of the RTC user whose devices to retrieve. Must be a valid user ID.',
    ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether successful'),
        data: z
          .array(
            z.object({
              id: z.string().describe('Device record ID'),
              user_id: z.string().describe('User ID this device belongs to'),
              device_id: z.string().describe('Unique device identifier'),
              name: z.string().describe('Device display name'),
              user_agent: z.string().describe('Browser user agent string'),
              last_active_at: z.string().describe('Last activity timestamp'),
              created_at: z.string().describe('Device registration time'),
              is_online: z
                .boolean()
                .describe('Whether device is currently online'),
            }),
          )
          .describe('Device list for the user'),
      })
      .describe('User devices query result'),
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

    return await pageAPI.devices(userId);
  },

  hooks: {
    onStart: (params) => {
      const { userId } = params as { userId: string };
      console.log(`[rtcUser.devices] Fetching devices for user: ${userId}...`);
    },
    onSuccess: (result) => {
      const data = (result as any).data;
      console.log(
        `[rtcUser.devices] Fetched ${Array.isArray(data) ? data.length : 0} devices successfully`,
      );
    },
    onError: (error) => {
      console.error('[rtcUser.devices] Fetch failed:', error.message);
    },
  },
};
