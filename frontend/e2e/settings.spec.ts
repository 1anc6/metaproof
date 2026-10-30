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
  await expect(page.getByText(/Healthy · reports are kept for 1 day/)).toBeVisible()
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

test('keeps the figures in step with the server without a reload', async ({ page }) => {
  await page.clock.install()
  await mockApi(page)
  await page.goto('/settings')
  await expect(page.getByText('9.2 MB of 512 MB')).toBeVisible()

  await mockApi(page, { status: { database_mb: 12.4, analyses_24h: 15 } })
  await page.clock.fastForward(15_000)
  await expect(page.getByText('12.4 MB of 512 MB')).toBeVisible()
  await expect(page.getByText('15', { exact: true })).toBeVisible()
})

test('keeps the last figures, marked as possibly stale, when a refresh fails', async ({ page }) => {
  await page.clock.install()
  await mockApi(page)
  await page.goto('/settings')
  await expect(page.getByText('9.2 MB of 512 MB')).toBeVisible()

  await mockApi(page, { status: 'down' })
  await page.clock.fastForward(15_000)
  await expect(page.getByText(/may be out of date/)).toBeVisible()
  await expect(meter(page)).toBeVisible()
})

test("shows the server's memory against the instance, with room left after its peak", async ({ page }) => {
  await mockApi(page)
  await page.goto('/settings')
  await expect(page.getByText('MB of 512 MB').nth(1)).toBeVisible()
  await expect(page.getByRole('meter', { name: 'Server memory used' })).toHaveAttribute('aria-valuetext', '262 of 512 MB, peak 432 MB, healthy')
  await expect(page.getByText(/peak 432 MB since the last start, 80 MB to spare/)).toBeVisible()
  await expect(page.getByText('AI detector loaded')).toBeVisible()

  await mockApi(page, { status: { memory_peak_mb: 470, detector: 'missing' } })
  await page.reload()
  await expect(page.getByText(/Little room · peak 470 MB since the last start, 42 MB to spare/)).toBeVisible()
  await expect(page.getByText('AI detector missing: verdicts are made without it')).toBeVisible()
})

test('leaves memory out where the server cannot read it, and still names the detector', async ({ page }) => {
  await mockApi(page, { status: { memory_mb: null, memory_peak_mb: null, detector: 'available' } })
  await page.goto('/settings')
  await expect(page.getByRole('meter', { name: 'Server memory used' })).toHaveCount(0)
  await expect(page.getByText('AI detector loads with the next analysis')).toBeVisible()
})

test('says so plainly when the server cannot be reached', async ({ page }) => {
  await mockApi(page, { status: 'down' })
  await page.goto('/settings')
  await expect(page.getByText(/Storage figures are unavailable/)).toBeVisible()
  await expect(meter(page)).toHaveCount(0)
})
