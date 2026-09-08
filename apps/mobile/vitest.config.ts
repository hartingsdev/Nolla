import { defineConfig } from 'vitest/config';

// Playwright owns apps/mobile/e2e; vitest must not try to run those specs.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], passWithNoTests: true },
});
