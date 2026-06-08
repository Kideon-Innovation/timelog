import { defineConfig, devices } from '@playwright/test';

// Non-well-known port so concurrent agents don't collide. Override with PORT.
const PORT = process.env.PORT || '50650';
const BASE = `http://localhost:${PORT}/timelog/`;

export default defineConfig({
  testDir: './tests',
  // Browser E2E specs only. Pure-unit assertions live in *.test.js and run
  // under Node's own test runner (`node --test`), not Playwright — excluding
  // them here keeps Playwright from importing/executing node:test files.
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30000,
  use: {
    baseURL: BASE,
    trace: 'off',
    // DATEV-Lohn export triggers a file download; tests need to capture it.
    acceptDownloads: true,
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
});
