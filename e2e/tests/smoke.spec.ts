import { test, expect } from '@playwright/test'
import { login } from './helpers'

test('app shell loads after login', async ({ page }) => {
  await login(page)
  // The Browse Plex / Assigned content tabs are part of the authenticated shell.
  // At minimum the login form is gone and the app has rendered.
  await expect(page).toHaveTitle(/Linearr/i)
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})
