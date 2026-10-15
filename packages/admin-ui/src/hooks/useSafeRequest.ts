import { useRequest } from '@umijs/max';

/**
 * Custom hook that wraps umi's useRequest to provide type-safe responses.
 *
 * Problem: umi's useRequest has a default `formatResult: result => result?.data`
 * which conflicts with our request() function that already unwraps the { success, data }
 * response structure. This causes double unwrapping and makes data undefined.
 *
 * Solution: Override formatResult with identity function and provide proper typing.
 *
 * @example
 * ```ts
 * const { data, loading } = useSafeRequest(
 *   () => fetchUserDevices(userId),
 *   { ready: !!userId, refreshDeps: [userId] }
 * );
 * ```
 */
export function useSafeRequest<TData>(
  service: () => Promise<TData>,
  options?: any,
) {
  return useRequest(service, {
    ...options,
    formatResult: (res: unknown) => res as TData,
  }) as { data: TData | undefined; loading: boolean };
}
