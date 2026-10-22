import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { ReportView } from '../components/ReportView'
import { ErrorPanel, FileName, Figure } from '../components/ui'
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

const STEPS = [
  { key: 'upload', label: 'File received and hashed' },
  { key: 'metadata', label: 'Reading metadata' },
  { key: 'structure', label: 'Inspecting the file structure' },
  { key: 'c2pa', label: 'Checking Content Credentials' },
  { key: 'watermark', label: 'Looking for invisible watermarks' },
  { key: 'detector', label: 'Running the AI-image detector' },
  { key: 'verdict', label: 'Weighing the evidence' },
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

  return (
    <div className="mx-auto max-w-5xl pt-2 sm:pt-4">
      <header className="animate-rise mb-5 sm:mb-6">
        <h1 className="display text-[38px] leading-none sm:text-[48px]">Reading the evidence</h1>
        <p className="mt-2 text-[15px] text-muted">Six checks run on the file, then the evidence is weighed.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
        {/* The upload, whole, with a thin bar that fills as the checks finish. */}
        <figure className="panel rounded-xl p-2 max-lg:order-2">
          <div className="relative grid h-[clamp(180px,50vw,320px)] place-items-center overflow-hidden rounded-lg bg-[#161614]">
            {preview ? (
              <>
                <img src={preview} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-50 blur-2xl" />
                <img src={preview} alt="The image being analyzed" className="absolute inset-0 size-full object-contain" />
              </>
            ) : (
              <ThinkingOrb size={36} className="text-white" />
            )}
          </div>
          <div className="mx-1 mt-2 h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full rounded-full bg-ink transition-[width] duration-700 ease-(--ease-out)" style={{ width: `${Math.max(3, pct)}%` }} />
          </div>
          <figcaption className="px-1 pt-2 pb-1 text-[12px] text-faint">Fingerprinted with SHA-256 · six checks · the file is deleted after</figcaption>
        </figure>

        <section className="cream flex flex-col rounded-xl p-4 sm:p-5" aria-label="Progress">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="eyebrow">{waiting ? 'In queue' : 'Analyzing'}</p>
            <span className="status">
              <span className="animate-blink size-2 rounded-full bg-ink" aria-hidden /> Active
            </span>
          </div>
          {filename && <FileName name={filename} className="mt-1 text-[14px] text-faint" />}

          <div className="mt-4 grid grid-cols-2 gap-4" aria-live="polite">
            <Figure label="Progress" value={pct} unit="%" size="sm" />
            <Figure label="Steps done" value={done} unit={`/ ${STEPS.length}`} size="sm" />
          </div>

          {/* Says what is happening now; the rows below only swap their values. */}
          <ThinkingPill
            className="mt-4 w-full justify-start"
            variant={job && !waiting ? 'dots' : 'lines'}
            label={!job ? 'Connecting…' : waiting ? 'Waiting in the queue…' : `${STEPS[active].label}…`}
          />
          <dl className="mt-3">
            {steps.map((step) => (
              <div key={step.key} className="flex items-center gap-3 py-2 text-[15px]">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full ${
                    step.state === 'done' ? 'bg-ink text-on-primary' : step.state === 'active' ? 'bg-raised text-ink ring-1 ring-ink' : 'bg-raised text-faint'
                  }`}
                  aria-hidden
                >
                  {step.state === 'done' ? <Check className="animate-pop size-3.5" strokeWidth={2.5} /> : <span className="size-1.5 rounded-full bg-current" />}
                </span>
                <dt className={step.state === 'todo' ? 'text-faint' : 'text-ink'}>{step.label}</dt>
                <span className="leader" aria-hidden />
                <dd className={step.state === 'todo' ? 'text-faint' : 'text-ink'}>
                  {step.state === 'done' ? 'Done' : step.state === 'active' ? 'Running' : 'Waiting'}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[13px] text-faint">
            {job ? 'This usually takes a few seconds.' : 'Connecting to the server… it may be waking up.'}
          </p>
        </section>
      </div>
    </div>
  )
}
