import { useIntl, useModel, useQueryClient } from '@umijs/max';
import { App } from 'antd';
import { useCallback, useEffect, useRef } from 'react';
import { clearPermissionCache } from '@/access';
import { queryKeys } from '@/utils/queryKeys';
import { fetchAndBuildCurrentUser } from '@/utils/user-utils';

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
  // Access QueryClient instance to invalidate user-related caches
  // when permissions change. This ensures react-query doesn't serve
  // stale user data after permission updates.
  const queryClient = useQueryClient();

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
      options: {
        showErrorMessage?: boolean;
        retryCount?: number;
        auditContext?: { action: string; target?: string; details?: unknown };
      } = {},
    ) => {
      const {
        showErrorMessage = false,
        retryCount = 0,
        auditContext,
      } = options;

      // Log permission audit trail for traceability.
      // Captures who modified whose permissions, when, and what action was taken.
      if (auditContext) {
        console.info('[Permission Audit]', {
          ...auditContext,
          timestamp: new Date().toISOString(),
        });
      }

      // Serialize refresh requests to prevent race conditions.
      // Each request chains onto the previous one, ensuring sequential execution.
      refreshQueue.current = refreshQueue.current.then(async () => {
        try {
          // Immediately clear the permission cache so subsequent access() calls
          // recompute instead of serving stale data within the 60s TTL window.
          clearPermissionCache();

          // Fetch latest user info from server and build CurrentUser object
          // This also updates localStorage and dispatches 'admin-permissions-ready' event
          const currentUser = await fetchAndBuildCurrentUser(undefined, true);

          if (!currentUser) {
            console.warn('[usePermissionRefresh] Failed to fetch user info');
            return;
          }

          if (process.env.NODE_ENV === 'development') {
            console.info('[usePermissionRefresh] Permissions refreshed', {
              userId: currentUser.userid,
              timestamp: new Date().toISOString(),
              permissionCount: currentUser.permissions?.size ?? 0,
            });
          }

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
              currentUser,
            };
          });

          // Invalidate user-related react-query caches to ensure consistency
          // between permission cache and server state. This forces components
          // to refetch user data with the new permissions.
          queryClient?.invalidateQueries({
            queryKey: queryKeys.currentUser.all,
          });

          // Guard against updating unmounted component state
          if (!isMounted.current) {
            return;
          }
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
              auditContext,
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
    [setInitialState, queryClient],
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
   * - Debounce refresh to prevent race conditions from rapid successive changes
   *
   * Why this design:
   * - Minimal overhead: only refreshes when user info actually changes
   * - No polling: event-driven, instant sync
   * - Avoids loops: 'storage' event only fires for OTHER tabs' changes
   * - Debouncing prevents race conditions when multiple changes occur in quick succession
   *
   * Debounce safety:
   * - 100ms debounce window does NOT lose updates: each storage event clears the
   *   previous timer and schedules a new refresh. When the timer finally fires,
   *   refreshPermissions() fetches the LATEST user info from the server, which
   *   includes all changes that occurred during the debounce window.
   * - If multiple storage events fire within 100ms, we only refresh once after
   *   the last event, which is more efficient than refreshing after each event.
   * - The serialization queue (refreshQueue) ensures that even if multiple
   *   refreshes are scheduled, they execute sequentially without race conditions.
   */
  useEffect(() => {
    // Debounce timer ID for cross-tab sync
    // Note: When a new storage event arrives, we clear this timer and start a new one.
    // This is safe because refreshPermissions() always fetches the latest server state,
    // so no updates are lost — we just defer the refresh until the batch of changes settles.
    let syncTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
          '[usePermissionRefresh] Detected cross-tab user info change, scheduling refresh',
        );

        // Clear permission cache first to force recalculation.
        // Without this, access() might return stale cached permissions
        // even after refreshPermissions() completes.
        clearPermissionCache();

        // Debounce: clear any pending refresh and schedule a new one
        // This prevents race conditions when multiple storage events fire in quick succession
        if (syncTimeoutId !== null) {
          clearTimeout(syncTimeoutId);
        }

        syncTimeoutId = setTimeout(() => {
          syncTimeoutId = null;
          // Trigger refresh (will be serialized via refreshQueue)
          refreshPermissions();
        }, 100); // 100ms debounce window
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      // Clean up pending debounce timer on unmount
      if (syncTimeoutId !== null) {
        clearTimeout(syncTimeoutId);
      }
    };
  }, [refreshPermissions]);

  return { refreshPermissions };
}
