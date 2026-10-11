import { expect, test } from '@playwright/test'
import { JOB_ID, job, mockApi, skipWelcome } from './mock-api'

const PHOTO = { name: 'my holiday.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]) }

test('upload sends no filename, then shows the report and remembers it on this device', async ({ page }) => {
  const api = await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(PHOTO)

  await expect(page).toHaveURL(new RegExp(`/analysis/${JOB_ID}$`))
  await expect(page.getByRole('heading', { name: 'Inconclusive' })).toBeVisible()
  await expect(page.getByText('leaning real')).toBeVisible()

  expect(api.uploads).toHaveLength(1)
  expect(api.uploads[0]).toContain('filename="upload"')
  expect(api.uploads[0]).not.toContain('holiday') // the real name stays on the device

  await page.goto('/history')
  await expect(page.getByText('my holiday.jpg')).toBeVisible()
})

test('a report that leans real explains why in plain words', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByText(/camera data and the structure of an untouched camera file, and no signs of AI/)).toBeVisible()
  await expect(page.getByText(/probably real but unverified/)).toBeVisible()

  await page.getByRole('button', { name: /Metadata/ }).click()
  await expect(page.getByText('Maker data')).toBeVisible()
  await expect(page.getByText('Matches the picture (0.99)')).toBeVisible()
  await page.getByRole('button', { name: /Invisible watermark/ }).click()
  await expect(page.getByText(/No known generator watermark/)).toBeVisible()
})

test('an unsupported file gets a clear message and is not uploaded', async ({ page }) => {
  const api = await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') })
  await expect(page.getByText(/Unsupported file type/)).toBeVisible()
  expect(api.uploads).toHaveLength(0)
})

test('Content Credentials show the AI-generated original behind an edited file', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  const c2pa = {
    analyzer: 'c2pa', version: '0.2.0', ok: true, duration_ms: 30, error: null,
    findings: [
      { code: 'c2pa.ai_generated', signal: 'ai', strength: 'conclusive', message: 'Signed Content Credentials from Google LLC show this image was made from an AI-generated original.' },
      { code: 'c2pa.signed_edits', signal: 'edited', strength: 'moderate', message: 'After it was generated, the signed edit history records: c2pa.converted, c2pa.edited.' },
    ],
    raw: {
      present: true, validation_state: 'Valid', validation_failures: [], signer_trusted: false,
      signer: 'Google LLC', claim_generator: 'Google C2PA Core Generator Library', ingredient_count: 1,
      actions: [
        { action: 'c2pa.opened', digital_source_type: '', software_agent: null },
        { action: 'c2pa.edited', digital_source_type: 'composite', software_agent: null },
        { action: 'c2pa.converted', digital_source_type: '', software_agent: null },
      ],
      history_actions: [{ action: 'c2pa.created', digital_source_type: 'trainedAlgorithmicMedia', software_agent: null }],
    },
  }
  await page.route(`**/api/analyses/${JOB_ID}`, (route) => route.fulfill({
    json: { ...job, verdict: { ...job.verdict, label: 'likely_ai_generated', scores: { authentic: 0, edited: 1, ai: 0 } }, analyzers: [c2pa] },
  }))
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByRole('heading', { name: 'Likely AI-generated' })).toBeVisible()
  await page.getByRole('button', { name: /Content Credentials/ }).click()
  await expect(page.getByText('Earlier history: the original it was made from')).toBeVisible()
  await expect(page.getByText('· trainedAlgorithmicMedia')).toBeVisible()
})
