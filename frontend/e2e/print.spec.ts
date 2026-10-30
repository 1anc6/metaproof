import { expect, test } from '@playwright/test'
import { JOB_ID, mockApi, skipWelcome } from './mock-api'

test('Save as PDF keeps every word: no glass over the cards, every check unfolded, no app chrome', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByText('Key findings')).toBeVisible()
  await expect(page.getByText('Maker data')).toBeHidden() // folded away on screen

  await page.emulateMedia({ media: 'print' })
  // Each card's rim of light is a gradient on a ::before over the whole card. Printed without
  // background graphics, Chrome paints it solid white, over the card's words.
  const rims = await page.locator('.panel').evaluateAll((cards) => cards.map((c) => getComputedStyle(c, '::before').display))
  expect(rims.length).toBeGreaterThan(3)
  expect(rims.every((d) => d === 'none')).toBe(true)
  // the type turns dark for paper
  expect(await page.getByText('Key findings').evaluate((el) => getComputedStyle(el).color)).not.toBe('rgb(255, 255, 255)')
  // every check is on paper, open or not
  await expect(page.getByText('Maker data')).toBeVisible()
  // and none of the app around the report
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeHidden()
})
