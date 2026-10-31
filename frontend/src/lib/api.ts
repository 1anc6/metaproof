// Typed client for the MetaProof API. In development Vite proxies /api; in production
// VITE_API_URL points at the Render service.
import type { components } from './api-schema'

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

// The types come from the API's own schema (backend/openapi.json, generated into api-schema.ts
// by `npm run gen:api`), so they cannot drift from what the server sends. CI checks both files
// are up to date.
type Schemas = components['schemas']

export type Signal = Schemas['Signal']
export type Strength = Schemas['Strength']
export type JobStatus = Schemas['JobStatus']
export type VerdictLabel = Schemas['VerdictLabel']
/** What a running job is doing: an analyzer, then weighing the evidence. */
export type AnalysisStep = Schemas['AnalysisStep']

export type Finding = Schemas['FindingOut']
export type AnalyzerResult = Schemas['AnalyzerOut']
export type Verdict = Schemas['VerdictOut']
export type Media = Schemas['MediaOut']
export type Job = Schemas['JobOut']
export type JobSummary = Schemas['JobSummary']
export type SimilarMedia = Schemas['SimilarMedia']
export type ServiceStatus = Schemas['ServiceStatus']
export type JobCreated = Schemas['JobCreated']

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const UNREACHABLE = 'Cannot reach the MetaProof server. Check your connection and try again.'

// The free Render instance sleeps when idle. While it wakes (up to a few minutes) requests hang,
// drop, or get a 502/503/504 from Render's proxy. Those are worth retrying; anything else is not.
const WAKE_BUDGET_MS = 180_000
const ATTEMPT_TIMEOUT_MS = 60_000

function isTransient(status: number) {
  return status === 0 || status === 502 || status === 503 || status === 504
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Runs `attempt` until it succeeds, fails for good, or the wake-up budget runs out. */
async function withWakeRetry<T>(attempt: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + WAKE_BUDGET_MS
  for (let delay = 1000; ; delay = Math.min(delay * 2, 15_000)) {
    try {
      return await attempt()
    } catch (e) {
      if (!(e instanceof ApiError) || !isTransient(e.status) || Date.now() + delay > deadline) throw e
      await sleep(delay)
    }
  }
}

async function request<T>(path: string, { retry = true } = {}): Promise<T> {
  const attempt = async () => {
    let res: Response
    try {
      res = await fetch(BASE + path, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) })
    } catch {
      throw new ApiError(0, UNREACHABLE)
    }
    if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
    return res.json() as Promise<T>
  }
  return retry ? withWakeRetry(attempt) : attempt()
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json()
    if (typeof body.detail === 'string') return body.detail
  } catch {
    /* not JSON */
  }
  return `The server returned an error (${res.status}).`
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  // Informational only: say at once that it is unavailable rather than wait out a wake-up.
  status: () => request<ServiceStatus>('/api/status', { retry: false }),
  job: (id: string) => request<Job>(`/api/analyses/${encodeURIComponent(id)}`),
  report: (sha: string) => request<Job>(`/api/media/${encodeURIComponent(sha)}/report`),
  jobs: (ids: string[]) => {
    if (ids.length === 0) return Promise.resolve([] as JobSummary[])
    const qs = new URLSearchParams()
    ids.slice(0, 100).forEach((id) => qs.append('ids', id))
    return request<JobSummary[]>(`/api/analyses?${qs}`)
  },
  similar: (sha: string) => request<SimilarMedia[]>(`/api/media/${encodeURIComponent(sha)}/similar`),
  thumbnailUrl: (sha: string) => `${BASE}/api/media/${encodeURIComponent(sha)}/thumbnail`,

  /** Safe to retry: the server de-duplicates by file hash and returns the existing job.
   *  `signal` cancels it, rejecting with an AbortError that is never retried. */
  upload: (file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal) =>
    withWakeRetry(() => uploadOnce(file, onProgress, signal)),
}

/** XHR instead of fetch so the UI can show upload progress. */
function uploadOnce(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<JobCreated> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('The upload was cancelled.', 'AbortError'))
    if (signal?.aborted) return aborted() // cancelled while waiting to retry
    const xhr = new XMLHttpRequest()
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.onabort = aborted
    xhr.open('POST', `${BASE}/api/analyses`)
    xhr.responseType = 'json'
    xhr.timeout = 5 * ATTEMPT_TIMEOUT_MS // a 25 MB file on a slow link
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onload = () => {
      const body = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as JobCreated)
      else
        reject(
          new ApiError(
            xhr.status,
            typeof body?.detail === 'string' ? body.detail : `Upload failed (${xhr.status}).`,
          ),
        )
    }
    xhr.onerror = xhr.ontimeout = () => reject(new ApiError(0, UNREACHABLE))
    const form = new FormData()
    // A neutral name: the real filename stays on this device (see lib/history.ts).
    form.append('file', file, 'upload')
    xhr.send(form)
  })
}
