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
    <div className="flex flex-col gap-6" aria-busy>
      <div className="glass flex flex-col gap-6 rounded-[32px] p-6 sm:flex-row sm:p-8">
        <div className="skeleton aspect-square w-full max-w-[200px] rounded-3xl" />
        <div className="flex flex-1 flex-col gap-3 pt-2">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-10 w-2/3" />
          <div className="skeleton h-4 w-full max-w-md" />
        </div>
      </div>
      <div className="glass h-56 rounded-[28px]" />
    </div>
  )
}
