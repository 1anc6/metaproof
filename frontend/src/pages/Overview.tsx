import { ArrowRight, ArrowUpRight, ChevronRight, CircleCheck, Image as ImageIcon, Plus, Search, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Job, type VerdictLabel } from '../lib/api'
import { DEMO_SHA } from '../lib/checks'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { formatWhen } from '../lib/format'
import { useHistory, type HistoryEntry } from '../lib/history'
import { setPref, usePrefs, type Period } from '../lib/prefs'
import { tally, useHistorySummaries, type Summaries } from '../lib/summaries'
import { VERDICTS } from '../lib/verdicts'
import { FileName, Switch, Thumb, VerdictDot } from '../components/ui'

type Data = Summaries['data']

const isFlagged = (label: VerdictLabel | null | undefined) => label === 'edited' || label === 'likely_ai_generated'
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

const PERIODS: { key: Period; label: string; span: string }[] = [
  { key: 'all', label: 'All time', span: 'so far' },
  { key: 'month', label: 'This month', span: 'this month' },
  { key: 'week', label: 'This week', span: 'this week' },
]

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Midnight on this week's Monday, or on the 1st of this month; nothing for all time. */
function periodStart(period: Period, now: Date): Date | null {
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === 'week') {
    const monday = midnight(now)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    return monday
  }
  return null
}

/**
 * The overview, after the smart-home reference: the period as large words across the top (it
 * scopes every card below), then two columns of glass. On the left, the images checked and the
 * verdicts on a dial, where the reference has its members and thermostat; on the right, the
 * latest verdict with the ones before it on a line, the last flagged and last authentic images,
 * and the analyses over time as bars, where it has the weather, the doors and the energy chart.
 */
export function Overview() {
  const history = useHistory()
  const { data, loading } = useHistorySummaries()
  const { period, blurPreviews: blur } = usePrefs()
  const [now] = useState(() => new Date())
  const entries = useMemo(() => {
    const start = periodStart(period, now)
    return start ? history.filter((e) => new Date(e.uploadedAt) >= start) : history
  }, [history, period, now])
  const t = tally(entries, data)
  const span = PERIODS.find((p) => p.key === period)!.span
  const done = entries.filter((e) => data[e.jobId]?.status === 'done' && data[e.jobId]?.label)
  const firstVisit = history.length === 0
  const example = useExample(firstVisit)
  const waiting = loading && entries.length > 0

  return (
    <div>
      <h1 className="sr-only">Overview</h1>
      <Header period={period} />
      <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Images entries={entries} blur={blur} span={span} firstVisit={firstVisit} />
          <VerdictDial counts={t.counts} known={t.known} span={span} waiting={waiting} className="flex-1" />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Latest done={done} data={data} span={span} waiting={waiting} example={example} now={now} />
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <Spotlight
              kind="flagged"
              entry={done.find((e) => isFlagged(data[e.jobId].label))}
              data={data}
              blur={blur}
              span={span}
              example={example}
            />
            <Spotlight kind="authentic" entry={done.find((e) => data[e.jobId].label === 'likely_authentic')} data={data} blur={blur} span={span} />
          </div>
          <Activity entries={entries} data={data} period={period} now={now} className="flex-1" />
        </div>
      </div>
    </div>
  )
}

/** Before anything is analyzed here, the stored example report stands in for the latest verdict. */
function useExample(wanted: boolean) {
  const [job, setJob] = useState<Job | null>(null)
  useEffect(() => {
    if (!wanted) return
    let cancelled = false
    api
      .report(DEMO_SHA)
      .then((j) => !cancelled && setJob(j))
      .catch(() => {}) // the cards still open the example; they just show no verdict
    return () => {
      cancelled = true
    }
  }, [wanted])
  return wanted ? job : null
}

/** The period as large words, the chosen one bright, like the reference's rooms; search beside it. */
function Header({ period }: { period: Period }) {
  return (
    <header className="mb-5 flex flex-col gap-4 @3xl:mb-6 @3xl:flex-row @3xl:items-center @3xl:justify-between">
      <div role="group" aria-label="Period" className="-m-1 flex items-baseline gap-x-4 overflow-x-auto p-1 [scrollbar-width:none] @lg:gap-x-6 @5xl:gap-x-8">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={period === p.key}
            onClick={() => setPref('period', p.key)}
            className={`shrink-0 rounded-lg text-[22px] leading-tight font-medium tracking-[-0.02em] whitespace-nowrap transition-colors @lg:text-[26px] @5xl:text-[28px] ${
              period === p.key ? 'text-ink' : 'text-[var(--tab-dim)] hover:text-muted'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <SearchPill className="min-w-0 flex-1 @3xl:w-[220px] @3xl:flex-none @5xl:w-[260px]" />
        <Link to="/new" className="btn-primary max-lg:hidden">
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

/** The images checked in the period as a row of overlapping circles, like the reference's members,
 *  with + for a new analysis and the switch that blurs every preview. */
function Images({ entries, blur, span, firstVisit }: { entries: HistoryEntry[]; blur: boolean; span: string; firstVisit: boolean }) {
  const shown = entries.slice(0, 4)
  const more = entries.length - shown.length
  return (
    <section aria-labelledby="images-title" className="panel rounded-[28px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="images-title" className="card-title">
            Your images
          </h2>
          <p className="label mt-0.5">
            {entries.length > 0
              ? `${entries.length} ${plural(entries.length, 'image')} checked ${span}`
              : firstVisit
                ? 'Nothing checked yet'
                : `Nothing checked ${span}`}
          </p>
        </div>
        <Link to="/new" className="icon-btn size-10" aria-label="New analysis" title="New analysis (N)">
          <Plus className="size-5" strokeWidth={1.7} />
        </Link>
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <ul className="flex min-w-0 items-center">
          {shown.map((e, i) => (
            <li key={e.jobId} className={i > 0 ? '-ml-2.5' : ''}>
              <Link
                to={`/analysis/${e.jobId}`}
                aria-label={`Open ${e.filename}`}
                title={e.filename}
                className="block rounded-full shadow-[0_0_0_2px_rgb(255_255_255/0.55)] transition-transform duration-200 hover:-translate-y-0.5"
              >
                <Thumb sha={e.sha256} blur={blur} className="size-11 rounded-full" />
              </Link>
            </li>
          ))}
          {more > 0 && (
            <li className="-ml-2.5">
              <Link
                to="/history"
                aria-label={`${more} more in History`}
                className="grid size-11 place-items-center rounded-full bg-[var(--knob-fill)] text-[13px] font-semibold shadow-[0_0_0_2px_rgb(255_255_255/0.55)]"
              >
                +{more}
              </Link>
            </li>
          )}
          {shown.length === 0 &&
            [0, 1, 2].map((i) => (
              <li key={i} className={`size-11 rounded-full border-[1.5px] border-dashed border-[var(--zone-edge)] ${i > 0 ? 'ml-1.5' : ''}`} aria-hidden />
            ))}
        </ul>
        <label className="flex shrink-0 items-center gap-2.5 text-[13px] text-muted">
          Blur
          <Switch checked={blur} onChange={(v) => setPref('blurPreviews', v)} label="Blur previews" />
        </label>
      </div>
    </section>
  )
}

const MODES: VerdictLabel[] = ['likely_ai_generated', 'edited', 'likely_authentic', 'inconclusive']

/**
 * The verdicts on a dial, after the reference's thermostat: the share of the period's verdicts
 * that landed on one outcome, its arc in that outcome's colour, and a row of round buttons below
 * (the reference's modes) to choose which outcome the dial shows.
 */
function VerdictDial({
  counts,
  known,
  span,
  waiting,
  className = '',
}: {
  counts: Record<VerdictLabel, number>
  known: number
  span: string
  waiting: boolean
  className?: string
}) {
  const [mode, setMode] = useState<VerdictLabel>('likely_ai_generated')
  const v = VERDICTS[mode]
  const count = counts[mode]
  const share = known ? count / known : 0
  const pct = Math.round(share * 100)
  return (
    <section aria-labelledby="dial-title" className={`panel flex flex-col rounded-[28px] p-5 sm:p-6 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="dial-title" className="card-title">
            Verdicts
          </h2>
          <p className="label mt-0.5">{waiting ? 'Loading verdicts…' : known ? `${known} ${plural(known, 'verdict')} ${span}` : `No verdicts ${span}`}</p>
        </div>
        <Link to={`/history?filter=${mode}`} className="icon-btn size-10" aria-label={`Open ${v.short} in History`} title={`${v.short} in History`}>
          <ArrowUpRight className="size-[18px]" strokeWidth={1.7} />
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center py-6 @5xl:py-8">
        <Dial
          share={share}
          color={v.dot}
          figure={known && !waiting ? String(pct) : '–'}
          name={v.short}
          detail={known && !waiting ? `${count} of ${known}` : ''}
          label={known ? `${pct}% ${v.short}: ${count} of ${known} ${plural(known, 'verdict')} ${span}` : `No verdicts ${span}`}
        />
      </div>

      <p className="label mb-3">Show on the dial</p>
      <div role="group" aria-label="Verdict on the dial" className="flex items-start justify-between gap-2">
        {MODES.map((m) => {
          const { short, icon: Icon } = VERDICTS[m]
          const on = m === mode
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => setMode(m)} className="group flex min-w-0 flex-col items-center gap-2 rounded-[18px] outline-offset-4">
              <span
                className={`grid size-[52px] place-items-center rounded-full transition duration-200 group-active:scale-95 ${
                  on ? 'bg-white text-on-light shadow-[0_10px_22px_-12px_rgb(0_0_0/0.6)]' : 'bg-[var(--btn-bg)] text-ink shadow-[var(--btn-edge)] group-hover:bg-[var(--btn-hover)]'
                }`}
              >
                <Icon className="size-[22px]" strokeWidth={1.7} aria-hidden />
              </span>
              <span className="flex flex-col items-center leading-tight">
                <span className={`text-[12.5px] font-medium whitespace-nowrap ${on ? 'text-ink' : 'text-muted'}`}>{short}</span>
                <span className="mt-0.5 text-[12px] text-faint tabular-nums">{waiting ? '–' : counts[m]}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** A ring with ticks, the share drawn as an arc from the top clockwise, and a knob where it ends. */
function Dial({ share, color, figure, name, detail, label }: { share: number; color: string; figure: string; name: string; detail: string; label: string }) {
  const C = 120
  const R = 100
  return (
    <div className="relative aspect-square w-full max-w-[240px] @md:max-w-[300px] @5xl:max-w-[372px]" role="img" aria-label={label}>
      <svg viewBox="0 0 240 240" className="size-full overflow-visible" aria-hidden>
        <circle cx={C} cy={C} r={114} fill="rgb(255 255 255 / 0.035)" />
        <circle cx={C} cy={C} r={R} fill="none" stroke="var(--track-bg)" strokeWidth={16} />
        {Array.from({ length: 60 }, (_, i) => {
          const a = ((i * 6 - 90) * Math.PI) / 180
          const inner = i % 5 === 0 ? 72 : 75
          return (
            <line
              key={i}
              x1={C + inner * Math.cos(a)}
              y1={C + inner * Math.sin(a)}
              x2={C + 81 * Math.cos(a)}
              y2={C + 81 * Math.sin(a)}
              stroke="rgb(255 255 255 / 0.32)"
              strokeWidth={1.4}
              strokeLinecap="round"
            />
          )
        })}
        <g transform={`rotate(-90 ${C} ${C})`}>
          <circle
            cx={C}
            cy={C}
            r={R}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={`${share} 1`}
            className="dial-arc animate-draw"
            style={{ strokeDashoffset: 0, opacity: share > 0 ? 1 : 0 }}
          />
        </g>
        <g className="dial-knob" style={{ transform: `rotate(${share * 360}deg)` }}>
          <circle cx={C} cy={C - R} r={11} fill="var(--knob-fill)" stroke={color} strokeWidth={4} />
        </g>
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <span>
          <span className="block text-[54px] leading-none font-normal tracking-[-0.045em]">
            {figure}
            {figure !== '–' && <span className="ml-0.5 align-top text-[24px] text-faint">%</span>}
          </span>
          <span className="mt-2 block text-[14px] text-muted">{name}</span>
          {detail && <span className="mt-0.5 block text-[12.5px] text-faint tabular-nums">{detail}</span>}
        </span>
      </div>
    </div>
  )
}

/** "14:05", "Yesterday", "Tue" or "12 Oct": when, in as few characters as will do. */
function shortWhen(iso: string, now: Date) {
  const d = new Date(iso)
  const days = Math.round((midnight(now).getTime() - midnight(d).getTime()) / 86_400_000)
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'short' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The latest verdict in large type, like the reference's temperature, with the file and when it
 * was analyzed under it; below, the last few verdicts as points on a line (higher is closer to
 * AI-generated) over a row naming each, the way the reference forecasts the next hours.
 */
function Latest({ done, data, span, waiting, example, now }: { done: HistoryEntry[]; data: Data; span: string; waiting: boolean; example: Job | null; now: Date }) {
  const latest = done[0]
  if (!latest) {
    const v = example?.verdict ? VERDICTS[example.verdict.label] : null
    return (
      <section aria-labelledby="latest-title" className="panel @container flex flex-col rounded-[28px] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="latest-title" className="label">
              {example ? 'Example report' : 'Latest analysis'}
            </h2>
            <p className="mt-1.5 text-[38px] leading-none font-normal tracking-[-0.035em] @lg:text-[48px]">
              {waiting ? <span className="skeleton block h-10 w-48" /> : example ? (v?.short ?? 'Example') : `Nothing ${span}`}
            </p>
            <p className="mt-2.5 text-[13.5px] text-muted">
              {example ? 'A FLUX image the detector never saw' : waiting ? 'Loading verdicts…' : 'Analyze an image to see its verdict here.'}
            </p>
          </div>
          <Link to={example ? DEMO_REPORT_PATH : '/new'} className="btn-ghost btn-sm shrink-0 max-[420px]:hidden">
            {example ? 'Open example' : 'Analyze'} <ArrowUpRight className="size-4" strokeWidth={1.8} />
          </Link>
        </div>
        <div className="mt-6 flex h-[76px] items-center justify-center rounded-[18px] border-[1.5px] border-dashed border-[var(--zone-edge)] px-4 text-center text-[13px] text-faint">
          Your verdicts will line up here, newest on the right.
        </div>
      </section>
    )
  }

  const label = data[latest.jobId].label!
  const trail = done.slice(0, 5).reverse()
  return (
    <section aria-labelledby="latest-title" className="panel @container flex flex-col overflow-hidden rounded-[28px] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="latest-title" className="label">
            Latest analysis
          </h2>
          <p className="mt-1.5 flex items-center gap-3 text-[38px] leading-none font-normal tracking-[-0.035em] @lg:text-[48px]">
            <VerdictDot label={label} className="size-3 @lg:size-3.5" />
            {VERDICTS[label].short}
          </p>
          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-[13.5px] text-muted">
            <ImageIcon className="size-4 shrink-0" strokeWidth={1.6} aria-hidden />
            <FileName name={latest.filename} />
            <span aria-hidden>·</span>
            <span className="shrink-0">{formatWhen(latest.uploadedAt)}</span>
          </p>
        </div>
        <Link to={`/analysis/${latest.jobId}`} className="btn-ghost btn-sm shrink-0 max-[420px]:hidden">
          Open report <ArrowUpRight className="size-4" strokeWidth={1.8} />
        </Link>
      </div>
      <Trail items={trail} data={data} now={now} />
    </section>
  )
}

// Where each verdict sits on the line, from the top: AI-generated highest, authentic lowest.
const LEVEL: Record<VerdictLabel, number> = { likely_ai_generated: 0.14, edited: 0.38, inconclusive: 0.62, likely_authentic: 0.86 }
const TRAIL_H = 76

/** A smooth path through the points that never overshoots them (monotone cubic). */
function smoothPath(pts: { x: number; y: number }[]) {
  const n = pts.length
  const slope = pts.slice(0, -1).map((p, i) => (pts[i + 1].y - p.y) / (pts[i + 1].x - p.x))
  const tangent = pts.map((_, i) => (i === 0 ? slope[0] : i === n - 1 ? slope[n - 2] : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0
      tangent[i + 1] = 0
      continue
    }
    const a = tangent[i] / slope[i]
    const b = tangent[i + 1] / slope[i]
    if (a * a + b * b > 9) {
      const k = 3 / Math.hypot(a, b)
      tangent[i] = k * a * slope[i]
      tangent[i + 1] = k * b * slope[i]
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = (pts[i + 1].x - pts[i].x) / 3
    d += ` C${pts[i].x + h},${pts[i].y + h * tangent[i]} ${pts[i + 1].x - h},${pts[i + 1].y - h * tangent[i + 1]} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

function Trail({ items, data, now }: { items: HistoryEntry[]; data: Data; now: Date }) {
  const n = items.length
  const pts = items.map((e, i) => ({ x: ((i + 0.5) / n) * 100, y: LEVEL[data[e.jobId].label!] * TRAIL_H }))
  // run the line on past the first and last points to the card's edges, as the reference does
  const path = smoothPath([{ x: -12, y: pts[0].y }, ...pts, { x: 112, y: pts[n - 1].y }])
  return (
    <div className="mt-5">
      <p className="label">
        {n === 1 ? 'Your first verdict' : `Your last ${n} verdicts`}, higher is closer to AI-generated
      </p>
      <div className="relative mt-2" style={{ height: TRAIL_H }} aria-hidden>
        <svg viewBox={`0 0 100 ${TRAIL_H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <path d={path} fill="none" stroke="rgb(255 255 255 / 0.8)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pts.map((p, i) => {
          const last = i === n - 1
          const dot = VERDICTS[data[items[i].jobId].label!].dot
          return (
            <span
              key={items[i].jobId}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${last ? 'size-4 bg-white' : 'size-2.5'}`}
              style={{
                left: `${p.x}%`,
                top: p.y,
                background: last ? undefined : dot,
                boxShadow: last ? `inset 0 0 0 4px ${dot}, 0 0 0 2px var(--knob-fill)` : '0 0 0 2px var(--knob-fill)',
              }}
            />
          )
        })}
      </div>
      <ol className="mt-3 grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {items.map((e, i) => {
          const { short, dot, icon: Icon } = VERDICTS[data[e.jobId].label!]
          return (
            <li key={e.jobId} className="min-w-0">
              <Link to={`/analysis/${e.jobId}`} className="flex flex-col items-center gap-1 rounded-[14px] px-1 py-1.5 text-center transition-colors hover:bg-[var(--row-bg)]">
                <span className="flex max-w-full items-center gap-1.5">
                  <Icon className="size-4 shrink-0" style={{ color: dot }} strokeWidth={1.9} aria-hidden />
                  <span className="sr-only">{e.filename}: </span>
                  <span className={`truncate text-[13px] font-medium @max-[40rem]:sr-only ${i === n - 1 ? 'text-ink' : 'text-muted'}`}>{short}</span>
                </span>
                <span className="text-[12px] whitespace-nowrap text-faint">{shortWhen(e.uploadedAt, now)}</span>
              </Link>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * The last flagged and the last authentic image, after the reference's door cards: the state in
 * small type, the name in two lines, the picture on the right, and a slide-to-open pill.
 */
function Spotlight({
  kind,
  entry,
  data,
  blur,
  span,
  example = null,
}: {
  kind: 'flagged' | 'authentic'
  entry?: HistoryEntry
  data: Data
  blur: boolean
  span: string
  example?: Job | null
}) {
  const words: [string, string] = kind === 'flagged' ? ['Last', 'flagged'] : ['Last', 'authentic']
  if (entry) {
    const label = data[entry.jobId].label!
    const v = VERDICTS[label]
    return (
      <SpotCard
        to={`/analysis/${entry.jobId}`}
        name={`${words.join(' ')}: ${v.short}, ${entry.filename}. Open the report`}
        status={
          <>
            <VerdictDot label={label} /> {v.short}
          </>
        }
        words={words}
        picture={<Thumb sha={entry.sha256} blur={blur} className="size-full" />}
      />
    )
  }
  if (kind === 'flagged' && example) {
    const label = example.verdict?.label
    return (
      <SpotCard
        to={DEMO_REPORT_PATH}
        name={`Example report${label ? `: ${VERDICTS[label].short}` : ''}. Open it`}
        status={label ? <><VerdictDot label={label} /> {VERDICTS[label].short}</> : 'An example'}
        words={['Example', 'report']}
        picture={<Thumb sha={DEMO_SHA} className="size-full" />}
      />
    )
  }
  if (kind === 'authentic') {
    return (
      <SpotCard
        to="/method"
        name={`${words.join(' ')}: none ${span}. How verdicts are reached`}
        status={`None ${span}`}
        words={words}
        note="Authentic needs proof, such as Content Credentials."
        picture={<Placeholder icon={CircleCheck} />}
      />
    )
  }
  return (
    <div className="panel relative flex min-h-[200px] overflow-hidden rounded-[28px] p-5">
      <span className="relative flex min-w-0 flex-1 flex-col pr-[46%]">
        <span className="text-[12.5px] text-muted">Nothing flagged {span}</span>
        <span className="mt-1.5 text-[22px] leading-[1.15] font-medium tracking-[-0.015em]">
          {words[0]}
          <br />
          {words[1]}
        </span>
        <span className="mt-auto text-[13px] text-faint">No image was edited or AI-generated.</span>
      </span>
      <span className="absolute top-4 right-4 bottom-4 w-[36%] overflow-hidden rounded-[20px]">
        <Placeholder icon={ShieldCheck} />
      </span>
    </div>
  )
}

function Placeholder({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="grid size-full place-items-center rounded-[20px] border-[1.5px] border-dashed border-[var(--zone-edge)] text-faint" aria-hidden>
      <Icon className="size-7" strokeWidth={1.4} />
    </span>
  )
}

function SpotCard({
  to,
  name,
  status,
  words,
  note,
  picture,
}: {
  to: string
  name: string
  status: ReactNode
  words: [string, string]
  note?: string
  picture: ReactNode
}) {
  return (
    <Link to={to} aria-label={name} className="panel group relative flex min-h-[200px] overflow-hidden rounded-[28px] p-5">
      <span className="relative flex min-w-0 flex-1 flex-col pr-[46%]">
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted">{status}</span>
        <span className="mt-1.5 text-[22px] leading-[1.15] font-medium tracking-[-0.015em]">
          {words[0]}
          <br />
          {words[1]}
        </span>
        {note && <span className="mt-2 text-[12.5px] leading-snug text-faint">{note}</span>}
        {/* the reference's slide-to-unlock: on hover the white knob runs to the end of its track. Its
            carrier is the track's width less the knob's, so moving the carrier by its own width
            lands the knob at the end on any card. */}
        <span className="relative mt-auto block h-11 w-full max-w-[118px] shrink-0 rounded-full bg-[var(--btn-bg)] shadow-[var(--btn-edge)]" aria-hidden>
          <span className="absolute top-1 right-10 bottom-1 left-1 transition-transform duration-300 ease-(--ease-drawer) group-hover:translate-x-full">
            <span className="grid size-9 place-items-center rounded-full bg-white text-on-light shadow-[0_4px_10px_-4px_rgb(0_0_0/0.5)]">
              <ArrowRight className="size-4" strokeWidth={2.2} />
            </span>
          </span>
          <span className="absolute inset-y-0 left-12 flex items-center text-ink transition-opacity duration-200 group-hover:opacity-0">
            <ChevronRight className="-mr-1.5 size-4 opacity-80" strokeWidth={2} />
            <ChevronRight className="-mr-1.5 size-4 opacity-50" strokeWidth={2} />
            <ChevronRight className="size-4 opacity-25" strokeWidth={2} />
          </span>
        </span>
      </span>
      <span className="absolute top-4 right-4 bottom-4 w-[36%] overflow-hidden rounded-[20px] shadow-[0_14px_28px_-16px_rgb(0_0_0/0.7)]">{picture}</span>
    </Link>
  )
}

type Bucket = { label: string; long: string; count: number; flagged: number; future: boolean }

/** The period cut into bars: this week by day, this month by week, all time by month. */
function bucketize(entries: HistoryEntry[], data: Data, period: Period, now: Date) {
  const list: Bucket[] = []
  let place: (d: Date) => number
  let current: number
  let unit: string
  if (period === 'week') {
    const monday = periodStart('week', now)!
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
      list.push({
        label: d.toLocaleDateString(undefined, { weekday: 'short' }),
        long: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
        count: 0,
        flagged: 0,
        future: d > now,
      })
    }
    place = (d) => Math.round((midnight(d).getTime() - monday.getTime()) / 86_400_000)
    current = (now.getDay() + 6) % 7
    unit = 'per day'
  } else if (period === 'month') {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    const month = now.toLocaleDateString(undefined, { month: 'long' })
    for (let from = 1; from <= days; from += 7) {
      const to = Math.min(from + 6, days)
      list.push({ label: `${from}–${to}`, long: `${month} ${from}–${to}`, count: 0, flagged: 0, future: from > now.getDate() })
    }
    place = (d) => Math.floor((d.getDate() - 1) / 7)
    current = Math.floor((now.getDate() - 1) / 7)
    unit = 'per week'
  } else {
    // back to the oldest analysis kept, at least six months and at most twelve
    const oldest = entries.length ? new Date(entries[entries.length - 1].uploadedAt) : now
    const back = Math.min(11, Math.max(5, (now.getFullYear() - oldest.getFullYear()) * 12 + now.getMonth() - oldest.getMonth()))
    const first = new Date(now.getFullYear(), now.getMonth() - back, 1)
    for (let i = 0; i <= back; i++) {
      const d = new Date(first.getFullYear(), first.getMonth() + i, 1)
      list.push({
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        long: d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
        count: 0,
        flagged: 0,
        future: false,
      })
    }
    place = (d) => (d.getFullYear() - first.getFullYear()) * 12 + d.getMonth() - first.getMonth()
    current = back
    unit = 'per month'
  }
  for (const e of entries) {
    const b = list[place(new Date(e.uploadedAt))]
    if (!b) continue
    b.count += 1
    if (isFlagged(data[e.jobId]?.label)) b.flagged += 1
  }
  return { list, current, unit }
}

/** Round the axis up to a clean top with at most four steps, and never less than 0–4. */
function axis(max: number) {
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => Math.ceil(max / s) <= 4) ?? 1000
  const n = Math.max(Math.ceil(max / step), step === 1 ? 4 : 1)
  return { top: n * step, ticks: Array.from({ length: n + 1 }, (_, i) => i * step) }
}

/**
 * The analyses over the period as bars, after the reference's energy chart: muted glass columns
 * with the one in focus in lime and its count in a bubble above it. The current day, week or month
 * is in focus until another is pointed at, tapped or reached with the arrow keys. A table carries
 * the same numbers for screen readers.
 */
function Activity({ entries, data, period, now, className = '' }: { entries: HistoryEntry[]; data: Data; period: Period; now: Date; className?: string }) {
  const { list, current, unit } = useMemo(() => bucketize(entries, data, period, now), [entries, data, period, now])
  const [picked, setPicked] = useState<{ period: Period; at: number } | null>(null)
  const at = picked?.period === period ? Math.min(picked.at, list.length - 1) : current
  const shown = list[at]
  const { top, ticks } = axis(Math.max(...list.map((b) => b.count)))
  const total = list.reduce((n, b) => n + b.count, 0)
  const flagged = list.reduce((n, b) => n + b.flagged, 0)
  const pick = (i: number) => setPicked({ period, at: i })

  const onKey = (e: KeyboardEvent) => {
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null
    if (to === null) return
    e.preventDefault()
    pick(Math.max(0, Math.min(list.length - 1, to)))
  }

  return (
    <section aria-labelledby="activity-title" className={`panel @container flex flex-col rounded-[28px] p-5 sm:p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="activity-title" className="card-title">
            Analyses {unit}
          </h2>
          <p className="label mt-0.5" aria-live="polite">
            {shown.long}: {shown.count} {plural(shown.count, 'analysis', 'analyses')}
            {shown.flagged > 0 && `, ${shown.flagged} flagged`}
          </p>
        </div>
        <p className="flex items-baseline gap-2">
          <span className="text-[28px] leading-none tracking-[-0.03em]">{total}</span>
          <span className="label">
            in all, {flagged} flagged
          </span>
        </p>
      </div>

      <div className="mt-5 grid min-h-[190px] flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(150px,1fr)_auto] gap-x-3 gap-y-2">
        <div className="relative w-6 text-right text-[12px] text-faint tabular-nums" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / top) * 100}%` }}>
              {t}
            </span>
          ))}
        </div>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Analyses ${unit}. Use the left and right arrow keys to read each bar.`}
          onKeyDown={onKey}
          onPointerLeave={(e) => e.pointerType === 'mouse' && setPicked(null)}
          className="relative rounded-[10px] outline-offset-4"
        >
          {ticks.map((t) => (
            <span key={t} className="absolute inset-x-0 h-px bg-[var(--color-line)]" style={{ bottom: `${(t / top) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end gap-1.5" aria-hidden>
            {list.map((b, i) => {
              const h = (b.count / top) * 100
              const on = i === at
              return (
                <div
                  key={i}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                  onPointerEnter={(e) => e.pointerType === 'mouse' && pick(i)}
                  onClick={() => pick(i)}
                >
                  {!b.future && (
                    <span
                      className={`animate-lift block w-full max-w-[34px] origin-bottom rounded-[10px] transition-[height,background-color] duration-500 ease-(--ease-out) ${on ? 'bg-primary' : 'bg-[var(--bar-bg)]'}`}
                      style={{ height: `max(${h}%, 4px)`, animationDelay: `${i * 40}ms` }}
                    />
                  )}
                  {on && !b.future && (
                    <span
                      className="raise absolute left-1/2 z-10 -translate-x-1/2 rounded-full px-2.5 py-1 text-[12.5px] font-semibold tabular-nums"
                      style={{ bottom: `calc(max(${h}%, 4px) + 8px)` }}
                    >
                      {b.count}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {total === 0 && (
            <p className="absolute inset-x-0 top-1/3 text-center text-[13px] text-faint" aria-hidden>
              No analyses {PERIODS.find((p) => p.key === period)!.span}
            </p>
          )}
        </div>
        <span aria-hidden />
        <div className="flex gap-1.5 text-[12px] text-faint" aria-hidden>
          {list.map((b, i) => (
            <span
              key={i}
              className={`min-w-0 flex-1 text-center whitespace-nowrap ${i === at ? 'text-ink' : ''} ${b.future ? 'opacity-60' : ''} ${
                list.length > 7 && i % 2 !== (list.length - 1) % 2 && i !== at ? '@max-xl:invisible' : ''
              }`}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      <table className="sr-only">
        <caption>Analyses {unit}</caption>
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col" className="text-right">
              Analyses
            </th>
            <th scope="col" className="text-right">
              Flagged
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((b, i) => (
            <tr key={i}>
              <th scope="row">{b.long}</th>
              <td className="text-right tabular-nums">{b.count}</td>
              <td className="text-right tabular-nums">{b.flagged}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
