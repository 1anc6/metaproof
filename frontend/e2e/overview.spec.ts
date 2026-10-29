import { expect, test } from '@playwright/test'
import { JOB_ID, mockApi, seedHistory, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await seedHistory(page)
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('the blur switch blurs every preview and is remembered', async ({ page }) => {
  await page.goto('/')
  const images = page.getByRole('region', { name: 'Your images' })
  await expect(images.getByRole('link', { name: 'Open holiday.jpg' })).toBeVisible()

  const blur = page.getByRole('switch', { name: 'Blur previews' })
  await blur.click()
  await expect(blur).toHaveAttribute('aria-checked', 'true')
  await expect(images.locator('img').first()).toHaveClass(/blur-xl/)

  await page.reload()
  await expect(page.getByRole('switch', { name: 'Blur previews' })).toHaveAttribute('aria-checked', 'true')
})

test('the dial shows the share of each verdict, and opens History filtered to it', async ({ page }) => {
  await page.goto('/')
  const verdicts = page.getByRole('region', { name: 'Verdicts' })
  // The sample analysis is inconclusive: none of the one verdict is AI-generated, all of it inconclusive.
  await expect(verdicts.getByRole('img', { name: '0% AI-generated: 0 of 1 verdict so far' })).toBeVisible()
  const inconclusive = verdicts.getByRole('button', { name: /^Inconclusive/ })
  await inconclusive.click()
  await expect(inconclusive).toHaveAttribute('aria-pressed', 'true')
  await expect(verdicts.getByRole('img', { name: '100% Inconclusive: 1 of 1 verdict so far' })).toBeVisible()

  await verdicts.getByRole('link', { name: 'Open Inconclusive in History' }).click()
  await expect(page).toHaveURL(/\/history\?filter=inconclusive$/)
  await expect(page.getByRole('button', { name: 'Inconclusive', pressed: true })).toBeVisible()
  await expect(page.getByText('holiday.jpg')).toBeVisible()

  await page.getByRole('button', { name: 'Flagged' }).click()
  await expect(page).toHaveURL(/\/history\?filter=flagged$/)
  await expect(page.getByText('No analyses match this search and filter.')).toBeVisible()
})

test('the latest verdict leads, and opens its report', async ({ page }) => {
  await page.goto('/')
  const latest = page.getByRole('region', { name: 'Latest analysis' })
  await expect(latest.getByText('Inconclusive', { exact: true }).first()).toBeVisible()
  await expect(latest.getByText('Your first verdict, higher is closer to AI-generated')).toBeVisible()
  await latest.getByRole('link', { name: 'Open report' }).click()
  await expect(page).toHaveURL(new RegExp(`/analysis/${JOB_ID}$`))
})

test('the period scopes the overview, and is remembered', async ({ page }) => {
  await page.goto('/')
  const period = page.getByRole('group', { name: 'Period' })
  await expect(period.getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Analyses per month' })).toBeVisible()

  await period.getByRole('button', { name: 'This week' }).click()
  await expect(period.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true')
  // The sample analysis is from today, so this week still counts it, on today's bar.
  const days = page.getByRole('region', { name: 'Analyses per day' })
  await expect(days.getByText(/: 1 analysis$/)).toBeVisible()
  await expect(page.getByText('1 image checked this week')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'true')
})

test('the arrow keys read the activity bars one by one', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('group', { name: 'Period' }).getByRole('button', { name: 'This week' }).click()
  const days = page.getByRole('region', { name: 'Analyses per day' })
  await days.getByRole('group').focus()
  await page.keyboard.press('Home')
  const monday = new Date()
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  const name = monday.toLocaleDateString(undefined, { weekday: 'long' })
  await expect(days.getByText(new RegExp(`^${name}[^:]*: [0-9]+ analys`))).toBeVisible()
})
