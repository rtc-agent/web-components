import { useSearchParams } from '@umijs/max';
import { useMemo } from 'react';

/**
 * Hook for syncing table filter state with URL search params.
 * Provides get/set/clear operations for table filter parameters.
 *
 * @example
 * ```tsx
 * const tableParams = useTableSearchParams<{ search: string; status: string }>();
 *
 * // Read params (URL is single source of truth)
 * const search = tableParams.get().search;
 *
 * // Update params (automatically syncs to URL)
 * tableParams.set({ search: 'keyword', status: 'active' });
 *
 * // Clear all params
 * tableParams.clear();
 * ```
 */
export function useTableSearchParams<T extends Record<string, unknown>>() {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(
    () => ({
      /**
       * Get all filter parameters from URL
       */
      get: (): Partial<T> => {
        const result: Record<string, unknown> = {};
        searchParams.forEach((value, key) => {
          try {
            // Try to parse JSON for complex values
            result[key] = JSON.parse(value);
          } catch {
            // Use raw string for simple values
            result[key] = value;
          }
        });
        return result as Partial<T>;
      },

      /**
       * Update filter parameters (merges with existing params)
       */
      set: (newParams: Partial<T>) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(newParams).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            next.set(
              key,
              typeof value === 'string' ? value : JSON.stringify(value),
            );
          } else {
            next.delete(key);
          }
        });
        setSearchParams(next, { replace: true });
      },

      /**
       * Clear all filter parameters
       */
      clear: () => {
        setSearchParams(new URLSearchParams(), { replace: true });
      },

      /**
       * Get a single parameter value
       */
      getParam: (key: string): string | null => {
        return searchParams.get(key);
      },
    }),
    [searchParams, setSearchParams],
  );

  return params;
}
