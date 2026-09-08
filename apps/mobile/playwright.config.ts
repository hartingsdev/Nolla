import { defineConfig, devices } from '@playwright/test';

/**
 * UI click tests against the exported web build (architecture.md §8, "CI").
 * `pnpm e2e` exports first (with the API URL baked in); `pnpm e2e:only` assumes dist/ exists.
 * Two servers: the static web build on :8787 and the real API on PGlite on :8090.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
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
  webServer: [
    {
      command: 'node scripts/serve-dist.mjs dist 8787',
      url: 'http://localhost:8787/',
      reuseExistingServer: !process.env['CI'],
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @vst/api dev:pglite',
      cwd: '../..',
      url: 'http://localhost:8090/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 120_000,
      env: { PORT: '8090', METRICS_PORT: '9465', APP_BASE_URL: 'http://localhost:8787', CORS_ORIGINS: 'http://localhost:8787' },
    },
  ],
});
