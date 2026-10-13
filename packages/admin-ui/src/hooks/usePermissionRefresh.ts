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
 * Features:
 * - Serialization to prevent race conditions when multiple refresh requests
 *   occur in quick succession (e.g., batch operations)
 * - Automatic retry with exponential backoff (up to 2 retries)
 * - Optional error message display on failure
 *
 * @example
 * ```tsx
 * const { refreshPermissions } = usePermissionRefresh();
 *
 * // After modifying roles/permissions
 * await assignUserRoles(userId, roleIds);
 * await refreshPermissions();
 *
 * // With error message display
 * await refreshPermissions({ showErrorMessage: true });
 * ```
 */
export function usePermissionRefresh() {
  const { setInitialState } = useModel('@@initialState');
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());

  const refreshPermissions = useCallback(async (options: {
    showErrorMessage?: boolean;
    retryCount?: number;
  } = {}) => {
    const { showErrorMessage = false, retryCount = 0 } = options;

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
        if (retryCount < 2) {
          // Retry with exponential backoff
          console.warn(
            `[usePermissionRefresh] Retry ${retryCount + 1}/2 after failure:`,
            error,
          );
          await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
          return refreshPermissions({ showErrorMessage, retryCount: retryCount + 1 });
        }

        // All retries exhausted
        if (showErrorMessage) {
          import('antd').then(({ message }) => {
            message.error('Failed to refresh permissions');
          });
        }
        console.error(
          '[usePermissionRefresh] Failed to refresh permissions after 3 attempts:',
          error,
        );
        // Don't throw - permission refresh failure shouldn't break the calling operation
      }
    });

    return refreshQueue.current;
  }, [setInitialState]);

  return { refreshPermissions };
}
