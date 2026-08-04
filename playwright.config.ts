import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './apps/web/e2e',
  tsconfig: './apps/web/tsconfig.app.json',
  outputDir: './test-results',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'firefox-online',
      testMatch: /online-release\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit-online',
      testMatch: /online-release\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: [
    {
      command: 'npm run dev:e2e:server',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ROOM_DB_PATH: ':memory:',
        DISCONNECT_GRACE_MS: '5000',
        HTTP_RATE_LIMIT_CAPACITY: '100',
        WS_UPGRADE_RATE_LIMIT_CAPACITY: '100',
        WS_MESSAGE_RATE_LIMIT_CAPACITY: '500',
      },
    },
    {
      command: 'npm run dev:e2e',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
})
