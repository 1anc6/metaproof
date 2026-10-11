import { expect, test } from '@playwright/test'
import { mockApi, seedHistory, SHA } from './mock-api'

test.use({ viewport: { width: 390, height: 844 } })
test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

const welcome = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /See what's behind/ })

test('shows once to first-time visitors on phones', async ({ page }) => {
  await page.goto('/')
  await expect(welcome(page)).toBeVisible()
  await page.getByRole('button', { name: 'Skip' }).click()
  await expect(welcome(page)).toBeHidden()
  await page.reload()
  await expect(page.getByRole('heading', { name: /See what's behind/ })).toBeVisible() // the overview
  await expect(welcome(page)).toBeHidden()
})

test('"Analyze an image" opens the upload page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Analyze an image/ }).click()
  await expect(page).toHaveURL(/\/new$/)
  await expect(welcome(page)).toBeHidden()
})

test('Escape closes it', async ({ page }) => {
  await page.goto('/')
  await expect(welcome(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(welcome(page)).toBeHidden()
})

test('never shows on shared report links, for returning users or on desktop', async ({ page, browser }) => {
  await page.goto(`/report/${SHA}`)
  await expect(page.getByRole('heading', { name: 'Inconclusive' })).toBeVisible()
  await expect(welcome(page)).toBeHidden()

  const returning = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mockApi(returning)
  await seedHistory(returning)
  await returning.goto('/')
  await expect(returning.getByText('holiday.jpg')).toBeVisible()
  await expect(welcome(returning)).toBeHidden()
  await returning.close()

  const desktop = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await mockApi(desktop)
  await desktop.goto('/')
  await expect(desktop.locator('aside')).toBeVisible()
  await expect(welcome(desktop)).toBeHidden()
  await desktop.close()
})
