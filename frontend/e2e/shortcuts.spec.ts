import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
})

test('? lists the shortcuts, Escape closes the list, N starts an analysis', async ({ page }) => {
  await page.goto('/method')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })

  await page.keyboard.press('?')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.keyboard.press('n')
  await expect(page).toHaveURL(/\/new$/)
})

test('typing in a text field is never taken as a shortcut', async ({ page }) => {
  await page.goto('/history')
  await page.getByRole('searchbox', { name: 'Search by filename' }).fill('n?')
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden()
})
