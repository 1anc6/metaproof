import { expect, test } from '@playwright/test'
import { mockApi, seedHistory, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await seedHistory(page)
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('the dial counts each verdict under its button', async ({ page }) => {
  await page.goto('/')
  const verdicts = page.getByRole('region', { name: 'Verdicts' })
  // The sample analysis is inconclusive: one under that button, none under the others.
  await expect(verdicts.getByRole('button', { name: /^Inconclusive\s*1$/ })).toBeVisible()
  await expect(verdicts.getByRole('button', { name: /^AI-generated\s*0$/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(verdicts.getByText('1 verdict so far')).toBeVisible()
})

test('the activity bars hold this month in focus, and a table carries every value', async ({ page }) => {
  await page.goto('/')
  const months = page.getByRole('region', { name: 'Analyses per month' })
  await expect(months.getByText(/: 1 analysis$/)).toBeVisible()
  await expect(months.getByRole('table')).toBeAttached()
  await expect(months.getByRole('row')).toHaveCount(7) // a header and six months
})

test('searching from the overview opens History with the words, and keeps them out of the address', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('/')
  const search = page.getByRole('searchbox', { name: 'Search history' })
  await expect(search).toBeFocused()
  await search.fill('holi')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole('searchbox', { name: 'Search by filename' })).toHaveValue('holi')
  await expect(page.getByText('holiday.jpg')).toBeVisible()
})

test('/ on a screen without search opens History ready to type', async ({ page }) => {
  await page.goto('/method')
  await page.keyboard.press('/')
  await expect(page).toHaveURL(/\/history$/)
  await expect(page.getByRole('searchbox', { name: 'Search by filename' })).toBeFocused()
})

test('History takes an analysis off the list, with undo', async ({ page }) => {
  await page.goto('/history')
  await page.getByRole('button', { name: 'Remove holiday.jpg from history' }).click()
  await expect(page.getByText('Nothing here yet')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: /holiday\.jpg/ })).toBeVisible()
})
