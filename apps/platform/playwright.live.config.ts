import { defineConfig, devices } from '@playwright/test'

// Standalone config to smoke-test the LIVE (prod-backed) ravi tenant via the
// running dev server. No globalSetup — the spec self-authenticates via the API.
export default defineConfig({
  testDir: './e2e/live',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 12_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://ravi.localhost:3003',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'live-admin', use: { ...devices['Desktop Chrome'] } }],
})
