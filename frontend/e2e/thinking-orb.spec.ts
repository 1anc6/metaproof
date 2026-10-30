import { expect, test, type Locator } from '@playwright/test'
import { job, JOB_ID, mockApi, skipWelcome } from './mock-api'

const frame = (canvas: Locator) => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())

test('the thinking orb names the current step, spins, and holds still for reduced motion', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.route(`**/api/analyses/${JOB_ID}`, (route) =>
    route.fulfill({ json: { ...job, status: 'running', verdict: null, current_step: 'c2pa' } }),
  )
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByRole('status')).toHaveText('Checking Content Credentials…')

  const orb = page.getByRole('status').locator('canvas')
  const moving = await frame(orb)
  await page.waitForTimeout(300)
  expect(await frame(orb)).not.toBe(moving)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  const still = await frame(orb)
  await page.waitForTimeout(300)
  expect(await frame(orb)).toBe(still)
})

test('every step has its own orb, hashing draws the fingerprint, and waiting breathes', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  let reply: object = { ...job, status: 'queued', verdict: null }
  await page.route(`**/api/analyses/${JOB_ID}`, (route) => route.fulfill({ json: reply }))
  const pill = page.getByRole('status')
  const orb = pill.locator('canvas')

  await page.goto(`/analysis/${JOB_ID}`)
  await expect(pill).toHaveText('Waiting in the queue…')
  await expect(orb).toHaveAttribute('data-orb', 'breathing')

  for (const [step, state, label] of [
    ['upload', 'fingerprint', 'File received and hashed…'],
    ['metadata', 'searching', 'Reading metadata…'],
    ['structure', 'shaping', 'Inspecting the file structure…'],
    ['c2pa', 'connecting', 'Checking Content Credentials…'],
    ['watermark', 'listening', 'Looking for invisible watermarks…'],
    ['detector', 'solving', 'Running the AI-image detector…'],
    ['verdict', 'weaving', 'Weighing the evidence…'],
  ]) {
    reply = { ...job, status: 'running', verdict: null, current_step: step }
    await page.reload()
    await expect(pill).toHaveText(label)
    await expect(orb).toHaveAttribute('data-orb', state)
    // decoration beside words that already say it: hidden from screen readers
    await expect(orb).toHaveAttribute('aria-hidden', 'true')
  }

  // the tab's icon is the orb while it runs, so the analysis can be followed from another tab
  const icon = page.locator('link[rel="icon"]')
  await expect(icon).toHaveAttribute('href', /^data:image\/png/)
  reply = job
  await expect(page.getByText('Key findings')).toBeVisible()
  await expect(icon).toHaveAttribute('href', /\/favicon\.svg$/)
})
