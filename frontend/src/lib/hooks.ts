import { useEffect, useState } from 'react'
import { api, type JobSummary } from './api'
import type { HistoryEntry } from './history'

export type ServerState = 'checking' | 'waking' | 'online' | 'offline'

/** The free Render instance sleeps when idle; tell the user instead of looking broken. */
export function useServerStatus(): ServerState {
  const [state, setState] = useState<ServerState>('checking')
  useEffect(() => {
    let cancelled = false
    const slow = setTimeout(() => !cancelled && setState('waking'), 2500)
    api
      .health()
      .then(() => !cancelled && setState('online'))
      .catch(() => !cancelled && setState('offline'))
      .finally(() => clearTimeout(slow))
    return () => {
      cancelled = true
      clearTimeout(slow)
    }
  }, [])
  return state
}

/** Verdicts for the jobs this browser remembers, keyed by job id. */
export function useSummaries(entries: HistoryEntry[]) {
  const ids = entries.map((e) => e.jobId).join(',')
  const [data, setData] = useState<Record<string, JobSummary>>({})
  const [loading, setLoading] = useState(entries.length > 0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      api
        .jobs(ids ? ids.split(',') : [])
        .then((rows) => {
          if (cancelled) return
          setData(Object.fromEntries(rows.map((r) => [r.job_id, r])))
          setError(null)
          // Keep refreshing while anything is still being analyzed.
          if (rows.some((r) => r.status === 'queued' || r.status === 'running')) {
            timer = setTimeout(load, 2000)
          }
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setLoading(false))
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ids])

  return { data, loading, error }
}
