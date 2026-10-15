import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

const integrationConfig = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      include: ['src/**/*.integration.test.ts'],
      testTimeout: 60000, // Integration tests need longer timeout
    },
  }),
);

export default integrationConfig;
