import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { usePrefs } from '../lib/prefs'
import { clearWithUndo, removeWithUndo } from '../lib/undo'
import { useSummaries } from '../lib/hooks'
import { VERDICTS } from '../lib/verdicts'
import { FileName, PageHeader, Thumb, VerdictBadge } from '../components/ui'

type Filter = 'all' | 'flagged' | VerdictLabel

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'likely_ai_generated', label: VERDICTS.likely_ai_generated.short },
  { key: 'edited', label: VERDICTS.edited.short },
  { key: 'likely_authentic', label: VERDICTS.likely_authentic.short },
  { key: 'inconclusive', label: VERDICTS.inconclusive.short },
]

export function History() {
  const history = useHistory()
  const prefs = usePrefs()
  const { data, error } = useSummaries(history)
  const [query, setQuery] = useState('')
  // ?filter= lets the overview's counts open this list already filtered.
  const [params, setParams] = useSearchParams()
  const filter: Filter = FILTERS.some((f) => f.key === params.get('filter')) ? (params.get('filter') as Filter) : 'all'
  const setFilter = (next: Filter) => setParams(next === 'all' ? {} : { filter: next }, { replace: true })

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return history.filter((e) => {
      if (q && !e.filename.toLowerCase().includes(q)) return false
      const label = data[e.jobId]?.label
      if (filter === 'flagged' ? label !== 'edited' && label !== 'likely_ai_generated' : filter !== 'all' && label !== filter)
        return false
      return true
    })
  }, [history, data, query, filter])

  return (
    <div>
      <PageHeader
        title="History"
        subtitle="Every image you analyzed on this device. The list lives in your browser, not on the server."
        action={
          <Link to="/new" className="btn-primary">
            <Plus className="size-4" strokeWidth={2.5} /> New analysis
          </Link>
        }
      />

      {/* Search and filters only once there is something to search. */}
      {history.length > 0 && (
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        {/* How many rows the current search and filter leave, in dot-matrix, tagged with the filter. */}
        <p className="flex shrink-0 items-start gap-2" aria-live="polite">
          <span className="num text-[56px] leading-none">{rows.length}</span>
          <span className="mt-1 text-[14px] text-faint">{filter === 'all' ? 'total' : FILTERS.find((f) => f.key === filter)!.label.toLowerCase()}</span>
          <span className="sr-only">analyses shown</span>
        </p>
        <label className="well flex !flex-1 !place-items-stretch items-center gap-2.5 rounded-full px-4 py-3">
          <Search className="size-4 text-faint" aria-hidden />
          <input
            type="search"
            aria-label="Search by filename"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by filename…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-faint"
          />
        </label>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:pb-0">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`flex h-10 shrink-0 items-center rounded-full px-4 text-[14px] transition ${
                filter === f.key ? 'bg-primary text-on-primary' : 'well text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {error && <p className="mb-4 text-sm text-ai">{error}</p>}

      {history.length === 0 ? (
        <div className="panel rounded-xl px-4 py-6 sm:px-6 sm:py-8">
          <p className="text-[17px] font-semibold">Nothing here yet</p>
          <p className="mt-1 max-w-sm text-[15px] text-muted">Analyses you run on this device will appear here.</p>
          <Link to="/new" className="btn-primary mt-4">
            <Plus className="size-4" strokeWidth={2.5} /> Analyze an image
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel rounded-xl px-4 py-6 sm:px-6 sm:py-8 text-[15px] text-muted">No analyses match this search and filter.</div>
      ) : (
        <div className="panel overflow-hidden rounded-xl">
          {/* header row, desktop only */}
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(24px,0.35fr)_150px_120px_40px] gap-4 border-b border-line px-5 py-3 text-[13px] text-faint max-md:hidden">
            <span>File</span>
            <span />
            <span>Verdict</span>
            <span>Analyzed</span>
            <span />
          </div>
          <ul className="stagger">
            {rows.map((entry) => {
              const s = data[entry.jobId]
              return (
                <li key={entry.jobId} className="group animate-rise relative border-b border-line last:border-0">
                  <Link
                    to={`/analysis/${entry.jobId}`}
                    className="grid grid-cols-[1fr_32px] items-center gap-3 px-4 py-3 transition hover:bg-raised md:grid-cols-[minmax(0,1fr)_minmax(24px,0.35fr)_150px_120px_40px] md:gap-4 md:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="size-12 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <FileName name={entry.filename} className="text-sm font-medium" />
                        <p className="truncate text-[13px] whitespace-nowrap text-faint max-md:hidden">{formatBytes(entry.sizeBytes)}</p>
                        {/* On phones the verdict sits under the name, so the name gets the row's full width. */}
                        <div className="mt-1 flex min-w-0 items-center gap-2 md:hidden">
                          {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}
                          <span className="truncate text-[13px] text-faint">{formatWhen(entry.uploadedAt)}</span>
                        </div>
                      </div>
                    </div>
                    <span className="leader max-md:hidden" aria-hidden />
                    <div className="max-md:hidden">{s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}</div>
                    <span className="text-[13px] text-faint max-md:hidden">{formatWhen(entry.uploadedAt)}</span>
                    <span />
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeWithUndo(entry.jobId, entry.filename)}
                    aria-label={`Remove ${entry.filename} from history`}
                    className="absolute top-1/2 right-4 grid size-8 -translate-y-1/2 place-items-center rounded-md text-faint transition hover:bg-raised hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <button
          type="button"
          onClick={clearWithUndo}
          className="mt-4 text-[13px] text-faint transition hover:text-ink"
        >
          Clear history on this device
        </button>
      )}
    </div>
  )
}
