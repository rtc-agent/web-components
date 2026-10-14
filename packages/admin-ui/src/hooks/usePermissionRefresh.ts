import { useIntl, useModel } from '@umijs/max';
import { App } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import { getCurrentUser } from '@/services/admin-auth';
import { setUserInfo } from '@/utils/auth-storage';
import { buildCurrentUser } from '@/utils/permission';

// localStorage key for user info (used for cross-tab sync)
const USER_INFO_STORAGE_KEY = 'rtc-agent-user-info';

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
  const { message } = App.useApp();
  const intl = useIntl();

  /**
   * Serialization Queue Design:
   *
   * We use a Promise chain (refreshQueue) to serialize multiple refresh requests.
   * This prevents race conditions when:
   * - Multiple permission-modifying operations occur in quick succession
   * - Batch operations trigger concurrent refresh requests
   * - User performs rapid role assignments/revocations
   *
   * How it works:
   * - Each refresh request chains onto the previous one via .then()
   * - Requests execute sequentially, not concurrently
   * - If a request fails, it retries with exponential backoff (100ms, 200ms)
   * - Maximum 3 attempts total (initial + 2 retries)
   *
   * Why not just use a mutex or lock?
   * - Promise chain is simpler and more idiomatic in React/TypeScript
   * - No external dependencies needed
   * - Naturally handles async flow control
   * - Easy to reason about and debug
   */
  const refreshQueue = useRef<Promise<void>>(Promise.resolve());
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const refreshPermissions = useCallback(
    async (
      options: { showErrorMessage?: boolean; retryCount?: number } = {},
    ) => {
      const { showErrorMessage = false, retryCount = 0 } = options;

      // Serialize refresh requests to prevent race conditions.
      // Each request chains onto the previous one, ensuring sequential execution.
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

          // Guard against updating unmounted component state
          if (!isMounted.current) {
            return;
          }

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

          // Guard against updating unmounted component state
          if (!isMounted.current) {
            return;
          }

          // Notify other components (e.g., GlobalRtcAgent) that permissions changed
          window.dispatchEvent(new CustomEvent('admin-permissions-ready'));
        } catch (error) {
          if (retryCount < 2) {
            // Retry with exponential backoff: 100ms, 200ms
            // This handles transient network failures gracefully
            console.warn(
              `[usePermissionRefresh] Retry ${retryCount + 1}/2 after failure:`,
              error,
            );
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * 2 ** retryCount),
            );
            return refreshPermissions({
              showErrorMessage,
              retryCount: retryCount + 1,
            });
          }

          // All retries exhausted (3 attempts total)
          if (showErrorMessage) {
            message.error(
              intl.formatMessage({
                id: 'pages.permission.refreshFailed',
                defaultMessage: 'Failed to refresh permissions',
              }),
            );
          }
          console.error(
            '[usePermissionRefresh] Failed to refresh permissions after 3 attempts:',
            error,
          );
          // Don't throw - permission refresh failure shouldn't break the calling operation.
          // The operation that triggered the refresh (e.g., role assignment) may have succeeded,
          // and we don't want to roll it back just because the permission refresh failed.
        }
      });

      return refreshQueue.current;
    },
    [setInitialState],
  );

  /**
   * Cross-tab permission sync via storage event
   *
   * When another tab modifies user info (e.g., role assignment), we detect it
   * and trigger a permission refresh to keep all tabs in sync.
   *
   * Implementation:
   * - Listen to 'storage' event (fires when localStorage changes in OTHER tabs)
   * - Check if the change is for user info key
   * - Verify the change is meaningful (user info actually differs)
   * - Trigger refreshPermissions() to sync current tab's state
   *
   * Why this design:
   * - Minimal overhead: only refreshes when user info actually changes
   * - No polling: event-driven, instant sync
   * - Avoids loops: 'storage' event only fires for OTHER tabs' changes
   */
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Only react to user info changes
      if (event.key !== USER_INFO_STORAGE_KEY) {
        return;
      }

      // Parse old and new values to compare
      const oldUserInfo = event.oldValue ? JSON.parse(event.oldValue) : null;
      const newUserInfo = event.newValue ? JSON.parse(event.newValue) : null;

      // If user info actually changed (not just a refresh from current tab)
      if (JSON.stringify(oldUserInfo) !== JSON.stringify(newUserInfo)) {
        console.debug(
          '[usePermissionRefresh] Detected cross-tab user info change, refreshing permissions',
        );
        // Trigger refresh (will be serialized via refreshQueue)
        refreshPermissions();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [refreshPermissions]);

  return { refreshPermissions };
}
