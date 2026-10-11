import { CloudUpload, Lock, LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { formatBytes } from '../lib/format'
import { addToHistory } from '../lib/history'
import { PageHeader } from '../components/ui'

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff']
const MAX_MB = 25

type State =
  | { kind: 'idle' }
  | { kind: 'uploading'; file: File; progress: number }
  | { kind: 'error'; message: string }

export function NewAnalysis() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
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
      setState({ kind: 'uploading', file, progress: 0 })
      try {
        const created = await api.upload(file, (progress) =>
          setState((s) => (s.kind === 'uploading' ? { ...s, progress } : s)),
        )
        addToHistory({
          jobId: created.job_id,
          sha256: created.sha256,
          filename: file.name || 'pasted-image',
          sizeBytes: file.size,
          uploadedAt: new Date().toISOString(),
        })
        navigate(`/analysis/${created.job_id}`)
      } catch (e) {
        setState({ kind: 'error', message: (e as Error).message })
      }
    },
    [navigate],
  )

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

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="New analysis"
        title="Bring your evidence."
        subtitle="Drop an image to inspect its provenance and authenticity signals."
      />

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
          <Uploading file={state.file} progress={state.progress} />
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
    </div>
  )
}

function Uploading({ file, progress }: { file: File; progress: number }) {
  const done = progress >= 1
  return (
    <div className="relative flex w-full max-w-sm flex-col items-center">
      <LoaderCircle className="size-8 animate-spin text-muted" strokeWidth={1.5} />
      <p className="mt-5 max-w-full truncate font-medium">{file.name}</p>
      <p className="mt-1 text-xs text-faint">
        {done ? 'Uploaded, starting analysis…' : `Uploading ${formatBytes(file.size)}…`}
      </p>
      <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-white transition-[width] duration-300"
          style={{ width: `${Math.max(4, progress * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-[11px] text-faint">If the server was asleep, the first upload can take up to a minute.</p>
    </div>
  )
}
