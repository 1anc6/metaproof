import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, EyeOff, Filter, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Job, type VerdictLabel } from '../lib/api'
import { DEMO_SHA } from '../lib/checks'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { formatWhen } from '../lib/format'
import { useHistory, type HistoryEntry } from '../lib/history'
import { setPref, usePrefs } from '../lib/prefs'
import { FOLDERS, tally, useHistorySummaries, type Summaries } from '../lib/summaries'
import { removeWithUndo } from '../lib/undo'
import { PENDING, VERDICTS } from '../lib/verdicts'
import { Chip, FileName, Thumb } from '../components/ui'

type Data = Summaries['data']

const isFlagged = (label: VerdictLabel | null | undefined) => label === 'edited' || label === 'likely_ai_generated'

/**
 * The overview, in liquid glass after the activity-dashboard reference: a greeting with search, the
 * verdicts as a cluster of glass bubbles sized by count, the month's analysis days on smoked glass,
 * the share of flagged images on a dial, the latest verdict on a slider, and the recent analyses.
 * Uploading lives on its own screen; here everything is about what has been found.
 */
export function Overview() {
  const history = useHistory()
  const { data, loading } = useHistorySummaries()
  const prefs = usePrefs()
  const t = tally(history, data)
  const latest = history.find((e) => data[e.jobId]?.status === 'done' && data[e.jobId]?.label)
  const recent = (prefs.onlyFlagged ? history.filter((e) => isFlagged(data[e.jobId]?.label)) : history).slice(0, 4)

  return (
    <div>
      <Greeting known={t.known} flagged={t.flagged} empty={history.length === 0} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
        <VerdictBubbles counts={t.counts} known={t.known} total={history.length} loading={loading && history.length > 0} className="md:col-span-12 xl:col-span-7" />
        <AnalysisDays history={history} data={data} className="md:col-span-6 xl:col-span-5" />
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 md:col-span-6 md:flex md:flex-col xl:col-span-5">
          <FlaggedDial flagged={t.flagged} known={t.known} />
          <LatestVerdict entry={latest} label={latest ? data[latest.jobId].label : null} blur={prefs.blurPreviews} />
        </div>
        <Recent
          entries={recent}
          data={data}
          loading={loading}
          blur={prefs.blurPreviews}
          onlyFlagged={prefs.onlyFlagged}
          empty={history.length === 0}
          className="md:col-span-12 xl:col-span-7"
        />
      </div>
    </div>
  )
}

/** "Good evening": the time of day, the finding in one line, and search beside it. */
function Greeting({ known, flagged, empty }: { known: number; flagged: number; empty: boolean }) {
  const [hour] = useState(() => new Date().getHours())
  const hello = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 18 ? 'Good afternoon' : 'Good evening'
  const line = empty
    ? 'Analyze your first image to see where it came from, and whether it was changed.'
    : known === 0
      ? 'Your first verdict is on its way.'
      : `${known} ${known === 1 ? 'verdict' : 'verdicts'} so far, ${flagged} flagged as edited or AI-generated.`
  return (
    <header className="mb-5 flex flex-col gap-4 lg:mb-7 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] sm:text-[32px]">{hello}</h1>
        <p className="mt-1 text-[15px] text-muted">{line}</p>
      </div>
      <div className="flex items-center gap-2.5">
        <SearchPill className="min-w-0 flex-1 lg:w-[300px] lg:flex-none" />
        <Link to="/new" className="btn-primary hidden lg:inline-flex">
          <Plus className="size-4" strokeWidth={2.4} /> New analysis
        </Link>
      </div>
    </header>
  )
}

/** Search by file name: Enter opens History with the words in its search box. Filenames stay in
 *  this browser, so they travel in the router's state and never in the address. */
function SearchPill({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  return (
    <form
      role="search"
      className={className}
      onSubmit={(e) => {
        e.preventDefault()
        navigate('/history', { state: { q: q.trim() } })
      }}
    >
      <label className="panel flex h-11 items-center gap-2.5 rounded-full pr-2 pl-4">
        <Search className="size-4 shrink-0 text-faint" strokeWidth={1.8} aria-hidden />
        <input
          id="global-search"
          name="q"
          type="search"
          aria-label="Search history"
          autoComplete="off"
          spellCheck={false}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search your history…"
          className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="kbd max-sm:hidden" aria-hidden>
          /
        </kbd>
      </label>
    </form>
  )
}

/** Each verdict's bubble: a glass sphere in its colour, lit from the top left. The neutral one is
 *  set in the stylesheet so it can lighten on dark glass. */
const BUBBLE: Record<VerdictLabel, { fill: string; deep: string; ink: string; glow: string }> = {
  likely_ai_generated: { fill: '#f6735f', deep: '#e2432e', ink: '#ffffff', glow: 'rgb(238 78 56 / 0.5)' },
  edited: { fill: '#f9d35e', deep: '#f2aa26', ink: '#3a2900', glow: 'rgb(242 170 38 / 0.5)' },
  likely_authentic: { fill: '#68d8a2', deep: '#24a467', ink: '#04301a', glow: 'rgb(36 164 103 / 0.42)' },
  inconclusive: { fill: 'var(--bubble-neutral)', deep: 'var(--bubble-neutral-deep)', ink: '#ffffff', glow: 'rgb(20 18 24 / 0.32)' },
}

/** The verdicts as bubbles whose areas follow their counts, with a legend that opens History filtered. */
function VerdictBubbles({
  counts,
  known,
  total,
  loading,
  className = '',
}: {
  counts: Record<VerdictLabel, number>
  known: number
  total: number
  loading: boolean
  className?: string
}) {
  return (
    <section aria-label="Your analyses" className={`panel flex flex-col rounded-[30px] p-5 sm:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em]">What your images showed</h2>
          <p className="label mt-0.5">
            {total === 0
              ? 'Nothing analyzed on this device yet'
              : `${known} ${known === 1 ? 'verdict' : 'verdicts'} from ${total} ${total === 1 ? 'analysis' : 'analyses'} on this device`}
          </p>
        </div>
        <Link to="/history" className="icon-btn size-9 rounded-[12px]" aria-label="Open history">
          <ArrowUpRight className="size-4" strokeWidth={1.8} />
        </Link>
      </div>

      <div className="mt-4 grid flex-1 grid-cols-1 gap-4 sm:grid-cols-[minmax(0,210px)_minmax(0,1fr)] sm:items-center">
        <ul className="grid grid-cols-2 gap-1 max-sm:order-2 sm:grid-cols-1">
          {FOLDERS.map((label) => (
            <li key={label}>
              <Link to={`/history?filter=${label}`} className="flex items-center gap-2.5 rounded-[14px] px-2 py-2 transition hover:bg-[var(--row-bg)] sm:gap-3 sm:px-2.5">
                <span
                  className="h-2.5 w-5 shrink-0 rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.5)] sm:w-7"
                  style={{ background: `linear-gradient(90deg, ${BUBBLE[label].fill}, ${BUBBLE[label].deep})` }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-muted">{VERDICTS[label].short}</span>
                <span className="text-[14px] font-semibold tabular-nums">{loading ? '–' : counts[label]}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Bubbles counts={counts} empty={total === 0} />
      </div>
    </section>
  )
}

type Placed = { label: VerdictLabel; count: number; x: number; y: number; r: number }

// Where the smaller bubbles sit around the largest, in degrees with y pointing down, and how far
// they overlap it: the second to its left, the third above that, the fourth below on the right.
const ANGLE = [0, 160, 218, 32]
const NEAR = [0, 0.78, 0.84, 0.86]

/** Lays the bubbles out around the largest, then scales and centres the cluster in a w × h box. */
function cluster(items: { label: VerdictLabel; count: number }[], w: number, h: number): Placed[] {
  const max = Math.max(...items.map((i) => i.count))
  const sized = [...items].sort((a, b) => b.count - a.count).map((i) => ({ ...i, r: 100 * Math.max(0.42, Math.sqrt(i.count / max)) }))
  const pts = sized.map((b, i) => {
    if (i === 0) return { ...b, x: 0, y: 0 }
    const a = (ANGLE[i] * Math.PI) / 180
    const d = (sized[0].r + b.r) * NEAR[i]
    return { ...b, x: d * Math.cos(a), y: d * Math.sin(a) }
  })
  const minX = Math.min(...pts.map((p) => p.x - p.r))
  const maxX = Math.max(...pts.map((p) => p.x + p.r))
  const minY = Math.min(...pts.map((p) => p.y - p.r))
  const maxY = Math.max(...pts.map((p) => p.y + p.r))
  const pad = 14
  const s = Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY))
  const ox = (w - (maxX - minX) * s) / 2 - minX * s
  const oy = (h - (maxY - minY) * s) / 2 - minY * s
  return pts.map((p) => ({ ...p, x: p.x * s + ox, y: p.y * s + oy, r: p.r * s }))
}

/** The outline cluster shown before there is anything to count. */
const GHOST: { label: VerdictLabel; count: number }[] = [
  { label: 'inconclusive', count: 5 },
  { label: 'likely_ai_generated', count: 2 },
  { label: 'edited', count: 1 },
]

function Bubbles({ counts, empty }: { counts: Record<VerdictLabel, number>; empty: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const items = FOLDERS.map((label) => ({ label, count: counts[label] })).filter((i) => i.count > 0)
  const ghost = items.length === 0
  const placed = size ? cluster(ghost ? GHOST : items, size.w, size.h) : []

  return (
    <div ref={box} className="relative h-[220px] sm:h-full sm:min-h-[250px]" aria-hidden>
      {placed.map((b, i) =>
        ghost ? (
          <div
            key={b.label}
            className="absolute grid place-items-center rounded-full border-[1.5px] border-dashed border-[var(--zone-edge)] bg-[var(--row-bg)] text-center"
            style={{ left: b.x - b.r, top: b.y - b.r, width: b.r * 2, height: b.r * 2 }}
          >
            {i === 0 && <span className="px-4 text-[13px] leading-snug text-faint">{empty ? 'Your verdicts will gather here' : 'Waiting for verdicts'}</span>}
          </div>
        ) : (
          <div
            key={b.label}
            title={`${VERDICTS[b.label].short}: ${b.count}`}
            className="absolute grid place-items-center rounded-full text-center"
            style={{
              left: b.x - b.r,
              top: b.y - b.r,
              width: b.r * 2,
              height: b.r * 2,
              zIndex: i + 1,
              color: BUBBLE[b.label].ink,
              background: `radial-gradient(circle at 34% 26%, rgb(255 255 255 / 0.62), rgb(255 255 255 / 0) 40%), radial-gradient(circle at 50% 62%, ${BUBBLE[b.label].fill} 0%, ${BUBBLE[b.label].deep} 100%)`,
              boxShadow: `inset 0 -10px 24px rgb(0 0 0 / 0.12), inset 0 2px 3px rgb(255 255 255 / 0.6), 0 24px 44px -16px ${BUBBLE[b.label].glow}`,
              opacity: i === 0 ? 1 : 0.93,
            }}
          >
            <span>
              <span className="block leading-none font-semibold tabular-nums" style={{ fontSize: Math.max(15, Math.min(34, b.r * 0.4)) }}>
                {b.count}
              </span>
              {b.r >= 46 && <span className="mt-1 block text-[12px] font-medium opacity-80">{VERDICTS[b.label].short}</span>}
            </span>
          </div>
        ),
      )}
    </div>
  )
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)

// Monday first, named in the reader's language (1 January 2024 was a Monday).
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(2024, 0, 1 + i)
  return { short: d.toLocaleDateString(undefined, { weekday: 'narrow' }), long: d.toLocaleDateString(undefined, { weekday: 'long' }) }
})

/**
 * The month's analysis days on smoked glass, like the reference's training calendar: a white day had
 * analyses, a coral day had at least one flagged image, and today wears a yellow ring.
 */
function AnalysisDays({ history, data, className = '' }: { history: HistoryEntry[]; data: Data; className?: string }) {
  const [today] = useState(() => new Date())
  const thisMonth = startOfMonth(today)
  const [month, setMonth] = useState(thisMonth)

  const days = useMemo(() => {
    const map = new Map<string, { count: number; flagged: number }>()
    for (const e of history) {
      const key = dayKey(new Date(e.uploadedAt))
      const day = map.get(key) ?? { count: 0, flagged: 0 }
      day.count += 1
      if (isFlagged(data[e.jobId]?.label)) day.flagged += 1
      map.set(key, day)
    }
    return map
  }, [history, data])

  // Back as far as the oldest analysis kept here (the list is newest first).
  const oldest = history.length ? startOfMonth(new Date(history[history.length - 1].uploadedAt)) : thisMonth
  const canBack = month > oldest
  const canForward = month < thisMonth
  const step = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1))

  const lead = (month.getDay() + 6) % 7
  const length = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length }, (_, i) => i + 1)]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))

  let analyses = 0
  let active = 0
  for (let d = 1; d <= length; d++) {
    const day = days.get(dayKey(new Date(month.getFullYear(), month.getMonth(), d)))
    if (day) {
      analyses += day.count
      active += 1
    }
  }
  const name = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <section className={`smoke flex flex-col rounded-[30px] p-5 sm:p-6 ${className}`} aria-labelledby="days-title">
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[10.5rem] flex-1">
          <h2 id="days-title" className="text-[17px] font-semibold tracking-[-0.01em]">
            Your analysis days
          </h2>
          <p className="mt-0.5 text-[13px] text-white/60">
            {analyses === 0 ? 'Nothing analyzed this month' : `${analyses} ${analyses === 1 ? 'analysis' : 'analyses'} on ${active} ${active === 1 ? 'day' : 'days'}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={!canBack}
            aria-label="Previous month"
            className="grid size-8 place-items-center rounded-full bg-white/8 transition hover:bg-white/15 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[7.5rem] text-center text-[13px] font-medium" aria-live="polite">
            {name}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={!canForward}
            aria-label="Next month"
            className="grid size-8 place-items-center rounded-full bg-white/8 transition hover:bg-white/15 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <table className="relative mt-4 w-full table-fixed border-separate border-spacing-y-1 text-center">
        <caption className="sr-only">Days with analyses in {name}</caption>
        <thead>
          <tr>
            {WEEKDAYS.map((w, i) => (
              <th key={i} scope="col" abbr={w.long} className="pb-1.5 text-[12px] font-medium text-white/45">
                {w.short}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((d, j) => {
                if (!d) return <td key={j} />
                const date = new Date(month.getFullYear(), month.getMonth(), d)
                const day = days.get(dayKey(date))
                const isToday = dayKey(date) === dayKey(today)
                const words = day ? `${day.count} ${day.count === 1 ? 'analysis' : 'analyses'}${day.flagged ? `, ${day.flagged} flagged` : ''}` : ''
                return (
                  <td key={j}>
                    <span
                      title={words || undefined}
                      className={`mx-auto grid size-8 place-items-center rounded-full text-[13px] tabular-nums sm:size-9 ${
                        day?.flagged
                          ? 'bg-[#f4644e] font-semibold text-white shadow-[0_8px_18px_-8px_rgb(244_100_78/0.9),inset_0_1px_0_rgb(255_255_255/0.35)]'
                          : day
                            ? 'bg-white/90 font-semibold text-[#17161a] shadow-[inset_0_-2px_4px_rgb(0_0_0/0.08)]'
                            : date > today
                              ? 'text-white/30'
                              : 'text-white/75'
                      } ${isToday ? 'outline-2 outline-offset-2 outline-[#f7c948]' : ''}`}
                    >
                      {d}
                      {(words || isToday) && <span className="sr-only">{[isToday && 'today', words].filter(Boolean).join(': ')}</span>}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="relative mt-auto flex flex-wrap gap-x-4 gap-y-1.5 pt-3 text-[12px] text-white/65">
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full outline-2 outline-[#f7c948]" aria-hidden /> Today
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-white/90" aria-hidden /> Analyzed
        </li>
        <li className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-[#f4644e]" aria-hidden /> Flagged
        </li>
      </ul>
    </section>
  )
}

/** The share of verdicts that were flagged, on a ticked dial like the reference's step goal. */
function FlaggedDial({ flagged, known }: { flagged: number; known: number }) {
  const share = known ? flagged / known : 0
  const pct = Math.round(share * 100)
  // the tag sits where the arc ends, starting from the top and running clockwise
  const angle = ((-90 + share * 360) * Math.PI) / 180
  const tag = { left: 66 + 50 * Math.cos(angle), top: 66 + 50 * Math.sin(angle) }
  return (
    <section className="panel flex flex-1 items-center gap-3 rounded-[28px] p-5" aria-labelledby="flagged-title">
      <div className="flex min-w-0 flex-1 flex-col self-stretch">
        <h2 id="flagged-title" className="card-title">
          Flagged images
        </h2>
        <p className="label mt-0.5">Edited or likely AI-generated</p>
        <Link to="/history?filter=flagged" className="group mt-auto inline-flex items-center gap-2 pt-5 text-[14px] font-medium">
          See flagged
          <span className="orb-solid size-7 transition-transform group-hover:translate-x-0.5">
            <ArrowRight className="size-3.5" strokeWidth={2.2} />
          </span>
        </Link>
      </div>
      <div className="relative size-[132px] shrink-0" role="img" aria-label={known ? `${pct}% of verdicts flagged, ${flagged} of ${known}` : 'No verdicts yet'}>
        <svg viewBox="0 0 132 132" className="size-full -rotate-90" aria-hidden>
          <defs>
            <linearGradient id="dial-arc" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f7c948" />
              <stop offset="1" stopColor="#f4644e" />
            </linearGradient>
          </defs>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i * 6 * Math.PI) / 180
            return (
              <line
                key={i}
                x1={66 + 59 * Math.cos(a)}
                y1={66 + 59 * Math.sin(a)}
                x2={66 + 64 * Math.cos(a)}
                y2={66 + 64 * Math.sin(a)}
                stroke="var(--color-line-strong)"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            )
          })}
          <circle cx="66" cy="66" r="50" fill="none" stroke="var(--track-bg)" strokeWidth="9" />
          {share > 0 && (
            <circle
              cx="66"
              cy="66"
              r="50"
              fill="none"
              stroke="url(#dial-arc)"
              strokeWidth="9"
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray={`${share} 1`}
              className="animate-draw"
              style={{ strokeDashoffset: 0 }}
            />
          )}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
          <span>
            <span className="block text-[11.5px] text-faint">Flagged</span>
            <span className="block text-[26px] leading-none font-semibold tabular-nums">
              {known ? pct : '–'}
              {known > 0 && <span className="text-[14px] font-medium text-faint">%</span>}
            </span>
          </span>
        </div>
        {known > 0 && (
          <span className="raise absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap tabular-nums" style={tag} aria-hidden>
            {flagged} of {known}
          </span>
        )}
      </div>
    </section>
  )
}

// Where each verdict sits on the slider: the middle of its quarter of the scale.
const AT: Record<VerdictLabel, number> = { likely_authentic: 12.5, inconclusive: 37.5, edited: 62.5, likely_ai_generated: 87.5 }

/**
 * The latest verdict on a slider from authentic to AI-generated, like the reference's plan bar.
 * Before anything is analyzed here, the stored example report stands in, and says so.
 */
function LatestVerdict({ entry, label, blur }: { entry?: HistoryEntry; label: VerdictLabel | null; blur: boolean }) {
  const [example, setExample] = useState<Job | null>(null)
  useEffect(() => {
    if (entry) return
    let cancelled = false
    api
      .report(DEMO_SHA)
      .then((j) => !cancelled && setExample(j))
      .catch(() => {}) // the card still opens the example; it just shows no verdict
    return () => {
      cancelled = true
    }
  }, [entry])
  const shown = entry ? label : (example?.verdict?.label ?? null)
  const v = shown ? VERDICTS[shown] : null
  const at = shown ? AT[shown] : null
  return (
    <Link
      to={entry ? `/analysis/${entry.jobId}` : DEMO_REPORT_PATH}
      aria-label={`${entry ? 'Latest analysis' : 'Example report'}${v ? `: ${v.title}` : ''}. Open the report`}
      className="panel group flex flex-1 flex-col rounded-[28px] p-5"
    >
      <span className="flex items-start gap-3">
        <Thumb sha={entry?.sha256 ?? DEMO_SHA} blur={blur && !!entry} className="size-11 shrink-0 rounded-[14px]" />
        <span className="min-w-0 flex-1">
          <span className="card-title block">{entry ? 'Latest analysis' : 'Example report'}</span>
          <span className="label mt-0.5 flex min-w-0 gap-1">
            {entry ? (
              <>
                <FileName name={entry.filename} />
                <span aria-hidden>·</span>
                <span className="shrink-0">{formatWhen(entry.uploadedAt)}</span>
              </>
            ) : (
              <span className="truncate">A FLUX image the detector never saw</span>
            )}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[19px] leading-none font-semibold tracking-[-0.01em]" style={{ color: v?.color }}>
            {v?.short ?? '–'}
          </span>
          <span className="label mt-1 block">Verdict</span>
        </span>
      </span>
      <span className="mt-auto block pt-10" aria-hidden>
        <span className="relative block h-2.5">
          {/* the scale: dotted where the verdict has not reached, solid up to it */}
          <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle,var(--color-line-strong)_1.3px,transparent_1.7px)] bg-[length:9px_100%] bg-repeat-x" />
          {at !== null && v && (
            <>
              <span className="animate-grow absolute inset-y-0 left-0 origin-left rounded-full bg-ink" style={{ width: `${at}%` }} />
              <span className="absolute top-1/2 size-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-ink bg-[var(--raise-bg)]" style={{ left: `${at}%` }} />
              <span className="absolute -top-9 -translate-x-1/2 rounded-full bg-ink px-2.5 py-1 text-[11.5px] font-semibold whitespace-nowrap text-canvas" style={{ left: `${at}%` }}>
                {v.short}
              </span>
            </>
          )}
        </span>
        <span className="mt-2.5 flex justify-between text-[12.5px] font-medium text-muted">
          <span>Authentic</span>
          <span>AI-generated</span>
        </span>
      </span>
    </Link>
  )
}

/** Four bars, one per place on the scale, with the verdict's own lit in its colour. */
function Segments({ label, busy }: { label: VerdictLabel | null; busy: boolean }) {
  return (
    <span className="flex shrink-0 gap-[3px]" aria-hidden>
      {(['likely_authentic', 'inconclusive', 'edited', 'likely_ai_generated'] as const).map((key) => (
        <span
          key={key}
          className={`h-4 w-2.5 rounded-[3px] ${busy ? 'animate-pulse' : ''}`}
          style={{ background: key === label ? VERDICTS[key].dot : 'var(--track-bg)' }}
        />
      ))}
    </span>
  )
}

/** The last few analyses as glass rows, like the reference's habit list, with the blur and only-flagged switches. */
function Recent({
  entries,
  data,
  loading,
  blur,
  onlyFlagged,
  empty,
  className = '',
}: {
  entries: HistoryEntry[]
  data: Data
  loading: boolean
  blur: boolean
  onlyFlagged: boolean
  empty: boolean
  className?: string
}) {
  return (
    <section className={`panel flex flex-col rounded-[30px] p-4 sm:p-5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-1">
        <h2 className="mr-auto text-[17px] font-semibold tracking-[-0.01em]">Recent analyses</h2>
        {!empty && (
          <>
            <div className="order-3 flex basis-full flex-wrap items-center gap-2 sm:order-none sm:basis-auto">
              <Chip icon={EyeOff} label="Blur previews" checked={blur} onChange={(v) => setPref('blurPreviews', v)} />
              <Chip icon={Filter} label="Only flagged" checked={onlyFlagged} onChange={(v) => setPref('onlyFlagged', v)} />
            </div>
            <Link to="/history" className="group inline-flex items-center gap-2 text-[13.5px] font-medium whitespace-nowrap">
              See all
              <span className="grid size-7 place-items-center rounded-full bg-ink text-canvas transition-transform group-hover:translate-x-0.5">
                <ArrowRight className="size-3.5" strokeWidth={2.2} />
              </span>
            </Link>
          </>
        )}
      </div>

      {empty ? (
        <div className="row-glass mt-4 flex flex-1 flex-col items-start justify-center gap-3 rounded-[20px] p-5 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[14.5px] text-muted">Nothing analyzed on this device yet. Each image you check lands here, with its verdict.</p>
          <Link to="/new" className="btn-primary">
            <Plus className="size-4" strokeWidth={2.4} /> Analyze an image
          </Link>
        </div>
      ) : entries.length === 0 ? (
        <p className="px-1 pt-4 pb-2 text-[14px] text-muted">{loading ? 'Loading verdicts…' : 'Nothing edited or AI-generated among your analyses.'}</p>
      ) : (
        <ul className="mt-4 flex flex-1 flex-col gap-2">
          {entries.map((entry) => (
            <RecentRow key={entry.jobId} entry={entry} data={data} blur={blur} />
          ))}
          {/* fewer than four: the rest of the card says where the next ones will go */}
          {entries.length < 4 && !onlyFlagged && (
            <li className="flex min-h-14 flex-1 items-center justify-center rounded-[18px] border-[1.5px] border-dashed border-[var(--zone-edge)] px-4 text-center text-[13px] text-faint">
              <span>
                Your next analyses will line up here.{' '}
                <Link to="/new" className="font-medium text-accent hover:underline">
                  Analyze another
                </Link>
              </span>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function RecentRow({ entry, data, blur }: { entry: HistoryEntry; data: Data; blur: boolean }) {
  const s = data[entry.jobId]
  const label = s?.status === 'done' ? s.label : null
  const word = !s ? '…' : label ? VERDICTS[label].short : PENDING[s.status === 'done' ? 'queued' : s.status].title
  return (
    <li className="relative">
      <Link
        to={`/analysis/${entry.jobId}`}
        className="row-glass grid grid-cols-1 items-center gap-x-4 gap-y-1.5 rounded-[18px] py-2.5 pr-14 pl-2.5 transition hover:bg-[var(--raise-bg)] md:grid-cols-[minmax(0,1fr)_auto]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Thumb sha={entry.sha256} blur={blur} className="size-10 shrink-0 rounded-full" />
          <span className="min-w-0">
            <FileName name={entry.filename} className="text-[14px] font-semibold" />
            <span className="block truncate text-[12.5px] text-faint">
              {formatWhen(entry.uploadedAt)}
              {s?.width ? ` · ${s.width}×${s.height}` : ''}
            </span>
          </span>
        </span>
        <span className="flex items-center gap-2.5 pl-[52px] md:pl-0">
          <span className="text-[12.5px] text-faint">Verdict</span>
          <Segments label={label} busy={!!s && (s.status === 'queued' || s.status === 'running')} />
          <span className={`w-[92px] truncate text-[13px] font-medium ${s?.status === 'failed' ? 'text-ai' : ''}`}>{word}</span>
        </span>
      </Link>
      <RowMenu entry={entry} />
    </li>
  )
}

/** "⋯" on a row: open the report, or take the analysis off this device's list. */
function RowMenu({ entry }: { entry: HistoryEntry }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = `row-menu-${entry.jobId}`
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={box} className="absolute top-1/2 right-2 z-10 -translate-y-1/2">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`More for ${entry.filename}`}
        aria-controls={id}
        aria-expanded={open}
        className="grid size-9 place-items-center rounded-full text-faint transition hover:bg-[var(--raise-bg)] hover:text-ink"
      >
        <MoreHorizontal className="size-[18px]" />
      </button>
      {open && (
        <div id={id} className="glass animate-pop absolute top-full right-0 z-20 mt-1.5 w-52 origin-top-right rounded-[18px] p-1.5">
          <Link to={`/analysis/${entry.jobId}`} className="relative flex h-10 items-center rounded-[12px] px-3 text-[14px] hover:bg-[var(--raise-bg)]">
            Open the report
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              removeWithUndo(entry.jobId, entry.filename)
            }}
            className="relative flex h-10 w-full items-center rounded-[12px] px-3 text-left text-[14px] text-ai hover:bg-[var(--raise-bg)]"
          >
            Remove from history
          </button>
        </div>
      )}
    </div>
  )
}
