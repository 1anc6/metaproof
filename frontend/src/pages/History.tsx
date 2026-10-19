import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { clearWithUndo, removeWithUndo } from '../lib/undo'
import { useSummaries } from '../lib/hooks'
import { VERDICTS } from '../lib/verdicts'
import { PageHeader, Thumb, VerdictBadge } from '../components/ui'

type Filter = 'all' | VerdictLabel

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'likely_ai_generated', label: VERDICTS.likely_ai_generated.short },
  { key: 'edited', label: VERDICTS.edited.short },
  { key: 'likely_authentic', label: VERDICTS.likely_authentic.short },
  { key: 'inconclusive', label: VERDICTS.inconclusive.short },
]

export function History() {
  const history = useHistory()
  const { data, error } = useSummaries(history)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return history.filter((e) => {
      if (q && !e.filename.toLowerCase().includes(q)) return false
      if (filter !== 'all' && data[e.jobId]?.label !== filter) return false
      return true
    })
  }, [history, data, query, filter])

  return (
    <div>
      <PageHeader
        eyebrow="Archive"
        title="Analysis history."
        subtitle="Every image you analyzed on this device. The list lives in your browser, not on the server."
        action={
          <Link to="/new" className="btn-primary">
            <Plus className="size-4" strokeWidth={2.5} /> New analysis
          </Link>
        }
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="glass flex flex-1 items-center gap-2.5 rounded-full px-4 py-2.5 focus-within:ring-2 focus-within:ring-white/50">
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
              className={`shrink-0 rounded-full px-3.5 py-2 text-xs transition ${
                filter === f.key ? 'bg-white text-black' : 'glass text-muted hover:text-ink'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-ai">{error}</p>}

      {history.length === 0 ? (
        <div className="glass rounded-[28px] px-6 py-16 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-faint">Analyses you run on this device will appear here.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-[28px] px-6 py-12 text-center text-sm text-faint">No analyses match.</div>
      ) : (
        <div className="glass overflow-hidden rounded-[28px]">
          {/* header row, desktop only */}
          <div className="grid grid-cols-[1fr_150px_120px_40px] gap-4 border-b border-white/5 px-5 py-3 font-mono text-[10px] tracking-widest text-faint uppercase max-md:hidden">
            <span>File</span>
            <span>Verdict</span>
            <span>Analyzed</span>
            <span />
          </div>
          <ul className="stagger">
            {rows.map((entry) => {
              const s = data[entry.jobId]
              return (
                <li key={entry.jobId} className="group animate-rise relative border-b border-white/5 last:border-0">
                  <Link
                    to={`/analysis/${entry.jobId}`}
                    className="grid grid-cols-[1fr_auto_32px] items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03] md:grid-cols-[1fr_150px_120px_40px] md:gap-4 md:px-5"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Thumb sha={entry.sha256} className="size-11 shrink-0 rounded-xl" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{entry.filename}</p>
                        <p className="text-xs text-faint">
                          {formatBytes(entry.sizeBytes)}
                          <span className="md:hidden"> · {formatWhen(entry.uploadedAt)}</span>
                        </p>
                      </div>
                    </div>
                    <div>{s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}</div>
                    <span className="text-xs text-faint max-md:hidden">{formatWhen(entry.uploadedAt)}</span>
                    <span />
                  </Link>
                  <button
                    type="button"
                    onClick={() => removeWithUndo(entry.jobId, entry.filename)}
                    aria-label={`Remove ${entry.filename} from history`}
                    className="absolute top-1/2 right-4 grid size-8 -translate-y-1/2 place-items-center rounded-full text-faint transition hover:bg-white/10 hover:text-ink md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
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
          className="mt-4 text-xs text-faint transition hover:text-ink"
        >
          Clear history on this device
        </button>
      )}
    </div>
  )
}
