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

test('where pictures are added: the connecting orb in a metal bezel, and the button beside Paste in metal too', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/new')
  const zone = page.getByRole('region', { name: 'Upload an image' })
  await expect(zone.locator('.orb canvas')).toHaveAttribute('data-orb', 'connecting')
  await expect(zone.locator('.metal-fx-root')).toHaveCount(2)
  await expect(zone.locator('.metal-fx-root').first()).toBeVisible()
  // the + in the phone bar wears it as well, and stays a button of its own size
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

test('the metal playground: its choices are kept in this browser, and Reset puts them back', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto('/settings')
  const metal = page.locator('section', { has: page.getByRole('heading', { name: 'Liquid metal' }) })
  await expect(metal.locator('.metal-fx-root')).toHaveCount(3) // the badge, the round + and the pill
  await expect(metal.getByRole('radio', { name: 'Chromatic' })).toHaveAttribute('aria-checked', 'true')

  await metal.getByRole('radio', { name: 'Gold' }).click()
  await metal.getByRole('switch', { name: 'Reflection', exact: true }).click()
  await metal.getByRole('switch', { name: 'Halo' }).click()
  await expect(metal.getByText('Glow strength')).toHaveCount(0)
  await metal.getByRole('button', { name: 'Pause the metal' }).click()

  await page.reload()
  await expect(metal.getByRole('radio', { name: 'Gold' })).toHaveAttribute('aria-checked', 'true')
  await expect(metal.getByRole('switch', { name: 'Reflection', exact: true })).toHaveAttribute('aria-checked', 'false')
  await expect(metal.getByRole('switch', { name: 'Halo' })).toHaveAttribute('aria-checked', 'false')
  await expect(metal.getByRole('button', { name: 'Play the metal' })).toBeVisible()

  await page.getByRole('button', { name: 'Reset the metal' }).click()
  await expect(metal.getByRole('radio', { name: 'Chromatic' })).toHaveAttribute('aria-checked', 'true')
  await expect(metal.getByRole('switch', { name: 'Reflection', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(metal.getByText('Glow strength')).toBeVisible()
  await expect(metal.getByRole('button', { name: 'Pause the metal' })).toBeVisible()
  // the cursor's reflection waits to be asked for
  await expect(metal.getByRole('switch', { name: 'Cursor reflection' })).toHaveAttribute('aria-checked', 'false')
})
