/**
 * Static category options for list/search filter UIs.
 *
 * NOTE: This module was previously located at `./mock/index.ts`. It was renamed
 * and moved because it contains only static UI data (not mock API handlers).
 * Keeping it in a directory named "mock" under `src/` was confusing — it was
 * unclear whether the data would be bundled in production or intercepted by
 * Umi's mock plugin. This file is a regular module and is always bundled.
 */
import type { DefaultOptionType } from 'antd/es/select';

type FormatMessageFn = (
  descriptor: { id: string; defaultMessage?: string },
  values?: Record<string, string | number>,
) => string;

export const getCategoryOptions = (
  formatMessage: FormatMessageFn,
): DefaultOptionType[] =>
  Array.from({ length: 12 }).map((_, index) => ({
    value: `cat${index + 1}`,
    label: formatMessage(
      {
        id: 'pages.list.search.categoryOption',
        defaultMessage: 'Category {index}',
      },
      { index: index + 1 },
    ),
  }));
