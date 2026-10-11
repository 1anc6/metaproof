import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, ApiError, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { ReportView } from '../components/ReportView'
import { ErrorPanel, Orb } from '../components/ui'
import { ReportSkeleton } from './Report'

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
          else setError(e.status === 404 ? 'This analysis does not exist.' : e.message)
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
  return <Progress job={job} filename={filename} />
}

const STEPS = [
  { key: 'upload', label: 'File received and hashed' },
  { key: 'metadata', label: 'Reading metadata' },
  { key: 'c2pa', label: 'Checking Content Credentials' },
  { key: 'verdict', label: 'Weighing the evidence' },
]

function Progress({ job, filename }: { job: Job | null; filename?: string }) {
  // The worker runs analyzers in order; light up the steps as time passes while it runs.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 700)
    return () => clearInterval(t)
  }, [])
  const active = job?.status === 'running' ? Math.min(1 + tick, STEPS.length - 1) : job ? 1 : 0

  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-6 text-center sm:pt-12">
      <Orb size={150} />
      <p className="eyebrow mt-10">{job?.status === 'queued' ? 'In queue' : 'Analyzing'}</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Reading the evidence</h1>
      {filename && <p className="mt-2 max-w-full truncate text-sm text-muted">{filename}</p>}

      <ol className="glass mt-8 flex w-full flex-col gap-1 rounded-3xl p-3 text-left">
        {STEPS.map((step, i) => {
          const state = i < active ? 'done' : i === active ? 'active' : 'todo'
          return (
            <li key={step.key} className="flex items-center gap-3 rounded-2xl px-3 py-2.5">
              <span
                className={`grid size-6 place-items-center rounded-full border ${
                  state === 'done' ? 'border-white bg-white text-black' : 'border-white/15 text-muted'
                }`}
              >
                {state === 'done' ? (
                  <Check className="size-3.5" strokeWidth={3} />
                ) : state === 'active' ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <span className="size-1 rounded-full bg-current" />
                )}
              </span>
              <span className={`text-sm ${state === 'todo' ? 'text-faint' : 'text-ink'}`}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      <p className="mt-5 text-xs text-faint">
        {job ? 'This usually takes a few seconds.' : 'Connecting to the server… it may be waking up.'}
      </p>
    </div>
  )
}
