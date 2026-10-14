import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // jsdom required for Web Components DOM APIs (custom elements, shadow DOM, etc.)
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.test.ts'],
      coverage: {
        thresholds: {
          lines: 60,
          branches: 60,
          functions: 60,
          statements: 60,
        },
      },
    },
  }),
);
