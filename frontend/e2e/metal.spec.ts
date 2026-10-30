import { expect, test, type Page } from '@playwright/test'
import { job, JOB_ID, mockApi, skipWelcome } from './mock-api'

// The liquid metal (metal-fx) draws with WebGL; its wrapper stays hidden until the first frame lands.
const shown = (page: Page, where: string) => page.locator(`${where} .metal-fx-root`).first()

test('a live server reads LIVE in metal: in the phone bar, in the rail, and by name for screen readers', async ({ page }) => {
  await skipWelcome(page)
  // not answering yet: the connecting orb and its words, no badge
  await page.route('**/api/**', () => {})
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const bar = page.locator('header')
  await expect(bar.getByText('Connecting')).toBeAttached()
  await expect(bar.locator('.metal-badge')).toHaveCount(0)

  // answering: the LIVE badge, named "API online"
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page)
  await page.reload()
  await expect(bar.locator('.metal-badge')).toBeVisible()
  await expect(bar.getByText('API online')).toBeAttached()
  await expect(shown(page, 'header')).toBeVisible()

  await page.setViewportSize({ width: 1280, height: 860 })
  const rail = page.locator('aside')
  await expect(rail.locator('.metal-badge')).toBeVisible()
  await expect(shown(page, 'aside')).toBeVisible()
})

test("only the phone bar's + wears metal; the drop zone has neither metal nor an orb", async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/new')
  const zone = page.getByRole('region', { name: 'Upload an image' })
  await expect(zone.getByRole('button', { name: 'Choose image' })).toBeVisible()
  await expect(zone.locator('.metal-fx-root')).toHaveCount(0)
  await expect(zone.locator('canvas')).toHaveCount(0)
  // the + keeps its ring, and stays a button of its own size
  const plus = page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'New analysis' })
  await expect(page.locator('nav .metal-fx-root')).toBeVisible()
  const box = (await plus.boundingBox())!
  expect(Math.round(box.width)).toBe(58)
})

test('an analysis under way is LIVE in metal beside its name', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.route(`**/api/analyses/${JOB_ID}`, (route) =>
    route.fulfill({ json: { ...job, status: 'running', verdict: null, current_step: 'detector' } }),
  )
  await page.goto(`/analysis/${JOB_ID}`)
  const progress = page.getByRole('region', { name: 'Progress' })
  await expect(progress.locator('.metal-badge')).toBeVisible()
  await expect(progress.getByText('Live', { exact: true })).toBeAttached()
})
