import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
})

const picker = (page: import('@playwright/test').Page) => page.getByRole('main').getByRole('combobox', { name: 'Check' })

test('the check dial tours on its own, follows its chips, keys and picker, and explains the chosen check', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByRole('main')
  await expect(panel.getByRole('heading', { name: 'Credentials' })).toBeVisible()

  // left alone, it moves on to the next check
  await expect(picker(page)).toHaveValue('watermark', { timeout: 6000 })

  // the chips on the arc's ends step back and forth, and the explanation follows
  await panel.getByRole('button', { name: 'Next check: AI detector' }).click()
  await expect(picker(page)).toHaveValue('detector')
  await expect(panel.getByRole('heading', { name: 'AI detector' })).toBeVisible()
  await panel.getByRole('button', { name: 'Previous check: Watermark' }).click()
  await expect(picker(page)).toHaveValue('watermark')

  // arrow keys on the lens
  await panel.getByRole('button', { name: /^Watermark\. Arrow keys/ }).focus()
  await page.keyboard.press('ArrowLeft')
  await expect(picker(page)).toHaveValue('c2pa')

  // the picker jumps straight to a check
  await picker(page).selectOption('metadata')
  await expect(panel.getByRole('heading', { name: 'Metadata' })).toBeVisible()

  // after a touch it stays put for a while instead of moving on
  await page.waitForTimeout(4500)
  await expect(picker(page)).toHaveValue('metadata')
})

test('the tour can be paused', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Pause the tour' }).click()
  await expect(page.getByRole('button', { name: 'Play the tour' })).toHaveAttribute('aria-pressed', 'false')
  await page.waitForTimeout(4500)
  await expect(picker(page)).toHaveValue('c2pa')
})

test('holds still for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play the tour' })).toBeVisible()
  await page.waitForTimeout(4500)
  await expect(picker(page)).toHaveValue('c2pa')
})
