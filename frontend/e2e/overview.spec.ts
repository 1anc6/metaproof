import { expect, test } from '@playwright/test'
import { mockApi, seedHistory, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await seedHistory(page)
})

test('the blur and only-flagged switches work and are remembered', async ({ page }) => {
  await page.goto('/')
  const recent = page.locator('section', { has: page.getByRole('heading', { name: 'Recent analyses' }) })
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

test('each count opens History filtered to it', async ({ page }) => {
  await page.goto('/')
  const counts = page.getByRole('region', { name: 'Your analyses' })
  // The sample analysis is inconclusive: it shows under Inconclusive and not under Flagged.
  await counts.getByRole('link', { name: /Inconclusive/ }).click()
  await expect(page).toHaveURL(/\/history\?filter=inconclusive$/)
  await expect(page.getByRole('button', { name: 'Inconclusive', pressed: true })).toBeVisible()
  await expect(page.getByText('holiday.jpg')).toBeVisible()

  await page.getByRole('button', { name: 'Flagged' }).click()
  await expect(page).toHaveURL(/\/history\?filter=flagged$/)
  await expect(page.getByText('No analyses match this search and filter.')).toBeVisible()
})
