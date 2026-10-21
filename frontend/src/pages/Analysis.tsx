import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { ReportView } from '../components/ReportView'
import { DeviceCircle, ErrorPanel, FileName, Figure } from '../components/ui'
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
      <header className="animate-rise mb-6 sm:mb-8">
        <h1 className="text-[34px] leading-[1.05] font-normal tracking-[-0.03em] sm:text-[44px]">Reading the evidence</h1>
        <p className="mt-3 text-[16px] text-muted">Six checks run on the file, then the evidence is weighed.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
        {/* The upload in the device circle, with a ring that fills as the checks finish. */}
        <DeviceCircle
          className="max-lg:order-2"
          chips={[
            { label: 'Hash', value: 'SHA-256' },
            { label: 'Checks', value: '6' },
            { label: 'Done', value: `${pct}%` },
            { label: 'File', value: 'deleted after' },
          ]}
        >
          <div className="relative aspect-square w-full">
            <svg viewBox="0 0 100 100" className="absolute -inset-[9%] size-[118%] -rotate-90" aria-hidden>
              <circle cx="50" cy="50" r="47" fill="none" stroke="var(--color-line-strong)" strokeWidth="1.2" />
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * 295.3} 295.3`}
                className="transition-[stroke-dasharray] duration-700 ease-(--ease-out)"
              />
            </svg>
            {preview ? (
              <img src={preview} alt="" className="size-full rounded-full object-cover shadow-[0_18px_40px_-18px_rgb(0_0_0/0.5)]" />
            ) : (
              <span className="grid size-full place-items-center rounded-full bg-raised">
                <ThinkingOrb size={36} className="text-ink" />
              </span>
            )}
          </div>
        </DeviceCircle>

        <section className="cream flex flex-col rounded-xl p-5 sm:p-7" aria-label="Progress">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="eyebrow">{waiting ? 'In queue' : 'Analyzing'}</p>
            <span className="status">
              <span className="animate-blink size-2 rounded-full bg-accent" aria-hidden /> Active
            </span>
          </div>
          {filename && <FileName name={filename} className="mt-1 text-[14px] text-faint" />}

          <div className="mt-6 grid grid-cols-2 gap-4" aria-live="polite">
            <Figure label="Progress" value={pct} unit="%" />
            <Figure label="Steps done" value={done} unit={`/ ${STEPS.length}`} />
          </div>

          {/* Says what is happening now; the rows below only swap their values. */}
          <ThinkingPill
            className="mt-5 w-full justify-start"
            variant={job && !waiting ? 'dots' : 'lines'}
            label={!job ? 'Connecting…' : waiting ? 'Waiting in the queue…' : `${STEPS[active].label}…`}
          />
          <dl className="mt-3">
            {steps.map((step) => (
              <div key={step.key} className="flex items-center gap-3 py-2 text-[15px]">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full ${
                    step.state === 'done' ? 'bg-ink text-on-primary' : step.state === 'active' ? 'bg-accent text-ink' : 'bg-raised text-faint'
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
