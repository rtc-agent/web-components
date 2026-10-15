import { useIntl } from '@umijs/max';
import { useMemo } from 'react';
import TableEmptyState from '@/components/TableEmptyState';

/**
 * Hook for creating ProTable locale prop with consistent empty state.
 *
 * Many pages need to override ProTable's default empty state with a custom
 * TableEmptyState component. This hook encapsulates that pattern to avoid
 * repetition across multiple table pages.
 *
 * @example
 * ```tsx
 * const locale = useProTableLocale(
 *   'pages.rtcUsers.noData',
 *   'No users found'
 * );
 *
 * <ProTable locale={locale} ... />
 * ```
 *
 * @param descriptionId - i18n message ID for empty state description
 * @param defaultDescription - Default fallback description text
 * @returns Memoized locale object for ProTable
 */
export function useProTableLocale(
  descriptionId: string,
  defaultDescription: string,
) {
  const intl = useIntl();

  return useMemo(
    () => ({
      emptyText: (
        <TableEmptyState
          descriptionId={descriptionId}
          defaultDescription={defaultDescription}
        />
      ),
    }),
    [intl, descriptionId, defaultDescription],
  );
}
