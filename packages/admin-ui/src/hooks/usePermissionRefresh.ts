import { useCallback } from 'react';
import { useModel } from '@umijs/max';
import { getCurrentUser } from '@/services/admin-auth';
import { buildPermissionSet, computeAccessLevel } from '@/utils/permission';
import { setUserInfo } from '@/utils/auth-storage';

/**
 * Hook for refreshing current user permissions
 *
 * Use this hook after permission-modifying operations (role assignment, permission toggle, etc.)
 * to ensure the current user's permissions are immediately updated if affected.
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

  const refreshPermissions = useCallback(async () => {
    try {
      // Fetch latest user info from server
      const userInfo = await getCurrentUser();

      if (!userInfo) {
        console.warn('[usePermissionRefresh] Failed to fetch user info');
        return;
      }

      // Update localStorage (so GlobalRtcAgent can read latest permissions)
      setUserInfo(userInfo);

      // Build permission set and access level
      const permissionSet = buildPermissionSet(userInfo.permissions || []);
      const access = computeAccessLevel(userInfo.roles);

      // Update global state (triggers re-render with new permissions)
      await setInitialState((prev) => {
        if (!prev?.currentUser) {
          return prev;
        }
        return {
          ...prev,
          currentUser: {
            ...prev.currentUser,
            userid: userInfo.id,
            name: userInfo.name,
            email: userInfo.email,
            avatar: userInfo.avatar_url || prev.currentUser.avatar,
            roles: userInfo.roles,
            access,
            permissions: permissionSet,
          },
        };
      });

      // Notify other components (e.g., GlobalRtcAgent) that permissions changed
      window.dispatchEvent(new CustomEvent('admin-permissions-ready'));
    } catch (error) {
      console.error('[usePermissionRefresh] Failed to refresh permissions:', error);
      // Don't throw - permission refresh failure shouldn't break the calling operation
    }
  }, [setInitialState]);

  return { refreshPermissions };
}
