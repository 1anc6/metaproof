import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
})

const lens = (page: import('@playwright/test').Page) => page.getByRole('button', { name: /Arrow keys choose another check/ })

test('the check dial follows its chips and arrow keys, and explains the chosen check', async ({ page }) => {
  await page.goto('/')
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Credentials' })).toBeVisible()

  // the chips on the arc's ends step back and forth, and the explanation follows
  await main.getByRole('button', { name: 'Next check: Watermark' }).click()
  await expect(main.getByRole('heading', { name: 'Watermark' })).toBeVisible()
  await expect(lens(page)).toHaveAccessibleName(/^Watermark\./)
  await main.getByRole('button', { name: 'Previous check: Credentials' }).click()
  await expect(main.getByRole('heading', { name: 'Credentials' })).toBeVisible()

  // arrow keys on the lens
  await lens(page).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(main.getByRole('heading', { name: 'Structure' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(main.getByRole('heading', { name: 'Watermark' })).toBeVisible()
})

test('the dial never moves on by itself', async ({ page }) => {
  await page.goto('/')
  await page.waitForTimeout(4500)
  await expect(lens(page)).toHaveAccessibleName(/^Credentials\./)
})
