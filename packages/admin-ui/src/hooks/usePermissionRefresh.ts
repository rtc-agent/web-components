import { useModel } from '@umijs/max';
import { useCallback, useRef } from 'react';
import { getCurrentUser } from '@/services/admin-auth';
import { setUserInfo } from '@/utils/auth-storage';
import { buildCurrentUser } from '@/utils/permission';

/**
 * Hook for refreshing current user permissions
 *
 * Use this hook after permission-modifying operations (role assignment, permission toggle, etc.)
 * to ensure the current user's permissions are immediately updated if affected.
 *
 * Features serialization to prevent race conditions when multiple refresh requests
 * occur in quick succession (e.g., batch operations).
 *
 * @example
 * ```tsx
 * const { refreshPermissions } = usePermissionRefresh();
 *
 * // After modifying roles/permissions
 * await assignUserRoles(userId, roleIds);
 * await refreshPermissions();
 * ```
 */
export function usePermissionRefresh() {
  const { setInitialState } = useModel('@@initialState');
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());

  const refreshPermissions = useCallback(async () => {
    // Serialize refresh requests to prevent race conditions
    refreshQueue.current = refreshQueue.current.then(async () => {
      try {
        // Fetch latest user info from server
        const userInfo = await getCurrentUser();

        if (!userInfo) {
          console.warn('[usePermissionRefresh] Failed to fetch user info');
          return;
        }

        // Update localStorage (so GlobalRtcAgent can read latest permissions)
        setUserInfo(userInfo);

        // Update global state (triggers re-render with new permissions)
        await setInitialState((prev) => {
          if (!prev?.currentUser) {
            return prev;
          }
          return {
            ...prev,
            currentUser: buildCurrentUser(userInfo),
          };
        });

        // Notify other components (e.g., GlobalRtcAgent) that permissions changed
        window.dispatchEvent(new CustomEvent('admin-permissions-ready'));
      } catch (error) {
        console.error(
          '[usePermissionRefresh] Failed to refresh permissions:',
          error,
        );
        // Don't throw - permission refresh failure shouldn't break the calling operation
      }
    });

    return refreshQueue.current;
  }, [setInitialState]);

  return { refreshPermissions };
}
