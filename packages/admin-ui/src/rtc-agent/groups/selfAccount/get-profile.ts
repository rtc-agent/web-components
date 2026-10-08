import { z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Get current user's profile information
 *
 * Permission required: none (available to all logged-in admins)
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.selfAccountCenter.getProfile)
 * - Page API reads data from React Query cache or service layer
 * - Returned data matches what is displayed in the personal center page
 *
 * Prerequisite: navigation.goto has ensured the page is loaded and page API is registered
 */
export const getProfile: PermissionAwareFunctionDef = {
  name: 'getProfile',
  description:
    "Get the current logged-in admin's profile information from /account/center page. Returns personal details including name, email, avatar, title, group, tags, location, and contact information. No special permission required — every admin can view their own profile.",

  requiredPermissions: [],

  zodSchema: z.object({}),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether the query was successful'),
        data: z
          .object({
            name: z.string().describe('Display name'),
            avatar: z.string().describe('Avatar URL'),
            userid: z.string().describe('User ID'),
            email: z.string().describe('Email address'),
            signature: z.string().optional().describe('Personal signature'),
            title: z.string().optional().describe('Job title'),
            group: z.string().optional().describe('Team or department'),
            tags: z
              .array(
                z.object({
                  key: z.string().describe('Tag key'),
                  label: z.string().describe('Tag display label'),
                }),
              )
              .optional()
              .describe('User tags'),
            notifyCount: z.number().optional().describe('Notification count'),
            unreadCount: z.number().optional().describe('Unread count'),
            country: z.string().optional().describe('Country/region'),
            geographic: z
              .object({
                province: z.object({
                  label: z.string(),
                  key: z.string(),
                }),
                city: z.object({
                  label: z.string(),
                  key: z.string(),
                }),
              })
              .optional()
              .describe('Geographic location'),
            address: z.string().optional().describe('Street address'),
            phone: z.string().optional().describe('Phone number'),
            notice: z
              .array(
                z.object({
                  id: z.string(),
                  title: z.string(),
                  logo: z.string(),
                  description: z.string(),
                  updatedAt: z.string(),
                  member: z.string(),
                  href: z.string(),
                  memberLink: z.string(),
                }),
              )
              .optional()
              .describe('Team notices'),
          })
          .nullable()
          .describe('User profile data (matches personal center display)'),
        error: z
          .string()
          .optional()
          .describe('Error message if query failed'),
      })
      .describe('Profile query result'),
  },

  handler: async () => {
    // Ensure page is loaded (no query params needed for profile page)
    await ensurePageLoaded('selfAccountCenter', '/account/center');

    // Call page API
    const pageAPI = window.__pages__?.selfAccountCenter;
    if (!pageAPI) {
      throw new Error('Account center page failed to load. Please try again.');
    }

    return await pageAPI.getProfile();
  },

  hooks: {
    onStart: () => {
      console.log('[selfAccount.getProfile] Reading user profile...');
    },
    onSuccess: (result) => {
      const data = (result as any)?.data;
      console.log(
        `[selfAccount.getProfile] Read successful, user: ${data?.name || 'unknown'}`,
      );
    },
    onError: (error) => {
      console.error('[selfAccount.getProfile] Read failed:', error.message);
    },
  },
};
