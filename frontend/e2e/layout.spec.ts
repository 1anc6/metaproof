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

test('desktop: the sidebar runs the full height on the left, content clears it by 48px or more', async ({ page }) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.locator('main section').first().waitFor()
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'))
    const sidebar = await page.locator('aside').boundingBox()
    const hero = await page.locator('main section').first().boundingBox()
    expect(sidebar && hero).toBeTruthy()
    expect(sidebar!.x).toBe(0)
    expect(sidebar!.y).toBe(0)
    expect(sidebar!.height).toBe(900)
    expect(hero!.x - (sidebar!.x + sidebar!.width)).toBeGreaterThanOrEqual(48)
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
