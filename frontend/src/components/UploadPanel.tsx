import { ClipboardPaste, FileImage, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { formatBytes } from '../lib/format'
import { ACCEPTED, MAX_MB, imageFromClipboard, rejectReason, useUpload } from '../lib/upload'

// Touch screens have no drag and drop, so the zone words itself as a picker there.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const typeOf = (file: File) => (file.type.split('/')[1] ?? 'image').replace('jpeg', 'jpg').toUpperCase()

/**
 * The way in: a dashed drop zone holding the file (or a small upload icon until there is one), one
 * clear button under it, and Paste beside it. Choose, drop or paste an image. On the workspace the
 * file waits for "Analyze image"; with `autoStart` (the upload page) it goes as soon as it is chosen.
 * While uploading, the zone shows the time left with a progress bar and a cancel button. Pass
 * `upload` to share the upload with the page (a shared image from the phone's share menu).
 */
export function UploadPanel({
  upload,
  autoStart = false,
  className = '',
}: {
  upload?: ReturnType<typeof useUpload>
  autoStart?: boolean
  className?: string
}) {
  const own = useUpload()
  const { state, start, cancel, fail, clear } = upload ?? own
  const input = useRef<HTMLInputElement>(null)
  const [picked, setPicked] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(false) // HEIC and TIFF have no preview in most browsers
  const [dragging, setDragging] = useState(false)
  const busy = state.kind === 'uploading'
  const file = state.kind === 'uploading' ? state.file : picked
  const shownPreview = state.kind === 'uploading' ? state.preview : preview

  const take = useCallback(
    (next: File) => {
      if (autoStart) return start(next)
      const reason = rejectReason(next)
      if (reason) return fail(reason)
      clear()
      setPicked(next)
      setUnreadable(false)
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(next)
      })
    },
    [autoStart, start, fail, clear],
  )
  const drop = () => {
    setPicked(null)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
  }
  const choose = () => !busy && input.current?.click()

  // Paste an image anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (pasted) take(pasted)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [take])

  async function paste() {
    try {
      const pasted = await imageFromClipboard()
      if (pasted) take(pasted)
      else fail('There is no image on the clipboard. Copy one first, or choose a file.')
    } catch {
      fail('This browser did not allow reading the clipboard. Press Ctrl+V on this page instead.')
    }
  }

  const title = busy ? 'Uploading' : file ? file.name || 'Pasted image' : TOUCH ? 'Choose a photo' : dragging ? 'Release to add it' : 'Drop an image here'
  const detail =
    state.kind === 'uploading'
      ? `${typeOf(state.file)} · ${formatBytes(state.file.size)} · ${
          state.progress >= 1 ? 'starting the analysis…' : state.secondsLeft !== null ? `${state.secondsLeft} sec left` : 'starting…'
        }`
      : file
        ? `${typeOf(file)} · ${formatBytes(file.size)} · ready to analyze`
        : `JPEG, PNG, WebP, TIFF or HEIC, up to ${MAX_MB} MB`

  return (
    <section aria-label="Upload an image" className={`panel min-w-0 rounded-xl p-3 ${className}`}>
      <div
        onClick={() => !file && choose()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const dropped = e.dataTransfer.files[0]
          if (dropped && !busy) take(dropped)
        }}
        className={`flex items-center gap-3 rounded-lg border-[1.5px] border-dashed p-3 transition ${
          dragging ? 'border-ink bg-hover' : 'border-line-strong'
        } ${file ? '' : 'cursor-pointer hover:bg-hover'}`}
      >
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-raised text-muted">
          {file && shownPreview && !unreadable ? (
            <img src={shownPreview} alt="" onError={() => setUnreadable(true)} className="size-full object-cover" />
          ) : file ? (
            <FileImage className="size-5" strokeWidth={1.5} />
          ) : (
            <Upload className="size-5" strokeWidth={1.5} />
          )}
        </span>
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="truncate text-[15px] font-medium">{title}</p>
          <p className="truncate text-[13px] text-faint tabular-nums">{detail}</p>
        </div>
        {busy ? (
          <button type="button" onClick={cancel} className="well size-9" aria-label="Cancel upload">
            <X className="size-4" />
          </button>
        ) : (
          picked && (
            <button type="button" onClick={drop} className="well size-9" aria-label="Remove the image">
              <X className="size-4" />
            </button>
          )
        )}
      </div>

      {state.kind === 'uploading' && (
        <div
          className="mt-2.5 h-1 overflow-hidden rounded-full bg-line"
          role="progressbar"
          aria-label="Upload progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(state.progress * 100)}
        >
          <div className="h-full rounded-full bg-ink transition-[width] duration-300" style={{ width: `${Math.max(3, state.progress * 100)}%` }} />
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="mt-2.5 text-[14px] font-medium text-ai">
          {state.message}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        {picked && !busy ? (
          <button type="button" onClick={() => start(picked)} className="btn-primary h-11 flex-1">
            Analyze image
          </button>
        ) : (
          <button type="button" onClick={choose} disabled={busy} className="btn-primary h-11 flex-1">
            <Upload className="size-4" strokeWidth={2} /> Choose image
          </button>
        )}
        <button type="button" onClick={paste} disabled={busy} className="btn-ghost h-11 px-4">
          <ClipboardPaste className="size-4" strokeWidth={1.5} /> Paste
        </button>
      </div>
      <p className="mt-2.5 px-0.5 text-[13px] text-faint">
        {busy ? 'If the server was asleep, the first upload can take up to a minute. ' : 'The file is deleted after the analysis. '}
        <Link to={DEMO_REPORT_PATH} className="text-ink underline decoration-line-strong underline-offset-4">
          See an example report
        </Link>
      </p>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => {
          const next = e.target.files?.[0]
          if (next) take(next)
          e.target.value = ''
        }}
      />
    </section>
  )
}
