import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await skipWelcome(page)
})

const meter = (page: import('@playwright/test').Page) => page.getByRole('meter', { name: 'Database storage used' })

test('shows storage use and the last day of analyses', async ({ page }) => {
  await mockApi(page)
  await page.goto('/settings')
  await expect(page.getByText('9.2 MB of 512 MB')).toBeVisible()
  await expect(meter(page)).toHaveAttribute('aria-valuetext', /healthy/)
  await expect(page.getByText(/Healthy · reports are kept for 90 days/)).toBeVisible()
  await expect(page.getByText('Analyses today')).toBeVisible()
  await expect(page.getByText('of 500 a day')).toBeVisible()
})

test('warns, in words and not only colour, as storage fills up', async ({ page }) => {
  await mockApi(page, { status: { database_mb: 430, failed_24h: 3 } })
  await page.goto('/settings')
  await expect(page.getByText(/Getting full/)).toBeVisible()
  await expect(page.getByText('see the server logs')).toBeVisible()

  await mockApi(page, { status: { database_mb: 500 } })
  await page.reload()
  await expect(page.getByText(/Almost full/)).toBeVisible()
})

test('says so plainly when the server cannot be reached', async ({ page }) => {
  await mockApi(page, { status: 'down' })
  await page.goto('/settings')
  await expect(page.getByText(/Storage figures are unavailable/)).toBeVisible()
  await expect(meter(page)).toHaveCount(0)
})
