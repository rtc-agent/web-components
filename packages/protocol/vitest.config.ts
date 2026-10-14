import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // node environment: protocol package contains pure TypeScript types and interfaces,
      // no DOM APIs required
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }),
);
