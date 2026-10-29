import { expect, test, type Locator } from '@playwright/test'
import { JOB_ID, mockApi, skipWelcome } from './mock-api'

const PHOTO = { name: 'beach.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]) }

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.emulateMedia({ reducedMotion: 'reduce' }) // the lens and the menu land at once
  await page.setViewportSize({ width: 390, height: 844 })
})

const box = async (l: Locator) => (await l.boundingBox())!

test('phones: the glass lens sits under the current tab, and moves with a change', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const lens = nav.locator('.lens')
  const under = (name: string) =>
    expect
      .poll(async () => {
        const a = await box(lens)
        const b = await box(nav.getByRole('link', { name }))
        return Math.max(Math.abs(a.x - b.x), Math.abs(a.width - b.width))
      })
      .toBeLessThanOrEqual(1)
  await under('Overview')
  await nav.getByRole('link', { name: 'History' }).click()
  await expect(page).toHaveURL(/\/history$/)
  await under('History')
})

test('phones: dragging along the bar opens the tab it is let go over', async ({ page }) => {
  await page.goto('/settings')
  const nav = page.getByRole('navigation', { name: 'Main' })
  const from = await box(nav.getByRole('link', { name: 'Settings' }))
  const to = await box(nav.getByRole('link', { name: 'Overview' }))
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page).toHaveURL(/\/$/)
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
})

test('phones: the + opens into a menu of ways in, and Escape closes it back into the button', async ({ page }) => {
  await page.goto('/')
  const plus = page.getByRole('button', { name: 'New analysis' })
  await plus.click()
  await expect(plus).toHaveAttribute('aria-expanded', 'true')
  const menu = page.getByRole('group', { name: 'New analysis' })
  await expect(menu.getByRole('button', { name: 'Choose a photo' })).toBeFocused()
  await expect(menu.getByRole('button', { name: 'Paste an image' })).toBeVisible()
  await expect(menu.getByRole('button', { name: 'See an example' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(plus).toBeFocused()
  await expect(plus).toHaveAttribute('aria-expanded', 'false')
})

test('phones: a photo chosen from the + menu is analyzed straight away', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'New analysis' }).click()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choose a photo' }).click()])
  await chooser.setFiles(PHOTO)
  await expect(page).toHaveURL(new RegExp(`/analysis/${JOB_ID}$`))
})
