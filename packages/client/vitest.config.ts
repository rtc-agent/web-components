import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // node environment: client package tests WebSocket/API logic without DOM dependencies,
    // integration tests excluded from coverage run separately
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules', 'dist'],
    coverage: {
      thresholds: {
        lines: 60,
      },
    },
  },
});
