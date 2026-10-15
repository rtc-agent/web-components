import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from '../../vitest.base.config.ts';

const integrationConfig = mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      environment: 'happy-dom',
      setupFiles: ['./src/test-setup.ts'],
      include: ['src/**/*.integration.test.ts'],
      testTimeout: 60000, // Integration tests need longer timeout
    },
  }),
);

export default integrationConfig;
