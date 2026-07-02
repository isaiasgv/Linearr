import { defineConfig, devices } from '@playwright/test'

// Point at a running Linearr instance. Defaults to the host port from docker-compose.
// Override with PLAYWRIGHT_BASE_URL (e.g. http://your-plex-host:8777).
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:8777'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
