import { expect, test } from '@playwright/test'
import { mockApi, seedHistory, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await seedHistory(page)
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('the overview counts each verdict, and its legend opens History filtered to it', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('1 verdict so far, 0 flagged as edited or AI-generated.')).toBeVisible()
  const verdicts = page.getByRole('region', { name: 'Your analyses' })
  // The sample analysis is inconclusive: one in that row of the legend, none in the others.
  await expect(verdicts.getByRole('link', { name: /Inconclusive\s*1$/ })).toBeVisible()
  await expect(verdicts.getByRole('link', { name: /AI-generated\s*0$/ })).toBeVisible()
  await expect(page.getByRole('img', { name: '0% of verdicts flagged, 0 of 1' })).toBeVisible()

  await verdicts.getByRole('link', { name: /Inconclusive/ }).click()
  await expect(page).toHaveURL(/\/history\?filter=inconclusive$/)
  await expect(page.getByRole('button', { name: 'Inconclusive', pressed: true })).toBeVisible()
})

test('today is marked on the calendar, with its analysis', async ({ page }) => {
  await page.goto('/')
  const days = page.getByRole('table', { name: /Days with analyses/ })
  await expect(days.getByText(/today: 1 analysis/)).toBeAttached()
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled()
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

test('a row menu takes an analysis off the list, with undo', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'More for holiday.jpg' }).click()
  await page.getByRole('button', { name: 'Remove from history' }).click()
  await expect(page.getByText(/Each image you check lands here/)).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByRole('link', { name: /holiday\.jpg/ })).toBeVisible()
})
