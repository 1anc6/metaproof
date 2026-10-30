import type { BrowserContext, Page } from '@playwright/test'

export const SHA = 'a'.repeat(64)
export const JOB_ID = '11111111-2222-3333-4444-555555555555'

const now = new Date().toISOString()

/** A finished analysis of a camera photo that leans real, shaped like GET /api/analyses/{id}. */
export const job = {
  job_id: JOB_ID,
  status: 'done',
  error: null,
  pipeline_version: '0.4.0',
  created_at: now,
  finished_at: now,
  media: { sha256: SHA, mime_type: 'image/jpeg', size_bytes: 123456, width: 1280, height: 960, first_seen_at: now },
  verdict: {
    label: 'inconclusive',
    confidence: null,
    engine_version: 'test',
    scores: { authentic: 1, edited: 0, ai: 0 },
    top_reasons: [],
  },
  analyzers: [
    {
      analyzer: 'metadata', version: '0.2.0', ok: true, duration_ms: 12, error: null,
      findings: [
        { code: 'meta.camera_capture', signal: 'authentic', strength: 'weak', message: 'Camera capture metadata present (Canon EOS R6).' },
        { code: 'meta.camera_original', signal: 'authentic', strength: 'weak', message: 'The file has the structure of a camera original.' },
      ],
      raw: { fields: { has_exif: true, make: 'Canon', model: 'EOS R6', has_makernote: true, exif_size_matches: true, thumbnail_similarity: 0.99 } },
    },
    {
      analyzer: 'watermark', version: '1.0.0', ok: true, duration_ms: 40, error: null,
      findings: [{ code: 'watermark.none', signal: 'neutral', strength: 'weak', message: 'No known invisible generator watermark found.' }],
      raw: { checked: true, marks: { 'Stable Diffusion XL': 24 } },
    },
  ],
}

// 1x1 transparent PNG for thumbnails.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

export const status = {
  database_mb: 9.2, storage_warn_mb: 400, storage_limit_mb: 512, retention_days: 1,
  analyses_24h: 14, failed_24h: 0, daily_cap: 500, last_analysis_at: now, pipeline_version: '0.4.0',
}

export interface ApiLog {
  uploads: string[] // raw multipart bodies sent to POST /api/analyses
}

/** Fakes every /api route the frontend calls. Works for the page and its service worker. */
export async function mockApi(
  target: BrowserContext | Page,
  overrides: { status?: Partial<typeof status> | 'down' } = {},
): Promise<ApiLog> {
  const log: ApiLog = { uploads: [] }
  await target.route('**/api/**', async (route) => {
    const req = route.request()
    const { pathname } = new URL(req.url())
    if (pathname === '/api/health') return route.fulfill({ json: { status: 'ok' } })
    if (pathname === '/api/status') {
      if (overrides.status === 'down') return route.abort('connectionrefused')
      return route.fulfill({ json: { ...status, ...overrides.status } })
    }
    if (pathname === '/api/analyses' && req.method() === 'POST') {
      log.uploads.push(req.postDataBuffer()?.toString('latin1') ?? '')
      return route.fulfill({ status: 202, json: { job_id: JOB_ID, sha256: SHA, status: 'queued', duplicate: false } })
    }
    if (pathname === '/api/analyses') {
      return route.fulfill({
        json: [{ job_id: JOB_ID, status: 'done', sha256: SHA, mime_type: 'image/jpeg', size_bytes: 123456, width: 1280, height: 960, label: 'inconclusive', confidence: null, created_at: now, finished_at: now }],
      })
    }
    if (pathname === `/api/analyses/${JOB_ID}` || pathname === `/api/media/${SHA}/report`) return route.fulfill({ json: job })
    if (pathname.endsWith('/similar')) return route.fulfill({ json: [] })
    if (pathname.endsWith('/thumbnail')) return route.fulfill({ body: PNG, contentType: 'image/png' })
    return route.fulfill({ status: 404, json: { detail: 'Not found' } })
  })
  return log
}

/** Hide the first-visit welcome screen for tests that are about something else. */
export async function skipWelcome(target: BrowserContext | Page) {
  await target.addInitScript(() => localStorage.setItem('metaproof.welcome.v1', 'seen'))
}

/** Pretend this browser already analyzed the sample job. */
export async function seedHistory(target: BrowserContext | Page) {
  await target.addInitScript(([jobId, sha]) => {
    localStorage.setItem('metaproof.history.v1', JSON.stringify([
      { jobId, sha256: sha, filename: 'holiday.jpg', sizeBytes: 123456, uploadedAt: new Date().toISOString() },
    ]))
  }, [JOB_ID, SHA])
}
