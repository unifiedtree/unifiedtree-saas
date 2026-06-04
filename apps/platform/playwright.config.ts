import { defineConfig, devices } from '@playwright/test'

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://demo.localhost:3001'

export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,           // serial — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,                     // serial — important for tenant isolation tests
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: process.env.CI ? 'github' : [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      'X-Tenant-Subdomain': 'demo',
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Runs once before the suite: API-logs-in each role and writes its token to
  // e2e/.auth/<role>.json. (The token is NOT a Playwright storageState — see the
  // DEVIATION note in e2e/auth/setup.ts: the SDK keeps the access token in
  // memory / sessionStorage, which storageState cannot carry. The test-base
  // fixture injects each project's token into sessionStorage via addInitScript.)
  globalSetup: './e2e/auth/setup.ts',

  // Each project maps to a role; the test-base fixture reads the project name to
  // pick which token to inject. No storageState here on purpose (see above).
  projects: [
    { name: 'super-admin',  use: { ...devices['Desktop Chrome'] } },
    { name: 'hr-manager',   use: { ...devices['Desktop Chrome'] } },
    { name: 'dept-manager', use: { ...devices['Desktop Chrome'] } },
    { name: 'finance-lead', use: { ...devices['Desktop Chrome'] } },
    { name: 'employee',     use: { ...devices['Desktop Chrome'] } },
    { name: 'unauthenticated', use: { ...devices['Desktop Chrome'] } }, // no token injected
  ],

  // The dev server is started separately (with VITE_DEV_TOKEN_STORAGE=session so
  // the SDK reads the token from sessionStorage). Just reuse it.
  // Readiness probe must use localhost (Node's fetch can't resolve *.localhost
  // the way Chromium does); the dev server binds 0.0.0.0 so this hits it.
  // baseURL stays demo.localhost:3001 above for tenant-subdomain resolution.
  webServer: process.env.CI ? undefined : {
    command: 'echo "Assuming dev server already running"',
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 10_000,
  },
})
