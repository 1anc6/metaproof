import { deflateSync } from 'node:zlib'
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

test('a sleeping server is waited for, not reported as a failure', async ({ page }) => {
  const api = await mockApi(page)
  // Render's proxy answers 503 while the free instance wakes up, then the API takes over.
  let waking = 2
  await page.route('**/api/analyses', (route) =>
    route.request().method() === 'POST' && waking-- > 0
      ? route.fulfill({ status: 503, body: 'waking up' })
      : route.fallback(),
  )
  await skipWelcome(page)
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(PHOTO)

  await expect(page).toHaveURL(new RegExp(`/analysis/${JOB_ID}$`), { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Inconclusive' })).toBeVisible()
  expect(api.uploads).toHaveLength(1)
})

test('a report that leans real explains why in plain words', async ({ page }) => {
  await mockApi(page)
  await skipWelcome(page)
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByText(/camera data and the structure of an untouched camera file, and no signs of AI/)).toBeVisible()
  await expect(page.getByText(/probably real but unverified/)).toBeVisible()

  await page.getByRole('button', { name: 'Analysis details' }).click()
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

test('an image over 24 MP is turned away before it is uploaded', async ({ page }) => {
  const api = await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new')
  await expect(page.getByText(/up to 25 MB and 24 megapixels/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: blankPng(5000, 5000) })
  await expect(page.getByText('That image is 25.0 MP. The limit is 24 MP.')).toBeVisible()
  expect(api.uploads).toHaveLength(0)
})

test('several images go one after another, then History follows them; unusable ones are named', async ({ page }) => {
  const api = await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new')
  await expect(page.getByText(/Choose up to 10 at once/)).toBeVisible()
  await page.locator('input[type=file]').setInputFiles([
    { ...PHOTO, name: 'one.jpg' },
    { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') },
    { ...PHOTO, name: 'two.jpg' },
  ])
  await expect(page).toHaveURL(/\/history$/)
  expect(api.uploads).toHaveLength(2)
  expect(api.uploads.join('')).not.toMatch(/one\.jpg|two\.jpg/) // filenames still never leave the device
  await expect(page.getByText('2 images sent for analysis')).toBeVisible()
  await expect(page.getByText('One image was not sent')).toBeVisible()
  await expect(page.getByText(/notes\.pdf: Unsupported file type/)).toBeVisible()
})

test('a batch is capped at 10, and says how many were left out', async ({ page }) => {
  const api = await mockApi(page)
  await skipWelcome(page)
  await page.goto('/new')
  await page.locator('input[type=file]').setInputFiles(Array.from({ length: 12 }, (_, i) => ({ ...PHOTO, name: `p${i}.jpg` })))
  await expect(page).toHaveURL(/\/history$/)
  expect(api.uploads).toHaveLength(10)
  await expect(page.getByText('2 images were not sent')).toBeVisible()
  await expect(page.getByText(/2 more: MetaProof takes up to 10 images at a time/)).toBeVisible()
})

/** A black greyscale PNG of any size; zeros compress to a few kB even at 25 MP. */
function blankPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth; colour type 0 (greyscale), no interlace
  const rows = Buffer.alloc((width + 1) * height) // each row: filter byte 0, then black pixels
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function crc32(bytes: Buffer) {
  let c = ~0
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

test('a Gemini-style report: the AI-generated original, decisive bars, an overruled detector', async ({ page }) => {
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
  const detector = {
    analyzer: 'detector', version: '1', ok: true, duration_ms: 7000, error: null,
    findings: [{ code: 'detector.uncertain', signal: 'neutral', strength: 'weak', message: 'The AI-image detector is unsure (32% AI).' }],
    raw: { available: true, p_ai: 0.32 },
  }
  await page.route(`**/api/analyses/${JOB_ID}`, (route) => route.fulfill({
    json: {
      ...job,
      verdict: {
        ...job.verdict, label: 'likely_ai_generated', confidence: 0.99,
        scores: { authentic: 0, edited: 1, ai: 10 }, top_reasons: c2pa.findings,
      },
      analyzers: [c2pa, detector],
    },
  }))
  await page.goto(`/analysis/${JOB_ID}`)
  await expect(page.getByRole('heading', { name: 'Likely AI-generated' })).toBeVisible()
  // The detector's low score is qualified, and the bars agree with the verdict.
  await expect(page.getByText(/A low score does not mean a photo is real/).first()).toBeVisible()
  await expect(page.getByText('conclusive', { exact: true })).toBeVisible()
  await expect(page.getByText(/Decided by conclusive evidence/)).toBeVisible()
  await page.getByRole('button', { name: 'Analysis details' }).click()
  await page.getByRole('button', { name: /Content Credentials/ }).click()
  await expect(page.getByText('Earlier history: the original it was made from')).toBeVisible()
  await expect(page.getByText('· trainedAlgorithmicMedia')).toBeVisible()
})
