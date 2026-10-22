import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
})

const theme = (page: import('@playwright/test').Page) => page.locator('html').getAttribute('data-theme')

test('follows the system theme until one is picked, then remembers it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/settings') // the full theme switch lives in Settings
  expect(await theme(page)).toBe('dark')

  const switcher = page.getByRole('radiogroup', { name: 'Colour theme' }).first()
  await switcher.getByRole('radio', { name: 'Light' }).click()
  expect(await theme(page)).toBe('light')
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f2f2f2')

  // Set before first paint on reload, even though the system is still dark.
  await page.reload()
  expect(await theme(page)).toBe('light')

  await switcher.getByRole('radio', { name: 'System' }).click()
  expect(await theme(page)).toBe('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('the top bar toggles between light and dark', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/')
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  expect(await theme(page)).toBe('dark')
  await page.getByRole('button', { name: 'Switch to light theme' }).click()
  expect(await theme(page)).toBe('light')
})
