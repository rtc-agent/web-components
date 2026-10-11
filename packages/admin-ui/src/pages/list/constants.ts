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

export const categoryOptions: DefaultOptionType[] = Array.from({
  length: 12,
}).map((_, index) => ({
  value: `cat${index + 1}`,
  label: `类目${index + 1}`,
}));
