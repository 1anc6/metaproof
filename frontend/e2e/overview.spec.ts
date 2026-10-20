import { expect, test } from '@playwright/test'
import { mockApi, seedHistory, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await seedHistory(page)
})

test('the blur and only-flagged switches work and are remembered', async ({ page }) => {
  await page.goto('/')
  const recent = page.locator('section', { has: page.getByRole('heading', { name: 'Latest analyses' }) })
  await expect(recent.getByText('holiday.jpg')).toBeVisible()

  const blur = page.getByRole('switch', { name: 'Blur previews' })
  await blur.click()
  await expect(blur).toHaveAttribute('aria-checked', 'true')
  await expect(recent.locator('img').first()).toHaveClass(/blur-xl/)

  // The sample analysis is inconclusive, so it is not flagged.
  await page.getByText('Only flagged').click()
  await expect(recent.getByText('holiday.jpg')).toBeHidden()
  await expect(recent.getByText('Nothing edited or AI-generated')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Only flagged' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Blur previews' })).toHaveAttribute('aria-checked', 'true')
})
