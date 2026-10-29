import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Job } from '../lib/api'
import { useHistory } from '../lib/history'
import { ReportView } from '../components/ReportView'
import { ErrorPanel } from '../components/ui'

/** Shareable report: /report/<sha256> shows the latest finished analysis of that file. */
export function Report() {
  const { sha = '' } = useParams()
  // Show the filename only if this browser uploaded the file; it is never sent to the server.
  const filename = useHistory().find((e) => e.sha256 === sha)?.filename
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .report(sha)
      .then((j) => !cancelled && setJob(j))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [sha])

  if (error)
    return (
      <ErrorPanel message={error}>
        <Link to="/new" className="btn-primary">Analyze an image</Link>
      </ErrorPanel>
    )
  if (!job?.verdict) return <ReportSkeleton />
  return <ReportView job={job} filename={filename} />
}

export function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="skeleton h-9 w-56" />
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="panel min-h-[clamp(240px,56vw,400px)] rounded-[28px] p-2.5 lg:col-span-5">
          <div className="size-full rounded-[20px] bg-[var(--frame-bg)]" />
        </div>
        <div className="panel flex flex-col gap-4 rounded-[28px] p-6 lg:col-span-7">
          <div className="flex items-center gap-3.5">
            <div className="skeleton size-12" />
            <div className="flex flex-1 flex-col gap-2">
              <div className="skeleton h-3 w-16" />
              <div className="skeleton h-8 w-2/3" />
            </div>
          </div>
          <div className="skeleton mt-2 h-2 w-full" />
          <div className="skeleton h-4 w-full max-w-md" />
          <div className="skeleton h-4 w-3/4 max-w-sm" />
          <div className="well mt-2 h-16 rounded-[18px]" />
        </div>
      </div>
      <div className="panel h-56 rounded-[28px]" />
    </div>
  )
}
