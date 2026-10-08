import { withMeta, z } from '@rtc-agent/component';
import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { ensurePageLoaded } from '@/rtc-agent/utils/page-loader';

/**
 * Update current user's profile information
 *
 * Permission required: none (available to all logged-in admins)
 *
 * Implementation:
 * - Calls the page-exposed React API (window.__pages__.selfAccountSettings.updateProfile)
 * - Page API validates form data and shows success feedback
 * - Form validation is handled by the settings page
 *
 * Prerequisite: navigation.goto has ensured the settings page is loaded
 */
export const updateProfile: PermissionAwareFunctionDef = {
  name: 'updateProfile',
  description:
    "Update the current logged-in admin's profile information on /account/settings page. Supports updating name, email, personal profile, country, province/city, street address, and phone number. No special permission required — every admin can edit their own profile.",

  requiredPermissions: [],

  zodSchema: z.object({
    name: withMeta(z.string(), { example: 'John Doe' })
      .optional()
      .describe('Display name. Required in the form — must be non-empty.'),
    email: withMeta(z.string().email(), { example: 'john@example.com' })
      .optional()
      .describe('Email address. Required in the form — must be a valid email.'),
    profile: withMeta(z.string(), { example: 'A passionate developer' })
      .optional()
      .describe('Personal profile/bio text.'),
    country: withMeta(z.string(), { example: 'China' })
      .optional()
      .describe('Country or region.'),
    province: withMeta(z.string(), { example: '330000' })
      .optional()
      .describe('Province ID (for geographic location).'),
    city: withMeta(z.string(), { example: '330100' })
      .optional()
      .describe('City ID (for geographic location).'),
    address: withMeta(z.string(), { example: '123 Main Street' })
      .optional()
      .describe('Street address.'),
    phone: withMeta(z.string(), { example: '0752-268888888' })
      .optional()
      .describe(
        'Phone number in format "areaCode-number" (e.g., "0752-268888888").',
      ),
  }),

  returns: {
    zodSchema: z
      .object({
        success: z.boolean().describe('Whether the update was successful'),
        error: z.string().optional().describe('Error message if update failed'),
      })
      .describe('Profile update result'),
  },

  handler: async (params) => {
    const { name, email, profile, country, province, city, address, phone } =
      params as {
        name?: string;
        email?: string;
        profile?: string;
        country?: string;
        province?: string;
        city?: string;
        address?: string;
        phone?: string;
      };

    // Ensure settings page is loaded
    await ensurePageLoaded('selfAccountSettings', '/account/settings');

    // Call page API
    const pageAPI = window.__pages__?.selfAccountSettings;
    if (!pageAPI) {
      throw new Error(
        'Account settings page failed to load. Please try again.',
      );
    }

    return await pageAPI.updateProfile({
      name,
      email,
      profile,
      country,
      province,
      city,
      address,
      phone,
    });
  },

  hooks: {
    onStart: () => {
      console.log('[selfAccount.updateProfile] Updating user profile...');
    },
    onSuccess: (_result) => {
      console.log('[selfAccount.updateProfile] Update successful');
    },
    onError: (error) => {
      console.error(
        '[selfAccount.updateProfile] Update failed:',
        error.message,
      );
    },
  },
};
