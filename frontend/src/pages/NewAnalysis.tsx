import { CloudUpload, Lock, LoaderCircle, MoonStar, WifiOff } from 'lucide-react'
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

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff']
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
      ? { kind: 'error', message: 'Nothing MetaProof can analyze was shared. Share a JPEG, PNG, WebP or TIFF image.' }
      : { kind: 'idle' },
  )
  const [dragging, setDragging] = useState(false)

  const start = useCallback(
    async (file: File) => {
      // Quick checks for a friendly message; the server re-checks everything.
      if (file.type && !ACCEPTED.includes(file.type)) {
        setState({ kind: 'error', message: 'Unsupported file type. Use a JPEG, PNG, WebP or TIFF image.' })
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
        className={`glass animate-rise group relative flex min-h-[340px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[32px] p-8 text-center transition sm:min-h-[400px] ${
          dragging ? 'glass-strong scale-[1.01]' : ''
        }`}
      >
        {/* dashed inner frame */}
        <div className="pointer-events-none absolute inset-3 rounded-[24px] border border-dashed border-white/10 transition group-hover:border-white/20" />
        {/* soft light that follows the drop state */}
        <div
          className={`pointer-events-none absolute top-1/2 left-1/2 size-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.06] blur-3xl transition-opacity ${
            dragging || busy ? 'opacity-100' : 'opacity-40'
          }`}
        />

        {busy ? (
          <Uploading file={state.file} progress={state.progress} preview={state.preview} />
        ) : (
          <div className="relative flex flex-col items-center">
            <span className="glass glass-strong grid size-16 place-items-center rounded-full shadow-[0_0_40px_rgba(255,255,255,0.12)] transition group-hover:scale-105">
              <CloudUpload className="size-6" strokeWidth={1.5} />
            </span>
            <p className="mt-6 font-display text-xl font-semibold">
              {dragging ? 'Release to analyze' : 'Drop an image to analyze'}
            </p>
            <p className="mt-2 text-sm text-muted">
              or <span className="text-ink underline decoration-white/30 underline-offset-4">browse your device</span>
              <span className="max-sm:hidden"> · or paste with Ctrl+V</span>
            </p>
            <p className="mt-6 font-mono text-[11px] tracking-widest text-faint uppercase">
              JPEG · PNG · WebP · TIFF · max {MAX_MB} MB
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
        <p role="alert" className="animate-rise mt-4 rounded-2xl border border-ai/20 bg-ai/5 px-4 py-3 text-sm text-ai">
          {state.message}
        </p>
      )}

      <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-faint">
        <Lock className="mt-0.5 size-3.5 shrink-0" />
        Your file is deleted as soon as it is analyzed. MetaProof keeps only its SHA-256 hash, a small
        thumbnail and the findings, so the report can be shared by link. GPS coordinates are never stored.
      </p>
      <p className="mt-3 text-xs text-faint">
        No image at hand?{' '}
        <Link to={DEMO_REPORT_PATH} className="text-ink underline decoration-white/30 underline-offset-4">
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
          <img src={preview} alt="" className="max-h-40 max-w-56 rounded-2xl object-contain ring-1 ring-white/10" />
          <div className="absolute inset-0 grid place-items-center rounded-2xl bg-black/40">
            <LoaderCircle className="size-8 animate-spin text-white" strokeWidth={1.5} />
          </div>
        </div>
      ) : (
        <LoaderCircle className="size-8 animate-spin text-muted" strokeWidth={1.5} />
      )}
      <p className="mt-5 max-w-full truncate font-medium">{file.name}</p>
      <p className="mt-1 text-xs text-faint">
        {done ? 'Uploaded, starting analysis…' : `Uploading ${formatBytes(file.size)}…`}
      </p>
      <div
        className="mt-5 h-1 w-full overflow-hidden rounded-full bg-white/10"
        role="progressbar"
        aria-label="Upload progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <div
          className="h-full rounded-full bg-white transition-[width] duration-300"
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
      className={`animate-rise mb-4 flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm ${
        waking ? 'border-edited/20 bg-edited/5 text-edited' : 'border-ai/20 bg-ai/5 text-ai'
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
