import { Check } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMetalTextReflection } from 'metal-fx'
import type { ModeFrame, OrbState } from 'thinking-orbs'
import { api, ApiError, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { fingerprint, useOrbFavicon } from '../lib/orbs'
import { LiveBadge } from '../components/Metal'
import { ReportView } from '../components/ReportView'
import { ErrorPanel, FileName, Gauge, PageHeader, PanelTitle } from '../components/ui'
import { ThinkingOrb, ThinkingPill } from '../components/ThinkingOrb'
import { ReportSkeleton } from './Report'
import { previewFor } from '../lib/preview'

const POLL_MS = 1500

/** Follows one job until it finishes, then shows its report. */
export function Analysis() {
  const { jobId = '' } = useParams()
  const entry = useHistory().find((e) => e.jobId === jobId)
  const filename = entry?.filename
  // Uploaded in the last minute: we expect it to still be running.
  const [openedAt] = useState(() => Date.now())
  const justUploaded = !!entry && openedAt - new Date(entry.uploadedAt).getTime() < 60_000
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = () => {
      api
        .job(jobId)
        .then((j) => {
          if (cancelled) return
          setJob(j)
          if (j.status === 'queued' || j.status === 'running') timer = setTimeout(poll, POLL_MS)
        })
        .catch((e: ApiError) => {
          if (cancelled) return
          if (e.status === 0) timer = setTimeout(poll, POLL_MS * 2) // server waking up: keep trying
          else setError(e.status === 404 ? 'This analysis does not exist or has expired.' : e.message)
        })
    }
    poll()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [jobId])

  if (error)
    return (
      <ErrorPanel message={error}>
        <Link to="/new" className="btn-primary">New analysis</Link>
      </ErrorPanel>
    )
  if (job?.status === 'failed')
    return (
      <ErrorPanel message={job.error ?? 'The analysis failed.'}>
        <Link to="/new" className="btn-primary">Try again</Link>
      </ErrorPanel>
    )
  if (job?.status === 'done' && job.verdict) return <ReportView job={job} filename={filename} />
  // First load of an older analysis: show the report layout, not the progress steps.
  if (!job && !justUploaded) return <ReportSkeleton />
  return <Progress job={job} filename={filename} preview={previewFor(jobId)} />
}

// Each step has its own orb (lib/orbs.ts has the whole set); hashing draws MetaProof's fingerprint.
const STEPS: { key: string; label: string; orb: OrbState; frame?: ModeFrame }[] = [
  { key: 'upload', label: 'File received and hashed', orb: 'working', frame: fingerprint },
  { key: 'metadata', label: 'Reading metadata', orb: 'searching' },
  { key: 'structure', label: 'Inspecting the file structure', orb: 'shaping' },
  { key: 'c2pa', label: 'Checking Content Credentials', orb: 'connecting' },
  { key: 'watermark', label: 'Looking for invisible watermarks', orb: 'listening' },
  { key: 'detector', label: 'Running the AI-image detector', orb: 'solving' },
  { key: 'verdict', label: 'Weighing the evidence', orb: 'weaving' },
]

function Progress({ job, filename, preview }: { job: Job | null; filename?: string; preview?: string }) {
  // The worker reports the step it is on, and runs them in this order, so earlier ones are done.
  const running = job?.status === 'running'
  const reported = running ? STEPS.findIndex((s) => s.key === job.current_step) : -1
  // Servers older than current_step (or a step this build doesn't know): advance on a timer instead.
  const guessing = running && reported < 0
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!guessing) return
    const t = setInterval(() => setTick((n) => n + 1), 700)
    return () => clearInterval(t)
  }, [guessing])
  const active = reported >= 0 ? reported : guessing ? Math.min(1 + tick, STEPS.length - 1) : job ? 1 : 0
  // Queued: the file is in, but nothing has started yet.
  const waiting = job?.status === 'queued'
  // How far along the checks are; the step under way counts as half done.
  const pct = job ? Math.round(((active + (waiting ? 0 : 0.5)) / STEPS.length) * 100) : 0

  const steps = STEPS.map((step, i) => ({ ...step, state: i < active ? 'done' : i === active && !waiting ? 'active' : 'todo' }))
  const done = steps.filter((x) => x.state === 'done').length
  // What the orb shows: reaching the server, waiting in the queue, or the step under way.
  const now: { label: string; orb: OrbState; frame?: ModeFrame } = !job
    ? { label: 'Connecting…', orb: 'connecting' }
    : waiting
      ? { label: 'Waiting in the queue…', orb: 'breathing' }
      : { ...STEPS[active], label: `${STEPS[active].label}…` }
  useOrbFavicon(now.orb)
  // the panel's name catches the LIVE badge's metal on its letters, as on libraries.dev/metal
  const title = useRef<HTMLSpanElement>(null)
  useMetalTextReflection(title)

  return (
    <div>
      <PageHeader title="Reading the evidence" subtitle="Six checks run on the file, then the evidence is weighed." />

      {/* One column on phones, set explicitly: an implicit column would grow to the caption's
          unwrapped width and push both panels off the side of the screen. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* The upload, whole, over a blurred copy of itself. */}
        <figure className="panel flex min-w-0 flex-col rounded-[28px] p-2.5 max-lg:order-2 lg:col-span-7">
          <div className="relative grid min-h-[clamp(200px,52vw,380px)] flex-1 place-items-center overflow-hidden rounded-[20px] bg-[var(--frame-bg)]">
            {preview ? (
              <>
                <img src={preview} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
                <img src={preview} alt="The image being analyzed" className="absolute inset-0 size-full object-contain" />
              </>
            ) : (
              <ThinkingOrb state={now.orb} frame={now.frame} size={64} />
            )}
          </div>
          <figcaption className="flex min-w-0 items-center gap-2 px-2.5 pt-3 pb-1.5 text-[13px] text-faint">
            {filename && <FileName name={filename} className="max-w-[55%] font-medium text-ink" />}
            {filename && <span aria-hidden>·</span>}
            <span className="truncate">Fingerprinted with SHA-256 · deleted after the checks</span>
          </figcaption>
        </figure>

        <section className="panel flex min-w-0 flex-col rounded-[28px] p-5 lg:col-span-5" aria-label="Progress">
          <PanelTitle
            title={<span ref={title}>{waiting ? 'In queue' : 'Analyzing'}</span>}
            status={<LiveBadge label="Live" reflect={[{ ref: title, strength: 0.8 }]} />}
          />
          <div aria-live="polite">
            <Gauge
              value={pct / 100}
              figure={pct}
              unit="%"
              caption={`${done} of ${STEPS.length} steps done`}
              colors={['#9fbd40', 'var(--color-primary)']}
              label={`${pct}% done, ${done} of ${STEPS.length} steps`}
              className="mx-auto mt-4 w-full max-w-[280px]"
            />
          </div>

          {/* Says what is happening now, with that step's orb; the rows below only change their state. */}
          <ThinkingPill className="mt-5 w-full" state={now.orb} frame={now.frame} label={now.label} />
          <ol className="mt-3 flex flex-col">
            {steps.map((step) => (
              <li key={step.key} className="flex items-center gap-3 py-[7px] text-[14px]">
                <span
                  className={`grid size-[22px] shrink-0 place-items-center rounded-full ${
                    step.state === 'done'
                      ? 'bg-primary text-on-primary'
                      : step.state === 'active'
                        ? 'raise text-primary ring-2 ring-primary/35'
                        : 'well text-faint'
                  }`}
                  aria-hidden
                >
                  {step.state === 'done' ? <Check className="animate-pop size-3" strokeWidth={3} /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <span className={`min-w-0 flex-1 ${step.state === 'todo' ? 'text-faint' : 'text-ink'}`}>{step.label}</span>
                <span className={`text-[13px] ${step.state === 'active' ? 'font-medium text-accent' : 'text-faint'}`}>
                  {step.state === 'done' ? 'Done' : step.state === 'active' ? 'Running' : 'Waiting'}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-auto pt-3 text-[13px] text-faint">
            {job ? 'This usually takes a few seconds.' : 'Connecting to the server… it may be waking up.'}
          </p>
        </section>
      </div>
    </div>
  )
}
