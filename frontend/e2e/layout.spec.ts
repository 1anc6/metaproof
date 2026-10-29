import { expect, test } from '@playwright/test'
import { mockApi, skipWelcome } from './mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.emulateMedia({ reducedMotion: 'reduce' }) // measure panels at rest, not mid-animation
})

test('logo reads "MetaProof"', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'MetaProof' }).first()).toBeVisible()
})

test("desktop: the rail runs the height of the glass window, and opens out to the screens' names", async ({ page }) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.locator('main section').first().waitFor()
    // inside the window's glass: 16px of room round the window, 16px of glass round the rail
    const rail = (await page.locator('aside .rail').boundingBox())!
    expect(rail.y).toBe(32)
    expect(rail.height).toBe(900 - 64)
    expect(rail.width).toBe(88)
  }

  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect.poll(async () => (await page.locator('aside .rail').boundingBox())!.width).toBe(236)
  await expect(page.getByRole('navigation', { name: 'Main' }).getByText('History')).toBeVisible()
  // remembered, and [ closes it again
  await page.reload()
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible()
  await page.locator('body').press('[')
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible()
  await expect.poll(async () => (await page.locator('aside .rail').boundingBox())!.width).toBe(88)
})

test('phones and tablets: a floating tab bar names the current screen, with New analysis floating beside it', async ({ page }) => {
  for (const width of [360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link')).toHaveCount(5) // four screens and the + button
    // only the current screen shows its name; the others keep theirs for screen readers
    const current = nav.getByRole('link', { name: 'Overview' })
    await expect(current).toHaveAttribute('aria-current', 'page')
    await expect(current.getByText('Overview')).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
    // the + floats to the right of the bar, and the pair sits centred with equal margins
    const bar = (await nav.locator('.dock-bar').boundingBox())!
    const plus = (await nav.getByRole('link', { name: 'New analysis' }).boundingBox())!
    expect(plus.x).toBeGreaterThan(bar.x + bar.width)
    expect(Math.abs(bar.x - (width - plus.x - plus.width))).toBeLessThanOrEqual(1)
    // every tab is big enough to hit with a thumb
    for (const tab of await nav.locator('.tab').all()) {
      const box = (await tab.boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44)
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
  }
})

test('phones: choosing a tab moves the pill and the name to it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'History' }).click()
  await expect(page).toHaveURL(/\/history$/)
  await expect(nav.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current', 'page')
})

test('desktop: the navigation sits in the sidebar, and nothing floats over the page', async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav).toHaveCount(1) // the phone bar is gone at this width
    await expect(nav.getByRole('link')).toHaveCount(5)
    expect((await nav.boundingBox())!.x).toBeLessThan(300)
    await expect(nav.getByRole('link', { name: 'New analysis' })).toBeVisible()
    // the app opens on the overview, not a landing page
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('searchbox', { name: 'Search history' })).toBeInViewport()
  }
})

test('phones: the overview opens with the period, search, the images and the verdicts above the fold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('group', { name: 'Period' })).toBeInViewport()
  await expect(page.getByRole('searchbox', { name: 'Search history' })).toBeInViewport()
  await expect(page.getByRole('region', { name: 'Your images' })).toBeInViewport()
  await expect(page.getByRole('region', { name: 'Verdicts' })).toBeInViewport()
})

test('no horizontal scrolling on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  for (const path of ['/', '/new', '/history', '/method', '/settings']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
