import { defineConfig } from '@playwright/test';

// Store screenshots: the web build of the app with sample data, at the App Store's 6.9" size
// (440 × 956 points at 3x = 1320 × 2868). `npm run store:shots` after `npm run e2e:build`,
// with the local Supabase stack running; the images land in e2e/store/output.
export default defineConfig({
  testDir: '.',
  outputDir: 'test-results',
  timeout: 120_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:8088',
    viewport: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    timezoneId: 'Asia/Jerusalem',
    channel: process.env.E2E_BROWSER_CHANNEL,
  },
  webServer: {
    command: 'node ../serve.mjs',
    url: 'http://127.0.0.1:8088',
    reuseExistingServer: true,
  },
});
