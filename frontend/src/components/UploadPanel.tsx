import { ClipboardPaste, FileImage, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { formatBytes } from '../lib/format'
import { ACCEPTED, MAX_MB, imageFromClipboard, rejectReason, useUpload } from '../lib/upload'
import { FileName } from './ui'

// Touch screens have no drag and drop, so the zone words itself as a picker there.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

const typeOf = (file: File) => (file.type.split('/')[1] ?? 'image').replace('jpeg', 'jpg').toUpperCase()

/**
 * The way in, after the upload card reference: a dashed drop zone with a glowing lime disc and a line
 * on what makes a good upload; once there is a file, a white row with its preview, size and time
 * left over a blue bar; then two equal buttons. Choose, drop or paste an image. On the workspace the
 * file waits for "Analyze image"; with `autoStart` (the upload page) it goes as soon as it is chosen.
 * Pass `upload` to share the upload with the page (a shared image from the phone's share menu).
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
      setUnreadable(false)
      if (autoStart) return start(next)
      const reason = rejectReason(next)
      if (reason) return fail(reason)
      clear()
      setPicked(next)
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

  const title = busy
    ? 'Uploading your image'
    : dragging
      ? 'Release to add it'
      : picked
        ? TOUCH
          ? 'Choose another to replace it'
          : 'Drop another to replace it'
        : TOUCH
          ? 'Choose a photo to check'
          : 'Drop your image here'
  const detail =
    state.kind === 'uploading'
      ? `${typeOf(state.file)} · ${formatBytes(state.file.size)} · ${
          state.progress >= 1 ? 'starting the analysis…' : state.secondsLeft !== null ? `${state.secondsLeft} sec left` : 'starting…'
        }`
      : file
        ? `${typeOf(file)} · ${formatBytes(file.size)} · ready to analyze`
        : ''

  return (
    <section aria-label="Upload an image" className={`panel flex min-w-0 flex-col rounded-[32px] p-2.5 sm:p-3 ${className}`}>
      {/* The drop zone: what to do, the disc, and what makes a good upload. The whole zone picks a file. */}
      <div
        onClick={choose}
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
        className={`zone flex flex-1 flex-col items-center justify-center rounded-[24px] px-5 pt-6 pb-6 text-center transition ${
          busy ? '' : 'cursor-pointer hover:bg-[var(--panel-hover)]'
        } ${dragging ? '!border-primary bg-accent-soft' : ''}`}
      >
        <p className="text-[17px] font-semibold tracking-[-0.01em]" aria-live="polite">
          {title}
        </p>
        {/* The lime disc swells while a file is held over the zone, and its glow breathes then and
            while uploading. */}
        <span
          className={`orb mt-5 size-[112px] transition-transform duration-300 sm:size-[124px] ${dragging ? 'scale-105' : ''} ${dragging || busy ? 'orb-live' : ''}`}
          aria-hidden
        >
          <Upload className="size-10" strokeWidth={1.8} />
        </span>
        <p className="mt-6 max-w-[38ch] text-[14px] leading-relaxed text-faint">
          For the clearest verdict, upload the original file rather than a screenshot. JPEG, PNG, WebP, TIFF or HEIC, up
          to {MAX_MB} MB.
        </p>
      </div>

      {file && (
        <div className="raise animate-rise mt-2.5 rounded-[22px] p-2.5 pr-3">
          <div className="flex items-center gap-3">
            <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-accent-soft text-primary shadow-[inset_0_0_0_1px_rgb(255_255_255/0.7)]">
              {shownPreview && !unreadable ? (
                <img src={shownPreview} alt="" onError={() => setUnreadable(true)} className="size-full object-cover" />
              ) : (
                <FileImage className="size-6" strokeWidth={1.6} />
              )}
            </span>
            <div className="min-w-0 flex-1" aria-live="polite">
              <FileName name={file.name || 'Pasted image'} className="text-[15px] font-semibold" />
              <p className="mt-0.5 truncate text-[13.5px] text-faint tabular-nums">{detail}</p>
            </div>
            <button
              type="button"
              onClick={busy ? cancel : drop}
              className="icon-btn size-10"
              aria-label={busy ? 'Cancel upload' : 'Remove the image'}
            >
              <X className="size-4" strokeWidth={1.8} />
            </button>
          </div>
          {state.kind === 'uploading' && (
            <div
              className="bar-track mx-0.5 mt-3 mb-1 h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-label="Upload progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(state.progress * 100)}
            >
              <div className="bar-fill h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(3, state.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {state.kind === 'error' && (
        <p role="alert" className="mt-3 px-2 text-[14px] font-medium text-ai">
          {state.message}
        </p>
      )}

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        {busy ? (
          <button type="button" onClick={cancel} className="btn-ghost h-12">
            Cancel
          </button>
        ) : picked ? (
          <button type="button" onClick={drop} className="btn-ghost h-12">
            Cancel
          </button>
        ) : (
          <button type="button" onClick={paste} className="btn-ghost h-12">
            <ClipboardPaste className="size-4" strokeWidth={1.6} /> Paste
          </button>
        )}
        <button
          type="button"
          onClick={picked && !busy ? () => start(picked) : choose}
          disabled={busy}
          className="btn-primary h-12 w-full"
        >
          {picked && !busy ? (
            'Analyze image'
          ) : busy ? (
            'Uploading…'
          ) : (
            <>
              <Upload className="size-4" strokeWidth={2} /> Choose image
            </>
          )}
        </button>
      </div>
      <p className="mt-3 mb-1 px-2 text-[13px] text-faint">
        {busy ? 'If the server was asleep, the first upload can take up to a minute. ' : 'The file is deleted after the analysis. '}
        <Link to={DEMO_REPORT_PATH} className="font-medium text-accent hover:underline">
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
