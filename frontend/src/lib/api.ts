// Typed client for the MetaProof API. In development Vite proxies /api; in production
// VITE_API_URL points at the Render service.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export type Signal = 'authentic' | 'edited' | 'ai' | 'neutral'
export type Strength = 'weak' | 'moderate' | 'strong' | 'conclusive'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed'
export type VerdictLabel = 'likely_authentic' | 'edited' | 'likely_ai_generated' | 'inconclusive'

export interface Finding {
  code: string
  signal: Signal
  strength: Strength
  message: string
}

export interface AnalyzerResult {
  analyzer: string
  version: string
  ok: boolean
  duration_ms: number
  error: string | null
  findings: Finding[]
  raw: Record<string, unknown>
}

export interface Verdict {
  label: VerdictLabel
  confidence: number | null
  engine_version: string
  scores: Record<'authentic' | 'edited' | 'ai', number>
  top_reasons: Finding[]
}

export interface Media {
  sha256: string
  mime_type: string
  size_bytes: number
  width: number
  height: number
  first_seen_at: string
}

export interface Job {
  job_id: string
  status: JobStatus
  error: string | null
  pipeline_version: string
  created_at: string
  finished_at: string | null
  media: Media
  verdict: Verdict | null
  analyzers: AnalyzerResult[]
}

export interface JobSummary {
  job_id: string
  status: JobStatus
  sha256: string
  mime_type: string
  size_bytes: number
  width: number
  height: number
  label: VerdictLabel | null
  confidence: number | null
  created_at: string
  finished_at: string | null
}

export interface JobCreated {
  job_id: string
  sha256: string
  status: JobStatus
  duplicate: boolean
}

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, init)
  } catch {
    throw new ApiError(0, 'Cannot reach the MetaProof server. Check your connection and try again.')
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res))
  return res.json() as Promise<T>
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
  job: (id: string) => request<Job>(`/api/analyses/${encodeURIComponent(id)}`),
  report: (sha: string) => request<Job>(`/api/media/${encodeURIComponent(sha)}/report`),
  jobs: (ids: string[]) => {
    if (ids.length === 0) return Promise.resolve([] as JobSummary[])
    const qs = new URLSearchParams()
    ids.slice(0, 100).forEach((id) => qs.append('ids', id))
    return request<JobSummary[]>(`/api/analyses?${qs}`)
  },
  thumbnailUrl: (sha: string) => `${BASE}/api/media/${encodeURIComponent(sha)}/thumbnail`,

  /** XHR instead of fetch so the UI can show upload progress. */
  upload(file: File, onProgress?: (fraction: number) => void): Promise<JobCreated> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${BASE}/api/analyses`)
      xhr.responseType = 'json'
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
      xhr.onerror = () =>
        reject(new ApiError(0, 'Cannot reach the MetaProof server. Check your connection and try again.'))
      const form = new FormData()
      form.append('file', file)
      xhr.send(form)
    })
  },
}
