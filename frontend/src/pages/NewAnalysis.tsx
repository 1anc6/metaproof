import { CloudUpload, Lock, MoonStar, WifiOff } from 'lucide-react'
import { ThinkingOrb } from '../components/ThinkingOrb'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import { addToHistory } from '../lib/history'
import { useServerStatus } from '../lib/hooks'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { rememberPreview } from '../lib/preview'
import { takeSharedImage } from '../lib/share'
import { PageHeader } from '../components/ui'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif']
const MAX_MB = 25

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; file: File; progress: number; preview: string }
  | { kind: 'error'; message: string }

export function NewAnalysis() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [params, setParams] = useSearchParams()
  const [state, setState] = useState<State>(() =>
    params.get('shared') && params.get('shared') !== '1'
      ? { kind: 'error', message: 'Nothing MetaProof can analyze was shared. Share a JPEG, PNG, WebP, TIFF or HEIC image.' }
      : { kind: 'idle' },
  )
  const [dragging, setDragging] = useState(false)

  const start = useCallback(
    async (file: File) => {
      // Quick checks for a friendly message; the server re-checks everything.
      if (file.type && !ACCEPTED.includes(file.type)) {
        setState({ kind: 'error', message: 'Unsupported file type. Use a JPEG, PNG, WebP, TIFF or HEIC image.' })
        return
      }
      if (file.size > MAX_MB * 1024 * 1024) {
        setState({ kind: 'error', message: `That file is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.` })
        return
      }
      // A local preview of the picked file; nothing extra leaves the browser.
      const preview = URL.createObjectURL(file)
      setState({ kind: 'uploading', file, progress: 0, preview })
      try {
        const created = await api.upload(file, (progress) =>
          setState((s) => (s.kind === 'uploading' ? { ...s, progress } : s)),
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
        setState({ kind: 'error', message: (e as Error).message })
      }
    },
    [navigate],
  )

  // Opened from the phone's share menu: analyze the shared image straight away.
  const sharedHandled = useRef(false)
  useEffect(() => {
    const shared = params.get('shared')
    if (!shared || sharedHandled.current) return
    sharedHandled.current = true // React runs effects twice in development; take the file once
    setParams({}, { replace: true })
    if (shared !== '1') return // the initial state already explains it
    takeSharedImage().then((file) =>
      file
        ? start(file)
        : setState({ kind: 'error', message: 'The shared image could not be found. Share it again, or choose it here.' }),
    )
  }, [params, setParams, start])

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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="New analysis"
        title="Bring your evidence."
        subtitle="Drop an image to inspect its provenance and authenticity signals."
      />

      <ServerNotice state={server} />

      <div
        role="button"
        tabIndex={0}
        aria-label="Choose an image to analyze"
        aria-busy={busy}
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && input.current?.click()}
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
        className={`panel animate-rise group relative flex min-h-[380px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl p-8 text-center transition sm:min-h-[440px] ${
          dragging ? 'panel-raised scale-[1.01]' : ''
        }`}
      >
        {/* measuring grid and viewfinder corners; both turn lime while a file is held over */}
        {/* dotted orbit rings around the drop target; they spin up while a file is held over */}
        <svg
          viewBox="0 0 400 400"
          className={`pointer-events-none absolute top-1/2 left-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 text-ink transition-opacity ${
            dragging ? 'opacity-60' : 'opacity-25'
          }`}
          fill="none"
          stroke="currentColor"
          aria-hidden
        >
          <circle cx="200" cy="200" r="190" strokeDasharray="1 8" strokeLinecap="round" />
          <circle cx="200" cy="200" r="140" strokeDasharray="1 7" strokeLinecap="round" />
          <g className={`origin-center [transform-box:fill-box] ${dragging ? 'animate-orbit' : ''}`}>
            <circle cx="200" cy="200" r="140" strokeWidth="1.5" strokeDasharray="160 720" strokeLinecap="round" />
          </g>
          <circle cx="200" cy="200" r="92" strokeDasharray="1 6" strokeLinecap="round" />
        </svg>

        {busy ? (
          <Uploading file={state.file} progress={state.progress} preview={state.preview} />
        ) : (
          <div className="relative flex flex-col items-center">
            <span
              className={`grid size-20 place-items-center rounded-full transition duration-300 ${
                dragging
                  ? 'scale-110 bg-primary text-on-primary shadow-[0_16px_36px_-14px_rgb(0_0_0/0.55)]'
                  : 'selected text-ink group-hover:scale-105'
              }`}
            >
              <CloudUpload className="size-7" strokeWidth={1.5} />
            </span>
            <p className="mt-7 text-[26px] font-medium tracking-[-0.03em]">
              {dragging ? 'Release to analyze' : 'Drop an image to analyze'}
            </p>
            <p className="mt-2 text-[15px] text-muted">
              or <span className="text-ink underline decoration-faint underline-offset-4">browse your device</span>
              <span className="max-sm:hidden"> · or paste with Ctrl+V</span>
            </p>
            <p className="mt-6 flex flex-wrap justify-center gap-1.5">
              {['JPEG', 'PNG', 'WebP', 'TIFF', 'HEIC', `≤ ${MAX_MB} MB`].map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </p>
          </div>
        )}

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

      {state.kind === 'error' && (
        <p role="alert" className="animate-rise mt-4 rounded-lg bg-ai/10 px-5 py-3 text-[15px] font-medium text-ai">
          {state.message}
        </p>
      )}

      <ol className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          ['Hash and read', 'A SHA-256 fingerprint, then metadata and file structure.'],
          ['Six checks', 'Credentials, watermark, AI detector and seen-before search.'],
          ['Delete the file', 'Only the hash, a thumbnail and the findings remain.'],
        ].map(([title, text], i) => (
          <li key={title} className="panel rounded-xl p-5">
            <p className="num text-[34px] leading-none text-accent">{String(i + 1).padStart(2, '0')}</p>
            <p className="mt-4 text-[17px] font-medium">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-faint">{text}</p>
          </li>
        ))}
      </ol>

      <p className="mt-6 flex items-start gap-2 text-[13px] leading-relaxed text-faint">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Your file is deleted as soon as it is analyzed. MetaProof keeps only its SHA-256 hash, a small
        thumbnail and the findings, so the report can be shared by link. GPS coordinates are never stored.
      </p>
      <p className="mt-3 text-[13px] text-faint">
        No image at hand?{' '}
        <Link to={DEMO_REPORT_PATH} className="text-ink underline decoration-faint underline-offset-4">
          See an example report
        </Link>
        .
      </p>
    </div>
  )
}

function Uploading({ file, progress, preview }: { file: File; progress: number; preview: string }) {
  const done = progress >= 1
  return (
    <div className="relative flex w-full max-w-sm flex-col items-center">
      {preview ? (
        <div className="relative">
          <img src={preview} alt="" className="max-h-44 max-w-60 rounded-lg object-contain shadow-[0_20px_40px_-20px_rgb(60_40_30/0.5)]" />
          <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/30">
            <ThinkingOrb size={44} variant="lines" className="text-white" />
          </div>
        </div>
      ) : (
        <ThinkingOrb size={44} variant="lines" className="text-ink" />
      )}
      <p className="mt-5 max-w-full truncate font-medium">{file.name}</p>
      <p className="mt-1 text-xs text-faint">
        {done ? 'Uploaded, starting analysis…' : `Uploading ${formatBytes(file.size)}…`}
      </p>
      <div
        className="mt-5 h-[3px] w-full overflow-hidden rounded-full bg-line-strong"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${Math.max(4, progress * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-[11px] text-faint">If the server was asleep, the first upload can take up to a minute.</p>
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
      className={`animate-rise mb-4 flex items-start gap-3 rounded-lg px-5 py-3 text-[15px] font-medium ${
        waking ? 'bg-edited/10 text-edited' : 'bg-ai/10 text-ai'
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
