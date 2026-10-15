import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    reporter: ['default'],
    testTimeout: 10000,
  },
});
