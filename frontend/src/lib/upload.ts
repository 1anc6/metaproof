import { useCallback, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { api } from './api'
import { formatBytes } from './format'
import { addToHistory } from './history'
import { rememberPreview } from './preview'

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif']
export const MAX_MB = 25
// The server's max_image_pixels (backend/app/config.py), which keeps decoding inside Render's 512 MB.
export const MAX_MP = 24

// Images taken in one go. The server allows 20 uploads an hour from one address; 10 leaves room.
export const MAX_BATCH = 10

export type UploadState =
  | { kind: 'idle' }
  | {
      kind: 'uploading'
      file: File
      progress: number
      preview: string
      startedAt: number
      secondsLeft: number | null
      /** Set when several images go one after another: which one this is, from 0. */
      batch?: { index: number; total: number }
    }
  | { kind: 'error'; message: string }

/** Why a file can't be analyzed, before anything is sent; the server re-checks everything. */
export async function rejectReason(file: File): Promise<string | null> {
  if (file.type && !ACCEPTED.includes(file.type)) return 'Unsupported file type. Use a JPEG, PNG, WebP, TIFF or HEIC image.'
  if (file.size > MAX_MB * 1024 * 1024) return `That file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`
  const mp = await megapixels(file)
  if (mp !== null && mp > MAX_MP) return `That image is ${mp.toFixed(1)} MP. The limit is ${MAX_MP} MP.`
  return null
}

/** The image's size in megapixels, or null where the browser can't read it (HEIC and TIFF in most). */
function megapixels(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve((img.naturalWidth * img.naturalHeight) / 1_000_000)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
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

  /** Uploads one checked file with progress and time left, and remembers it on this device. */
  const send = useCallback(async (file: File, signal: AbortSignal, batch?: { index: number; total: number }) => {
    // A local preview of the picked file; nothing extra leaves the browser.
    const preview = URL.createObjectURL(file)
    setState({ kind: 'uploading', file, progress: 0, preview, startedAt: performance.now(), secondsLeft: null, batch })
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
        signal,
      )
      rememberPreview(created.job_id, preview)
      addToHistory({
        jobId: created.job_id,
        sha256: created.sha256,
        filename: file.name || 'pasted-image',
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
      })
      return created
    } catch (e) {
      URL.revokeObjectURL(preview)
      throw e
    }
  }, [])

  const start = useCallback(
    async (file: File) => {
      const reason = await rejectReason(file)
      if (reason) {
        setState({ kind: 'error', message: reason })
        return
      }
      const ctrl = new AbortController()
      controller.current = ctrl
      try {
        const created = await send(file, ctrl.signal)
        navigate(`/analysis/${created.job_id}`)
      } catch (e) {
        setState((e as Error).name === 'AbortError' ? { kind: 'idle' } : { kind: 'error', message: (e as Error).message })
      } finally {
        if (controller.current === ctrl) controller.current = null
      }
    },
    [navigate, send],
  )

  /**
   * Several images: each is checked, then they go one after another (the server analyzes one at a
   * time anyway) and History follows their verdicts as they come in. One image is just `start`.
   */
  const startMany = useCallback(
    async (files: File[]) => {
      if (files.length <= 1) return files[0] && start(files[0])
      const checked = await Promise.all(files.map(async (file) => ({ file, reason: await rejectReason(file) })))
      const accepted = checked.filter((c) => !c.reason).map((c) => c.file)
      const batch = accepted.slice(0, MAX_BATCH)
      const refused = checked.filter((c) => c.reason)
      const notSent = refused.length + accepted.length - batch.length
      const notes = [
        ...refused.map((c) => `${c.file.name || 'An image'}: ${c.reason}`),
        ...(accepted.length > MAX_BATCH ? [`${accepted.length - MAX_BATCH} more: MetaProof takes up to ${MAX_BATCH} images at a time.`] : []),
      ]
      if (batch.length === 0) {
        setState({ kind: 'error', message: refused.length === 1 ? refused[0].reason! : `None of these can be analyzed. ${notes[0]}` })
        return
      }

      const ctrl = new AbortController()
      controller.current = ctrl
      let sent = 0
      try {
        for (const [index, file] of batch.entries()) {
          await send(file, ctrl.signal, { index, total: batch.length })
          sent++
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') {
          setState({ kind: 'idle' })
          if (sent) toast(`Stopped after ${sent} of ${batch.length}`, { description: 'The ones already sent are in History.' })
        } else {
          const message = (e as Error).message
          setState({ kind: 'error', message: sent ? `${sent} of ${batch.length} sent; the rest stopped. ${message}` : message })
        }
        return
      } finally {
        if (controller.current === ctrl) controller.current = null
      }
      navigate('/history')
      toast.success(`${sent} images sent for analysis`, { description: 'Their verdicts appear here as each one finishes.' })
      if (notSent) toast.warning(`${notSent === 1 ? 'One image was' : `${notSent} images were`} not sent`, { description: notes.join(' ') })
    },
    [navigate, send, start],
  )

  const cancel = useCallback(() => controller.current?.abort(), [])
  const fail = useCallback((message: string) => setState({ kind: 'error', message }), [])
  const clear = useCallback(() => setState({ kind: 'idle' }), [])

  return { state, start, startMany, cancel, fail, clear }
}

// A file picked away from the upload page (the phone bar's + menu), left for that page to start.
let handed: File | null = null

/** Leaves a file for New analysis, which starts it when it opens. */
export function handOver(file: File) {
  handed = file
}

/** The file left by handOver, once. */
export function takeHandedFile() {
  const file = handed
  handed = null
  return file
}

/** The first image on the clipboard, read where the browser allows it. Throws if it may not read. */
export async function imageFromClipboard(): Promise<File | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((t) => t.startsWith('image/'))
    if (type) return new File([await item.getType(type)], `pasted.${type.split('/')[1]}`, { type })
  }
  return null
}
