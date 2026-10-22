import { ClipboardPaste, FileImage, Lock, MoonStar, Upload, WifiOff, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { formatBytes } from '../lib/format'
import { useServerStatus } from '../lib/hooks'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { takeSharedImage } from '../lib/share'
import { ACCEPTED, MAX_MB, imageFromClipboard, useUpload } from '../lib/upload'
import { PageHeader, LeaderRow } from '../components/ui'

// Touch screens have no drag and drop, so the drop zone words itself as a picker there.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

export function NewAnalysis() {
  const input = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  const { state, start, cancel, fail } = useUpload(
    params.get('shared') && params.get('shared') !== '1'
      ? { kind: 'error', message: 'Nothing MetaProof can analyze was shared. Share a JPEG, PNG, WebP, TIFF or HEIC image.' }
      : { kind: 'idle' },
  )
  const [dragging, setDragging] = useState(false)

  // Opened from the phone's share menu: analyze the shared image straight away.
  const sharedHandled = useRef(false)
  useEffect(() => {
    const shared = params.get('shared')
    if (!shared || sharedHandled.current) return
    sharedHandled.current = true // React runs effects twice in development; take the file once
    setParams({}, { replace: true })
    if (shared !== '1') return // the initial state already explains it
    takeSharedImage().then((file) =>
      file ? start(file) : fail('The shared image could not be found. Share it again, or choose it here.'),
    )
  }, [params, setParams, start, fail])

  // Paste an image from the clipboard anywhere on the page.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'))
      if (file) start(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [start])

  const busy = state.kind === 'uploading'
  const server = useServerStatus()
  const choose = () => !busy && input.current?.click()

  // "Paste" reads an image straight from the clipboard, where the browser allows it.
  async function pasteFromClipboard() {
    try {
      const file = await imageFromClipboard()
      if (file) start(file)
      else fail('There is no image on the clipboard. Copy one first, or choose a file.')
    } catch {
      fail('This browser did not allow reading the clipboard. Press Ctrl+V on this page instead.')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New analysis"
        subtitle="Drop an image to check where it came from and whether it was edited or generated."
      />

      <ServerNotice state={server} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        {/* The upload card, after the empty-state reference: a dashed drop zone with one glowing
            button, the file in a row below it while it uploads, and a tray of other ways in. */}
        <div className="panel animate-rise flex flex-col gap-3 rounded-[28px] p-3">
          <div
            role="button"
            tabIndex={0}
            aria-label={TOUCH ? 'Choose a photo to analyze' : 'Choose an image to analyze'}
            aria-busy={busy}
            onClick={choose}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              const file = e.dataTransfer.files[0]
              if (file && !busy) start(file)
            }}
            className={`group flex min-h-[300px] flex-col items-center justify-between gap-4 rounded-[20px] border-[1.5px] border-dashed px-4 py-6 text-center transition sm:min-h-[340px] ${
              busy ? 'cursor-default border-line' : 'cursor-pointer'
            } ${dragging ? 'border-ink bg-hover' : 'border-line-strong hover:bg-hover'}`}
          >
            <p className="text-[16px] font-medium">
              {busy ? 'Uploading your image' : TOUCH ? 'Choose a photo' : dragging ? 'Release to analyze' : 'Drop your image here'}
            </p>

            {/* the one action: a pale sphere in a halo that swells while something is dragged over */}
            <span className="relative grid place-items-center" aria-hidden>
              <span
                className={`pointer-events-none absolute -inset-7 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-ink)_30%,transparent),transparent_68%)] transition-transform duration-500 ${
                  busy ? 'animate-halo' : dragging ? 'scale-125' : 'group-hover:scale-110'
                }`}
              />
              <span
                className={`relative grid size-[76px] place-items-center rounded-full bg-[radial-gradient(circle_at_40%_28%,#ffffff,#e2e2e2_55%,#a9a9a9)] text-[#161616] shadow-[0_0_0_1px_rgb(255_255_255/0.7),0_14px_28px_-10px_rgb(0_0_0/0.55),inset_0_-3px_8px_rgb(0_0_0/0.12)] transition duration-300 ${
                  dragging ? 'scale-110' : busy ? 'opacity-70' : 'group-hover:scale-105'
                }`}
              >
                <Upload className={`size-7 transition-transform duration-300 ${dragging ? '-translate-y-1' : ''}`} strokeWidth={1.75} />
              </span>
            </span>

            <p className="max-w-[36ch] text-[13px] leading-relaxed text-faint">
              For the clearest reading, use the original file: JPEG, PNG, WebP, TIFF or HEIC, up to {MAX_MB} MB.
              {TOUCH ? ' From your gallery, files or camera.' : ' You can also paste with Ctrl+V.'}
            </p>
          </div>

          {state.kind === 'uploading' && (
            <UploadRow
              file={state.file}
              preview={state.preview}
              progress={state.progress}
              secondsLeft={state.secondsLeft}
              onCancel={cancel}
            />
          )}

          {/* other ways in */}
          <div className="flex items-center gap-2">
            <button type="button" onClick={pasteFromClipboard} disabled={busy} className="btn-ghost h-11 flex-1 px-4 text-[14px] disabled:opacity-50">
              <ClipboardPaste className="size-4" strokeWidth={1.5} /> Paste
            </button>
            <Link to={DEMO_REPORT_PATH} className="btn-ghost h-11 flex-1 px-4 text-[14px]">
              <Zap className="size-4" strokeWidth={1.5} /> Example report
            </Link>
          </div>

          <input
            ref={input}
            type="file"
            accept={ACCEPTED.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) start(file)
              e.target.value = ''
            }}
          />
        </div>

        {/* What happens to the file, as the reference's leader rows. */}
        <section className="cream animate-rise rounded-[28px] p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="eyebrow">What happens</h2>
            <span className="status">
              <Lock className="size-3.5" strokeWidth={1.75} aria-hidden /> Private
            </span>
          </div>
          <dl className="mt-3">
            <LeaderRow label="Fingerprint" value="SHA-256" />
            <LeaderRow label="Checks" value="Six, in seconds" />
            <LeaderRow label="Your file" value="Deleted after" />
            <LeaderRow label="Findings kept" value="90 days" />
            <LeaderRow label="GPS" value="Never stored" />
          </dl>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            Only the hash, a thumbnail and the findings stay, so the report can be shared by link.
          </p>
        </section>
      </div>

      {state.kind === 'error' && (
        <p role="alert" className="panel animate-rise mt-4 rounded-full px-5 py-3 text-[15px] font-medium text-ai">
          {state.message}
        </p>
      )}
    </div>
  )
}

/** The file on its way: a tile, its name, type, size and time left, a cancel button, and the progress bar. */
function UploadRow({
  file,
  preview,
  progress,
  secondsLeft,
  onCancel,
}: {
  file: File
  preview: string
  progress: number
  secondsLeft: number | null
  onCancel: () => void
}) {
  const done = progress >= 1
  const [unreadable, setUnreadable] = useState(false) // HEIC and TIFF have no preview in most browsers
  const type = (file.type.split('/')[1] ?? 'image').replace('jpeg', 'jpg').toUpperCase()
  const status = done ? 'Starting analysis…' : secondsLeft !== null ? `${secondsLeft} sec left` : 'Starting…'
  return (
    <div className="animate-rise rounded-[20px] bg-raised p-3">
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-hover shadow-[inset_0_0_0_1px_var(--color-line)]">
          {preview && !unreadable ? (
            <img src={preview} alt="" onError={() => setUnreadable(true)} className="size-full object-cover" />
          ) : (
            <FileImage className="size-5 text-faint" strokeWidth={1.5} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">{file.name || 'Pasted image'}</p>
          <p className="mt-0.5 text-[12px] text-faint tabular-nums">
            {type} · {formatBytes(file.size)} · {status}
          </p>
        </div>
        {!done && (
          <button type="button" onClick={onCancel} className="well size-8" aria-label="Cancel upload">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-strong"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="h-full rounded-full bg-ink shadow-[0_0_10px_color-mix(in_srgb,var(--color-ink)_60%,transparent)] transition-[width] duration-300"
          style={{ width: `${Math.max(3, progress * 100)}%` }}
        />
      </div>
      <p className="mt-2 text-[11px] text-faint">If the server was asleep, the first upload can take up to a minute.</p>
    </div>
  )
}

function ServerNotice({ state }: { state: ReturnType<typeof useServerStatus> }) {
  if (state !== 'waking' && state !== 'offline') return null
  const waking = state === 'waking'
  const Icon = waking ? MoonStar : WifiOff
  return (
    <div
      role="status"
      className={`panel animate-rise mb-4 flex items-start gap-3 rounded-[22px] px-4 py-3 text-[15px] font-medium ${
        waking ? 'text-edited' : 'text-ai'
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p>
        {waking
          ? 'The server is waking up. Free hosting sleeps when idle, so this takes about a minute; you can upload now and it will continue on its own.'
          : 'Cannot reach the MetaProof server right now. Check your connection, or try again in a minute.'}
      </p>
    </div>
  )
}
