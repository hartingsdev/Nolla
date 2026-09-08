import { defineConfig, devices } from '@playwright/test';

/**
 * UI click tests against the exported web build (architecture.md §8, "CI").
 * `pnpm e2e` exports first; `pnpm e2e:only` assumes dist/ exists.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8787',
    locale: 'en-US',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], locale: 'en-US' } },
  ],
  webServer: {
    command: 'node scripts/serve-dist.mjs dist 8787',
    url: 'http://localhost:8787/',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
