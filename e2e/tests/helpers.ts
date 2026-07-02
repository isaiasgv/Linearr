import { expect, type Page } from '@playwright/test'

const USERNAME = process.env.E2E_USERNAME || 'admin'
const PASSWORD = process.env.E2E_PASSWORD || ''

/** Log in if the login form is showing; no-op if the session cookie already exists. */
export async function login(page: Page): Promise<void> {
  await page.goto('/')
  const username = page.getByLabel('Username')
  if (await username.isVisible().catch(() => false)) {
    if (!PASSWORD) {
      throw new Error('E2E_PASSWORD env var is required to log in (matches APP_PASSWORD).')
    }
    await username.fill(USERNAME)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  // Login form gone == authenticated.
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
}
