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

test('desktop: the top bar and the content share one centred column', async ({ page }) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.locator('main section').first().waitFor()
    const bar = await page.locator('header').first().boundingBox()
    const main = await page.locator('main').boundingBox()
    expect(bar && main).toBeTruthy()
    expect(bar!.y).toBe(0)
    // the column is centred, with the same margin either side
    expect(Math.abs(main!.x - (width - main!.x - main!.width))).toBeLessThanOrEqual(1)
  }
})

test('phones and tablets: the new-analysis orb sits exactly in the middle of the dock', async ({ page }) => {
  for (const width of [375, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link')).toHaveCount(5) // two tabs each side of the + button
    const plus = await nav.getByRole('link', { name: 'New analysis' }).boundingBox()
    expect(Math.abs(plus!.x + plus!.width / 2 - width / 2)).toBeLessThanOrEqual(1)
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
  }
})

test('desktop: the navigation sits in the top bar, and nothing floats over the page', async ({ page }) => {
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 700 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav).toHaveCount(1) // the dock is gone at this width
    await expect(nav.getByRole('link')).toHaveCount(4)
    expect((await nav.boundingBox())!.y).toBeLessThan(76)
    await expect(page.getByRole('banner').getByRole('link', { name: 'New analysis' })).toBeVisible()
    // the app opens on the workspace, not a landing page
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /Arrow keys choose another check/ })).toBeInViewport()
  }
})

test('phones: the workspace opens with the canvas and the upload button above the fold', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Arrow keys choose another check/ })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'Choose image' })).toBeInViewport()
})

test('no horizontal scrolling on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  for (const path of ['/', '/new', '/history', '/method', '/settings']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
