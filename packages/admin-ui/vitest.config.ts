import { join } from 'node:path';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': join(__dirname, 'src'),
        '@root': join(__dirname),
        '@@': join(__dirname, 'src', '.umi'),
      },
    },
    test: {
      // happy-dom: lightweight DOM environment for React component testing,
      // chosen over jsdom for faster execution in admin-ui's large test suite
      environment: 'happy-dom',
      setupFiles: ['./tests/setupTests.ts'],
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      // Exclude Umi integration tests that depend on @umijs/max test infrastructure
      // These require Umi's Jest runner and cannot be used with Vitest directly
      exclude: [
        'src/pages/user/login/login.test.tsx',
        'src/rtc-agent/e2e/**',
        'node_modules',
        'dist',
        '.umi',
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: [
          'src/.umi/**',
          'src/services/ant-design-pro/**',
          'src/**/*.d.ts',
          'src/**/index.style.ts',
        ],
        thresholds: {
          lines: 60,
          branches: 60,
          functions: 60,
          statements: 60,
        },
      },
      passWithNoTests: true,
      testTimeout: 15000,
    },
  }),
);
