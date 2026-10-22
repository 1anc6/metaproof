import { ArrowRight, ClipboardPaste, FileImage, ImagePlus, Plus, X, Zap } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { formatBytes } from '../lib/format'
import { ACCEPTED, imageFromClipboard, rejectReason, useUpload } from '../lib/upload'

/**
 * The reference's composer, as the workspace's way in: a dark card holding the attached image as a
 * pill and a line about it, on a tray with add, the example, a File / Paste switch and a glowing
 * send button. Attach by choosing, dropping or pasting; send runs the real upload and opens the
 * analysis. While it uploads, the line shows the time left and send turns into cancel.
 */
export function Composer({ className = '' }: { className?: string }) {
  const input = useRef<HTMLInputElement>(null)
  const { state, start, cancel, fail, clear } = useUpload()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [unreadable, setUnreadable] = useState(false) // HEIC and TIFF have no preview in most browsers
  const [dragging, setDragging] = useState(false)
  const busy = state.kind === 'uploading'

  const attach = useCallback(
    (next: File) => {
      const reason = rejectReason(next)
      if (reason) return fail(reason)
      clear()
      setFile(next)
      setUnreadable(false)
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old)
        return URL.createObjectURL(next)
      })
    },
    [fail, clear],
  )
  function detach() {
    setFile(null)
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old)
      return null
    })
  }
  const choose = () => !busy && input.current?.click()

  // Paste an image anywhere on the workspace to attach it.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (pasted) attach(pasted)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [attach])

  async function paste() {
    try {
      const pasted = await imageFromClipboard()
      if (pasted) attach(pasted)
      else fail('There is no image on the clipboard. Copy one first, or choose a file.')
    } catch {
      fail('This browser did not allow reading the clipboard. Press Ctrl+V instead.')
    }
  }

  const type = file ? (file.type.split('/')[1] ?? 'image').replace('jpeg', 'jpg').toUpperCase() : ''
  const progress = state.kind === 'uploading' ? state.progress : 0

  return (
    <section aria-label="Analyze an image" className={`panel rounded-[28px] p-2 ${className}`}>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          const dropped = e.dataTransfer.files[0]
          if (dropped && !busy) attach(dropped)
        }}
        className={`rounded-[22px] bg-[rgb(18_18_18/0.55)] p-3 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(255_255_255/0.06)] transition ${
          dragging ? 'outline-2 outline-offset-[-6px] outline-white/70 outline-dashed' : ''
        }`}
      >
        {/* the attachment row */}
        <div className="flex items-center gap-2">
          {file ? (
            <span className="relative flex h-10 items-center gap-2 rounded-full bg-white/10 pr-1 pl-1">
              <span className="grid h-8 w-12 place-items-center overflow-hidden rounded-full bg-white/10">
                {preview && !unreadable ? (
                  <img src={preview} alt="" onError={() => setUnreadable(true)} className="size-full object-cover" />
                ) : (
                  <FileImage className="size-4 text-white/70" strokeWidth={1.5} />
                )}
              </span>
              <span className="max-w-[9rem] truncate text-[13px]">{file.name || 'Pasted image'}</span>
              {!busy && (
                <button type="button" onClick={detach} aria-label="Remove the attached image" className="grid size-7 place-items-center rounded-full text-white/70 transition hover:bg-white/15 hover:text-white">
                  <X className="size-3.5" />
                </button>
              )}
            </span>
          ) : (
            <button
              type="button"
              onClick={choose}
              className="flex h-10 items-center gap-2 rounded-full px-4 text-[13px] text-white/80 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.28)] transition hover:bg-white/10 hover:text-white"
            >
              <ImagePlus className="size-4" strokeWidth={1.5} /> Attach an image
            </button>
          )}
        </div>

        {/* the line about it */}
        <p className="mt-3 min-h-[3lh] text-[14px] leading-relaxed text-white/90" aria-live="polite">
          {state.kind === 'uploading' ? (
            <>
              Uploading {formatBytes(state.file.size)}
              {state.progress >= 1 ? ', starting the analysis…' : state.secondsLeft !== null ? `, ${state.secondsLeft} sec left…` : '…'}{' '}
              <span className="text-white/55">A sleeping server can take up to a minute.</span>
            </>
          ) : state.kind === 'error' ? (
            <span className="text-[#f6a19c]">{state.message}</span>
          ) : file ? (
            <>
              {type} · {formatBytes(file.size)}. <span className="text-white/60">Send it to run the six checks; the file is deleted after.</span>
            </>
          ) : (
            <>
              Drop, paste or attach an image.{' '}
              <span className="text-white/60">MetaProof reads its metadata, credentials and pixels, then weighs what they show.</span>
            </>
          )}
        </p>
        {busy && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full rounded-full bg-white shadow-[0_0_8px_rgb(255_255_255/0.8)] transition-[width] duration-300" style={{ width: `${Math.max(3, progress * 100)}%` }} />
          </div>
        )}
      </div>

      {/* the tray */}
      <div className="flex items-center gap-2 px-1 pt-2">
        <button type="button" onClick={choose} disabled={busy} className="well size-11 disabled:opacity-50" aria-label="Choose an image" title="Choose an image">
          <Plus className="size-[18px]" strokeWidth={1.5} />
        </button>
        <Link to={DEMO_REPORT_PATH} className="well size-11" aria-label="See an example report" title="See an example report">
          <Zap className="size-[18px]" strokeWidth={1.5} />
        </Link>
        <div className="track flex h-11 min-w-0 items-center gap-0.5 rounded-full p-1" role="group" aria-label="Source">
          <button type="button" onClick={choose} disabled={busy} className="selected flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px]">
            <FileImage className="size-4" strokeWidth={1.5} /> File
          </button>
          <button type="button" onClick={paste} disabled={busy} className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-faint transition hover:text-ink">
            <ClipboardPaste className="size-4" strokeWidth={1.5} /> Paste
          </button>
        </div>
        {busy ? (
          <button type="button" onClick={cancel} aria-label="Cancel upload" className="well ml-auto size-11">
            <X className="size-[18px]" strokeWidth={1.75} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => file && start(file)}
            disabled={!file}
            aria-label="Analyze the attached image"
            className="ml-auto grid size-11 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_40%_30%,#ffffff,#d4d4d4_55%,#8d8d8d)] text-[#161616] shadow-[0_0_0_2px_rgb(255_255_255/0.8),0_0_20px_2px_rgb(255_255_255/0.4)] transition hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
          >
            <ArrowRight className="size-5" strokeWidth={2} />
          </button>
        )}
      </div>

      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(',')}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) attach(picked)
          e.target.value = ''
        }}
      />
    </section>
  )
}
