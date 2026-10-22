import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from './api'
import { formatBytes } from './format'
import { addToHistory } from './history'
import { rememberPreview } from './preview'

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif']
export const MAX_MB = 25

export type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; file: File; progress: number; preview: string; startedAt: number; secondsLeft: number | null }
  | { kind: 'error'; message: string }

/** Why a file can't be analyzed, before anything is sent; the server re-checks everything. */
export function rejectReason(file: File): string | null {
  if (file.type && !ACCEPTED.includes(file.type)) return 'Unsupported file type. Use a JPEG, PNG, WebP, TIFF or HEIC image.'
  if (file.size > MAX_MB * 1024 * 1024) return `That file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`
  return null
}

/**
 * Uploading an image for analysis, shared by the workspace's composer and the upload page: checks
 * the file, uploads it with progress and time left, remembers it on this device, and opens its
 * analysis. `cancel` stops an upload in flight; `paste` reads an image from the clipboard.
 */
export function useUpload(initial: UploadState = { kind: 'idle' }) {
  const navigate = useNavigate()
  const controller = useRef<AbortController | null>(null)
  const [state, setState] = useState<UploadState>(initial)

  const start = useCallback(
    async (file: File) => {
      const reason = rejectReason(file)
      if (reason) {
        setState({ kind: 'error', message: reason })
        return
      }
      // A local preview of the picked file; nothing extra leaves the browser.
      const preview = URL.createObjectURL(file)
      const ctrl = new AbortController()
      controller.current = ctrl
      setState({ kind: 'uploading', file, progress: 0, preview, startedAt: performance.now(), secondsLeft: null })
      try {
        const created = await api.upload(
          file,
          (progress) =>
            setState((s) => {
              if (s.kind !== 'uploading') return s
              // Time left, from the pace so far; only once there is enough of it to go on.
              const elapsed = (performance.now() - s.startedAt) / 1000
              const secondsLeft = progress > 0.05 && progress < 1 ? Math.ceil((elapsed * (1 - progress)) / progress) : null
              return { ...s, progress, secondsLeft }
            }),
          ctrl.signal,
        )
        rememberPreview(created.job_id, preview)
        addToHistory({
          jobId: created.job_id,
          sha256: created.sha256,
          filename: file.name || 'pasted-image',
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
        })
        navigate(`/analysis/${created.job_id}`)
      } catch (e) {
        URL.revokeObjectURL(preview)
        setState((e as Error).name === 'AbortError' ? { kind: 'idle' } : { kind: 'error', message: (e as Error).message })
      } finally {
        if (controller.current === ctrl) controller.current = null
      }
    },
    [navigate],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])
  const fail = useCallback((message: string) => setState({ kind: 'error', message }), [])
  const clear = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, start, cancel, fail, clear }
}

/** The first image on the clipboard, read where the browser allows it. Throws if it may not read. */
export async function imageFromClipboard(): Promise<File | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return new File([await item.getType(type)], `pasted.${type.split('/')[1]}`, { type })
  }
  return null
}
