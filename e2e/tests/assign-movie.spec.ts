import { test, expect } from '@playwright/test'
import { login } from './helpers'

// Regression for the "movies aren't getting added" report: assigning a movie in
// Browse must make it show up under the Assigned tab's Movies filter (the bug was
// the global type filter silently hiding it). Requires a real channel + a Plex
// movie library, so it's gated on E2E_CHANNEL_NAME and skips otherwise.
//
// Selectors target the current (pre-Browse-redesign) UI. After the denser-Browse
// redesign lands, the library picker becomes a "Browse" button behind a
// Library/Collection source toggle — update the marked lines accordingly.

const channelName = process.env.E2E_CHANNEL_NAME

test('assigned movie appears under the Movies filter', async ({ page }) => {
  test.skip(!channelName, 'Set E2E_CHANNEL_NAME to a channel that has a Plex movie library to run this test.')
  await login(page)

  // Open the channel.
  await page.getByRole('button', { name: channelName! }).first().click()

  // Go to the Browse Plex sub-tab.
  await page.getByRole('button', { name: 'Browse Plex' }).click()

  // Pick the first library and load it.  (Redesign: replace with the source toggle + Browse.)
  const librarySelect = page.locator('select').first()
  await librarySelect.selectOption({ index: 1 })
  await page.getByRole('button', { name: /^Browse/ }).click()

  // Assign the first movie shown.
  const assignBtn = page.getByRole('button', { name: /^(Assign|Add)$/ }).first()
  await expect(assignBtn).toBeVisible({ timeout: 15_000 })
  await assignBtn.click()

  // Switch to Assigned → Movies and confirm at least one movie is listed.
  await page.getByRole('button', { name: 'Assigned' }).click()
  await page.getByRole('button', { name: /^Movies/ }).click()

  // The honest empty state would say "hidden by filter"; a real movie must render.
  await expect(page.getByText('No content assigned')).toHaveCount(0)
  const movieBadges = page.getByText('Movie', { exact: true })
  await expect(movieBadges.first()).toBeVisible({ timeout: 10_000 })
})
