/**
 * Standalone auth action: fetch user info.
 *
 * Extracted from InitialState so that it can be imported directly by
 * consumers (AvatarDropdown, Login page) without going through the
 * global state tree. This keeps InitialState as pure data.
 */

import { getUserInfo, isAuthenticated } from '@/utils/auth-storage';
import { buildCurrentUser } from '@/utils/permission';
import { fetchAndBuildCurrentUser } from '@/utils/user-utils';

/**
 * Fetch the current user's info from the API, with localStorage fallback.
 *
 * Behavior:
 * - Returns undefined if not authenticated (no token).
 * - On abort (signal), returns undefined without updating state.
 * - On network/server error, attempts to read cached user info from localStorage.
 * - On cache miss, returns undefined.
 */
export const fetchUserInfo = async (
  signal?: AbortSignal,
): Promise<API.CurrentUser | undefined> => {
  if (signal?.aborted) {
    return undefined;
  }

  if (!isAuthenticated()) {
    return undefined;
  }

  try {
    const currentUser = await fetchAndBuildCurrentUser({ signal }, true);

    if (signal?.aborted) {
      console.warn(
        '[fetchUserInfo] Aborted after completion, skipping state update',
      );
      return undefined;
    }

    return currentUser;
  } catch (_error: unknown) {
    const errName = _error instanceof Error ? _error.name : undefined;
    if (errName === 'AbortError' || signal?.aborted) {
      console.warn('[fetchUserInfo] Aborted');
    } else {
      console.warn('[fetchUserInfo] Failed', _error);
    }

    const cachedUserInfo = getUserInfo();
    if (cachedUserInfo) {
      console.warn('[fetchUserInfo] Using cached user info as fallback');
      return buildCurrentUser(cachedUserInfo);
    }

    return undefined;
  }
};
