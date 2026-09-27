import { defineConfig } from '@playwright/test';

// End-to-end tests: the web build of the app in a phone-sized browser, against the local
// Supabase stack. The README (Development) says how to run them.
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // The tests share one local database, so they run one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8088',
    viewport: { width: 390, height: 844 },
    // Unset uses Playwright's own Chromium; E2E_BROWSER_CHANNEL=msedge uses an installed Edge.
    channel: process.env.E2E_BROWSER_CHANNEL,
    trace: 'retain-on-failure',
    // A fake camera, so the feeding flow can take a photo.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://127.0.0.1:8088',
    reuseExistingServer: !process.env.CI,
  },
});
