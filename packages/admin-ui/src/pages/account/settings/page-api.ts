/**
 * Self Account Settings Page API Interface
 *
 * Page component registers these APIs to window.__pages__ on mount.
 * Function handlers call these APIs to operate on the UI.
 *
 * Key principles:
 * - Handles profile update through the settings form
 * - Returns success status and error messages
 * - Form validation is handled internally
 */

export interface SelfAccountSettingsPageAPI {
  /**
   * Update current user's profile information.
   * Validates form data and shows success/error feedback.
   */
  updateProfile: (data: {
    name?: string;
    email?: string;
    profile?: string;
    country?: string;
    province?: string;
    city?: string;
    address?: string;
    phone?: string;
  }) => Promise<{
    success: boolean;
    error?: string;
  }>;
}

// Extend the global PagesRegistry via declaration merging
declare global {
  interface PagesRegistry {
    selfAccountSettings?: SelfAccountSettingsPageAPI;
  }
}
