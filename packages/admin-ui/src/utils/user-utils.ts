/**
 * User-related utility functions
 *
 * Centralizes common user operations to avoid duplication across:
 * - getInitialState (app.tsx)
 * - refreshTokenAndUpdatePermissions (requestErrorConfig.ts)
 * - usePermissionRefresh hook
 */

import { getCurrentUser } from '@/services/admin-auth';
import { setUserInfo } from '@/utils/auth-storage';
import { buildCurrentUser } from '@/utils/permission';

/**
 * Fetch current user info and build CurrentUser object
 *
 * Encapsulates the common pattern of:
 * 1. Fetching user info from API via getCurrentUser()
 * 2. Persisting to localStorage via setUserInfo()
 * 3. Converting to CurrentUser format via buildCurrentUser()
 * 4. Dispatching 'admin-permissions-ready' event (optional)
 *
 * @param options - Optional request options (e.g., AbortSignal)
 * @param dispatchEvent - Whether to dispatch 'admin-permissions-ready' event (default: true)
 * @returns Promise<API.CurrentUser | undefined> CurrentUser object or undefined if fetch fails
 */
export async function fetchAndBuildCurrentUser(
  options?: { signal?: AbortSignal },
  dispatchEvent = true,
): Promise<API.CurrentUser | undefined> {
  try {
    const userInfo = await getCurrentUser(options);

    if (!userInfo) {
      return undefined;
    }

    // Persist to localStorage so other components (e.g., GlobalRtcAgent) can access
    setUserInfo(userInfo);

    // Notify listeners that permissions data is ready (event-driven, replaces polling)
    if (dispatchEvent) {
      window.dispatchEvent(new CustomEvent('admin-permissions-ready'));
    }

    // Convert to Ant Design Pro CurrentUser format
    return buildCurrentUser(userInfo);
  } catch (error) {
    // Check if this was an abort
    const errName = error instanceof Error ? error.name : undefined;
    if (errName === 'AbortError' || options?.signal?.aborted) {
      console.warn('[fetchAndBuildCurrentUser] Request aborted');
    } else {
      console.error(
        '[fetchAndBuildCurrentUser] Failed to fetch user info',
        error,
      );
    }
    return undefined;
  }
}
