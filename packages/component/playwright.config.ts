import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: {
    command: 'npx vite --port 3000',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
});
