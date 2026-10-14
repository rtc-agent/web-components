import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // node environment: persistence layer uses IndexedDB abstraction (Dexie),
      // tests mock database operations without requiring DOM APIs
      environment: 'node',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.ts'],
      coverage: {
        thresholds: {
          lines: 50,
        },
      },
    },
  }),
);
