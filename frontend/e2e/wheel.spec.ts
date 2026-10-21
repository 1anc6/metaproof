import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
})

const chosen = (page: import('@playwright/test').Page) =>
  page.locator('[role=button][aria-pressed=true]').getAttribute('aria-label')

test('the check wheel turns on its own, follows a tap and arrow keys, and explains the chosen check', async ({ page }) => {
  await page.goto('/')
  const panel = page.getByRole('region', { name: 'The six checks' })
  await expect(panel.getByRole('heading', { name: 'Credentials' })).toBeVisible()

  // left alone, it moves on to the next check
  await expect.poll(() => chosen(page), { timeout: 6000 }).toBe('Watermark')

  // a tap chooses a check, and the explanation follows
  await panel.getByRole('button', { name: 'Metadata' }).click()
  expect(await chosen(page)).toBe('Metadata')
  await expect(panel.getByRole('heading', { name: 'Metadata' })).toBeVisible()

  // arrow keys step through the checks
  await page.keyboard.press('ArrowRight')
  expect(await chosen(page)).toBe('Structure')

  // after a touch it stays put for a while instead of moving on
  await page.waitForTimeout(4000)
  expect(await chosen(page)).toBe('Structure')
})

test('dragging the wheel turns it and snaps to the nearest check', async ({ page }) => {
  await page.goto('/')
  const wheel = page.getByRole('group', { name: /The six checks/ })
  const box = (await wheel.boundingBox())!
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const r = box.width * 0.34
  const at = (deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)] as const

  expect(await chosen(page)).toBe('Credentials')
  // drag the bottom segment a sixth of a turn clockwise: the check before it comes to the front
  await page.mouse.move(...at(90))
  await page.mouse.down()
  for (let d = 95; d <= 150; d += 5) await page.mouse.move(...at(d))
  await page.mouse.up()
  expect(await chosen(page)).toBe('Structure')
})

test('holds still for reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  expect(await chosen(page)).toBe('Credentials')
  await page.waitForTimeout(4000)
  expect(await chosen(page)).toBe('Credentials')
})
