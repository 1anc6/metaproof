import { Lock, MoonStar, Plus, WifiOff } from 'lucide-react'
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
import { PageHeader, DeviceCircle, LeaderRow } from '../components/ui'

// Touch screens have no drag and drop, so the drop zone words itself as a picker there.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

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
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="New analysis"
        subtitle="Drop an image to check where it came from and whether it was edited or generated."
      />

      <ServerNotice state={server} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
      <div
        role="button"
        tabIndex={0}
        aria-label={TOUCH ? 'Choose a photo to analyze' : 'Choose an image to analyze'}
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
        className={`panel animate-rise group relative flex min-h-[420px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl p-5 text-center transition sm:p-8 ${
          dragging ? 'panel-raised outline-2 outline-offset-[-10px] outline-accent outline-dashed' : ''
        }`}
      >
        {busy ? (
          <Uploading file={state.file} progress={state.progress} preview={state.preview} />
        ) : (
          <div className="relative flex w-full flex-col items-center">
            {/* The drop target as the reference's device: formats as spec chips, a dark + at the centre. */}
            <DeviceCircle
              className="max-w-[380px]"
              chips={[
                { label: 'JPEG', value: 'PNG' },
                { label: 'WebP', value: 'TIFF' },
                { label: 'HEIC', value: 'HEIF' },
                { label: 'Max', value: `${MAX_MB} MB` },
                { label: 'File', value: 'deleted after' },
              ]}
            >
              <span
                className={`grid h-14 w-24 place-items-center rounded-full bg-primary text-on-primary shadow-[0_14px_28px_-12px_rgb(0_0_0/0.55)] transition duration-300 ${
                  dragging ? 'scale-110' : 'group-hover:scale-105'
                }`}
              >
                <Plus className="size-6" strokeWidth={1.75} />
              </span>
            </DeviceCircle>
            <p className="mt-2 text-[26px] font-normal tracking-[-0.03em]">
              {TOUCH ? 'Choose a photo' : dragging ? 'Release to analyze' : 'Drop an image to analyze'}
            </p>
            {TOUCH ? (
              <p className="mt-2 text-[15px] text-muted">From your gallery, files or camera</p>
            ) : (
              <p className="mt-2 text-[15px] text-muted">
                or <span className="text-ink underline decoration-faint underline-offset-4">browse your device</span>
                <span className="max-sm:hidden"> · or paste with Ctrl+V</span>
              </p>
            )}
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

      {/* What happens to the file, as the reference's leader rows. */}
      <section className="cream animate-rise rounded-xl p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="eyebrow">What happens</h2>
          <span className="status">
            <Lock className="size-3.5" strokeWidth={1.75} aria-hidden /> Private
          </span>
        </div>
        <dl className="mt-4">
          <LeaderRow label="Fingerprint" value="SHA-256" />
          <LeaderRow label="Checks" value="Six, in seconds" />
          <LeaderRow label="Your file" value="Deleted after" />
          <LeaderRow label="Findings kept" value="90 days" />
          <LeaderRow label="GPS" value="Never stored" />
        </dl>
        <p className="mt-4 text-[14px] leading-relaxed text-muted">
          Only the hash, a thumbnail and the findings stay, so the report can be shared by link.
        </p>
      </section>
      </div>

      {state.kind === 'error' && (
        <p role="alert" className="animate-rise mt-4 rounded-lg bg-ai/10 px-5 py-3 text-[15px] font-medium text-ai">
          {state.message}
        </p>
      )}

      <p className="mt-6 px-1 text-[14px] text-muted">
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
