import { expect, test } from '@playwright/test'
import { job, JOB_ID, mockApi, skipWelcome } from './mock-api'

test('the thinking orb names the current step, spins, and holds still for reduced motion', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.route(`**/api/analyses/${JOB_ID}`, (route) =>
    route.fulfill({ json: { ...job, status: 'running', verdict: null, current_step: 'c2pa' } }),
  )
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByRole('status')).toHaveText('Checking Content Credentials…')

  const frame = () => page.getByRole('status').locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL())
  const moving = await frame()
  await page.waitForTimeout(300)
  expect(await frame()).not.toBe(moving)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  const still = await frame()
  await page.waitForTimeout(300)
  expect(await frame()).toBe(still)
})
