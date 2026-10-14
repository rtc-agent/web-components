import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // jsdom required: worker tests use DOM APIs (Blob, custom elements via worker-core)
      environment: 'jsdom',
      include: ['src/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.ts'],
        exclude: [
          'src/shared-worker.ts',
          'src/index.ts',
          'src/core-interface.ts',
          'src/**/*.test.ts',
          'src/test-utils/**',
          'vitest.config.ts',
        ],
        thresholds: {
          lines: 60,
          branches: 50,
          functions: 60,
          statements: 60,
        },
      },
    },
  }),
);
