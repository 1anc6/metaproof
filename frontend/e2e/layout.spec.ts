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

test('desktop: content panel is level with the sidebar, 12px from it', async ({ page }) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    const sidebar = await page.locator('aside > div').boundingBox()
    const hero = await page.locator('main section').first().boundingBox()
    expect(sidebar && hero).toBeTruthy()
    expect(Math.abs(hero!.y - sidebar!.y)).toBeLessThanOrEqual(1)
    expect(Math.round(hero!.x - (sidebar!.x + sidebar!.width))).toBe(12)
  }
})

test('mobile: the new-analysis button sits exactly in the middle of the tab bar', async ({ page }) => {
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    await expect(nav.getByRole('link')).toHaveCount(5) // two tabs each side of the + button
    const plus = await nav.getByRole('link', { name: 'New analysis' }).boundingBox()
    expect(Math.abs(plus!.x + plus!.width / 2 - width / 2)).toBeLessThanOrEqual(1)
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible()
  }
})

test('no horizontal scrolling on a small phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  for (const path of ['/', '/new', '/history', '/method', '/settings']) {
    await page.goto(path)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, path).toBeLessThanOrEqual(0)
  }
})
