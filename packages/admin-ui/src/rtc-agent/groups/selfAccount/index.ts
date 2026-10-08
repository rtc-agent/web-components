import type { PermissionAwareFunctionDef } from '@/rtc-agent/permission-filter';
import { getProfile } from './get-profile';
import { updateProfile } from './update-profile';

/**
 * Self Account Function Group
 *
 * Corresponds to routes: /account/center, /account/settings
 *
 * Allows admins to view and manage their own profile information.
 * No special permission required — every logged-in admin can use these functions.
 *
 * All functions call page-exposed React APIs:
 * - window.__pages__.selfAccountCenter.getProfile()
 * - window.__pages__.selfAccountSettings.updateProfile()
 */
export const selfAccountGroup = {
  name: 'selfAccount',
  description:
    'Self account management module for /account/center and /account/settings pages. Supports viewing personal profile information and updating profile details (name, email, avatar, location, phone). No special permission required — available to all logged-in admins.',
  functions: [getProfile, updateProfile] as PermissionAwareFunctionDef[],
};
