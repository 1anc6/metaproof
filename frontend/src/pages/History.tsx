import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { usePrefs } from '../lib/prefs'
import { useHistorySummaries } from '../lib/summaries'
import { clearWithUndo, removeWithUndo } from '../lib/undo'
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

const COLUMNS = 'md:grid-cols-[minmax(0,1fr)_160px_96px_120px_36px]'

export function History() {
  const history = useHistory()
  const prefs = usePrefs()
  const { data, error } = useHistorySummaries()
  // A search from the sidebar hands its words over in the router's state, never the address, so
  // filenames stay on this device. A later one, while this page is open, replaces the words.
  const location = useLocation()
  const handed = (location.state as { q?: string; focus?: boolean } | null)?.q
  // Opened with the "/" shortcut from a screen that has no search of its own: type straight away.
  const focusSearch = !!(location.state as { focus?: boolean } | null)?.focus
  const [query, setQuery] = useState(handed ?? '')
  const [taken, setTaken] = useState(location.key)
  if (location.key !== taken) {
    setTaken(location.key)
    if (handed !== undefined) setQuery(handed)
  }
  // ?filter= lets the counts and the sidebar's folders open this list already filtered.
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
            <Plus className="size-4" strokeWidth={2.4} /> New analysis
          </Link>
        }
      />

      {/* Search and filters only once there is something to search. */}
      {history.length > 0 && (
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {/* How many rows the current search and filter leave. */}
            <p className="flex shrink-0 items-baseline gap-1.5" aria-live="polite">
              <span className="num text-[32px] leading-none">{rows.length}</span>
              <span className="text-[14px] text-faint">{filter === 'all' ? 'total' : FILTERS.find((f) => f.key === filter)!.label.toLowerCase()}</span>
              <span className="sr-only">analyses shown</span>
            </p>
            <label className="panel flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-full px-4">
              <Search className="size-4 shrink-0 text-faint" strokeWidth={1.8} aria-hidden />
              <input
                id="history-search"
                type="search"
                autoFocus={focusSearch}
                aria-label="Search by filename"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by filename…"
                className="w-full bg-transparent text-[14px] outline-none placeholder:text-faint"
              />
            </label>
          </div>
          <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 sm:pb-0">
            <div className="track inline-flex gap-0.5 rounded-full p-1">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  aria-pressed={filter === f.key}
                  className={`flex h-9 shrink-0 items-center rounded-full px-3.5 text-[13.5px] whitespace-nowrap transition ${
                    filter === f.key ? 'selected font-medium' : 'text-muted hover:text-ink'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-ai">{error}</p>}

      {history.length === 0 ? (
        <div className="panel flex flex-col items-start gap-4 rounded-[28px] p-6 sm:flex-row sm:items-center sm:p-8">
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold">Nothing here yet</p>
            <p className="mt-1 max-w-md text-[15px] text-muted">Analyses you run on this device will appear here, newest first.</p>
          </div>
          <Link to="/new" className="btn-primary">
            <Plus className="size-4" strokeWidth={2.4} /> Analyze an image
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel rounded-[28px] px-6 py-6 text-[15px] text-muted">No analyses match this search and filter.</div>
      ) : (
        <div className="panel rounded-[28px] p-2 sm:p-3">
          {/* header row, desktop only */}
          <div className={`grid gap-4 px-3 py-2.5 text-fine text-faint max-md:hidden ${COLUMNS}`} aria-hidden>
            <span>File</span>
            <span>Verdict</span>
            <span className="text-right">Size</span>
            <span className="text-right">Analyzed</span>
            <span />
          </div>
          <ul className="flex flex-col gap-0.5">
            {rows.map((entry) => {
              const s = data[entry.jobId]
              return (
                <li key={entry.jobId} className="group relative">
                  <Link
                    to={`/analysis/${entry.jobId}`}
                    className={`grid grid-cols-[minmax(0,1fr)_36px] items-center gap-4 rounded-[18px] px-3 py-2.5 transition hover:bg-[var(--raise-bg)] hover:shadow-[var(--raise-shadow)] ${COLUMNS}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="size-11 shrink-0 rounded-[13px]" />
                      <span className="min-w-0 flex-1">
                        <FileName name={entry.filename} className="text-[14.5px] font-medium" />
                        <span className="block truncate text-fine text-faint max-md:hidden">{s ? `${s.width}×${s.height}` : ' '}</span>
                        {/* On phones the verdict sits under the name, so the name gets the row's full width. */}
                        <span className="mt-0.5 flex min-w-0 items-center gap-2 md:hidden">
                          {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}
                          <span className="truncate text-fine text-faint">{formatWhen(entry.uploadedAt)}</span>
                        </span>
                      </span>
                    </span>
                    <span className="max-md:hidden">{s ? <VerdictBadge label={s.label} status={s.status} pill /> : <span className="skeleton block h-3 w-20" />}</span>
                    <span className="text-right text-[13px] text-muted tabular-nums max-md:hidden">{formatBytes(entry.sizeBytes)}</span>
                    <span className="text-right text-[13px] text-faint max-md:hidden">{formatWhen(entry.uploadedAt)}</span>
                    <span />
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeWithUndo(entry.jobId, entry.filename)}
                    aria-label={`Remove ${entry.filename} from history`}
                    className="absolute top-1/2 right-3 grid size-9 -translate-y-1/2 place-items-center rounded-full text-faint transition hover:bg-raised hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                  >
                    <Trash2 className="size-4" strokeWidth={1.7} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {history.length > 0 && (
        <button type="button" onClick={clearWithUndo} className="mt-4 ml-2 text-[13px] text-faint transition hover:text-ai">
          Clear history on this device
        </button>
      )}
    </div>
  )
}
