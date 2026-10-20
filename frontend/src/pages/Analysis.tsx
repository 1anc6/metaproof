import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { ReportView } from '../components/ReportView'
import { ErrorPanel, EvidenceMap } from '../components/ui'
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

  return (
    <div className="mx-auto max-w-5xl pt-2 sm:pt-4">
      <header className="animate-rise mb-6 sm:mb-8">
        <p className="eyebrow flex items-center gap-2">
          <span className="animate-blink size-1.5 rounded-full bg-accent" aria-hidden />
          {waiting ? 'In queue' : 'Analyzing'}
        </p>
        <h1 className="mt-3 text-[36px] leading-[1.04] font-medium tracking-[-0.035em] sm:mt-4 sm:text-[52px]">
          Reading the evidence
        </h1>
        {filename && <p className="mt-2 max-w-full truncate text-[15px] text-muted">{filename}</p>}
      </header>

      {/* Two equal columns that start and end level; on phones the steps come first. */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:items-stretch">
        {/* The upload in the middle orbit; the slider tracks how far along the checks are. */}
        <EvidenceMap
          src={preview}
          title="Live evidence map"
          score={(active + (waiting ? 0 : 0.5)) / STEPS.length}
          className="max-lg:order-2"
        />

        <section className="panel flex flex-col rounded-xl p-3 sm:p-4">
          {/* Says what is happening now; the list below only swaps markers. */}
          <ThinkingPill
            className="w-full justify-start"
            variant={job && !waiting ? 'dots' : 'lines'}
            label={!job ? 'Connecting…' : waiting ? 'Waiting in the queue…' : `${STEPS[active].label}…`}
          />
          <ol className="stagger mt-2 flex flex-col gap-0.5">
            {STEPS.map((step, i) => {
              const state = i < active ? 'done' : i === active && !waiting ? 'active' : 'todo'
              return (
                <li
                  key={step.key}
                  className={`animate-rise flex items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 ${
                    state === 'active' ? 'selected' : ''
                  }`}
                >
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors duration-300 ${
                      state === 'done' ? 'bg-accent-soft text-accent' : 'bg-raised text-faint'
                    }`}
                  >
                    {state === 'done' ? (
                      <Check className="animate-pop size-4" strokeWidth={2.5} />
                    ) : state === 'active' ? (
                      <ThinkingOrb size={18} className="text-ink" />
                    ) : (
                      <span className="text-[13px] font-semibold tabular-nums">{i + 1}</span>
                    )}
                  </span>
                  <span className={`text-[15px] transition-colors duration-300 ${state === 'todo' ? 'text-faint' : 'font-medium text-ink'}`}>
                    {step.label}
                  </span>
                </li>
              )
            })}
          </ol>
          <p className="mt-auto border-t border-line px-2 pt-3 text-[13px] text-faint">
            {job ? 'This usually takes a few seconds.' : 'Connecting to the server… it may be waking up.'}
          </p>
        </section>
      </div>
    </div>
  )
}
