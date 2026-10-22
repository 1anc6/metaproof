import { ArrowRight, EyeOff, Filter } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory, type HistoryEntry } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { VERDICTS } from '../lib/verdicts'
import { Chip, FileName, Thumb, VerdictBadge } from '../components/ui'
import { CheckDial, type CanvasPhoto } from '../components/CheckDial'
import { UploadPanel } from '../components/UploadPanel'
import { VerdictGlyph, VerdictSpectrum } from '../components/Verdict'
import { CHECKS } from '../lib/checks'

/**
 * The workspace: opening the app shows the tool. The dial and its canvas, then (once something is
 * analyzed) the latest verdict, then the upload panel; beside them on a desktop, below on a phone,
 * the chosen check, the counts and the recent list, all compact so the image and verdict lead.
 */
export function Overview() {
  const history = useHistory()
  const { data, loading } = useSummaries(history.slice(0, 50))
  const prefs = usePrefs()
  const [active, setActive] = useState('c2pa')

  const counts = Object.values(data).reduce(
    (acc, s) => {
      if (s.label) acc[s.label] += 1
      return acc
    },
    { likely_authentic: 0, edited: 0, likely_ai_generated: 0, inconclusive: 0 } as Record<VerdictLabel, number>,
  )
  const isFlagged = (jobId: string) => {
    const label = data[jobId]?.label
    return label === 'edited' || label === 'likely_ai_generated'
  }
  const recent = (prefs.onlyFlagged ? history.filter((e) => isFlagged(e.jobId)) : history).slice(0, 5)
  const latest = history.find((e) => data[e.jobId]?.status === 'done' && data[e.jobId]?.label)
  const photo: CanvasPhoto | undefined = latest && {
    sha: latest.sha256,
    name: latest.filename,
    label: data[latest.jobId].label,
    status: data[latest.jobId].status,
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)] lg:items-start lg:gap-x-8">
      <h1 className="sr-only">MetaProof: see what's behind an image</h1>

      {/* the workspace */}
      <div className="flex min-w-0 flex-col gap-3">
        <h2 className="sr-only">The six checks</h2>
        <CheckDial active={active} onSelect={setActive} photo={photo} className="max-w-none" />
        {latest && (
          <LatestVerdict
            entry={latest}
            label={data[latest.jobId].label!}
            facts={[`${data[latest.jobId].width}×${data[latest.jobId].height}`, formatBytes(latest.sizeBytes), formatWhen(latest.uploadedAt)]}
          />
        )}
        <UploadPanel />
      </div>

      {/* beside it */}
      <div className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6 lg:pt-[42px]">
        <CheckPanel active={active} />
        {history.length > 0 && <Counts total={history.length} counts={counts} loading={loading} />}
        {history.length > 0 && (
          <Recent entries={recent} data={data} loading={loading} blur={prefs.blurPreviews} onlyFlagged={prefs.onlyFlagged} />
        )}
      </div>
    </div>
  )
}

/** The latest analysis as its verdict: the outcome in the serif, its place on the scale, and one sentence. */
function LatestVerdict({ entry, label, facts }: { entry: HistoryEntry; label: VerdictLabel; facts: string[] }) {
  const v = VERDICTS[label]
  return (
    <Link to={`/analysis/${entry.jobId}`} className="panel group block rounded-xl p-4" aria-label={`Latest analysis: ${v.title}. Open the report`}>
      <div className="flex items-center gap-3">
        <VerdictGlyph label={label} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-faint">Latest analysis · {facts.join(' · ')}</p>
          <p className="display text-[26px] leading-tight" style={{ color: v.color }}>
            {v.title}
          </p>
        </div>
        <ArrowRight className="size-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5" aria-hidden />
      </div>
      <VerdictSpectrum label={label} className="mt-3" />
      <p className="mt-3 text-[14px] leading-relaxed text-muted">{v.summary}</p>
    </Link>
  )
}

/** The chosen check, explained in one compact panel. */
function CheckPanel({ active }: { active: string }) {
  const check = CHECKS.find((c) => c.key === active)!
  const Icon = check.icon
  return (
    <div className="panel rounded-xl p-4" aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-raised">
          <Icon className="size-4" strokeWidth={1.5} aria-hidden />
        </span>
        <h3 key={check.key} className="animate-rise min-w-0 flex-1 text-[15px] font-medium">
          {check.label}
        </h3>
        <span className="tag shrink-0">{check.weight}</span>
      </div>
      <p key={`${check.key}-d`} className="animate-rise mt-2 text-[14px] leading-relaxed text-muted [animation-delay:60ms]">
        {check.detail}
      </p>
    </div>
  )
}

/** The counts at a glance: four figures that open History filtered, over one thin bar of the verdict mix. */
function Counts({ total, counts, loading }: { total: number; counts: Record<VerdictLabel, number>; loading: boolean }) {
  const flagged = counts.edited + counts.likely_ai_generated
  const known = Object.values(counts).reduce((a, b) => a + b, 0)
  const stats: [string, string, number][] = [
    ['Total', '/history', total],
    ['Flagged', '/history?filter=flagged', flagged],
    ['Likely AI', '/history?filter=likely_ai_generated', counts.likely_ai_generated],
    ['Inconclusive', '/history?filter=inconclusive', counts.inconclusive],
  ]
  const MIX: [VerdictLabel, string][] = [
    ['likely_authentic', 'bg-authentic'],
    ['inconclusive', 'bg-neutral'],
    ['edited', 'bg-edited'],
    ['likely_ai_generated', 'bg-ai'],
  ]
  return (
    <section className="panel rounded-xl p-4" aria-label="Your analyses">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Your analyses</h2>
        <Link to="/history" className="text-[13px] text-faint transition hover:text-ink">
          Open history
        </Link>
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, to, value], i) => (
          <Link key={label} to={to} className="group flex min-w-0 items-baseline gap-2 rounded-lg bg-raised px-3 py-2 transition hover:bg-hover sm:block">
            {loading && i > 0 ? <span className="skeleton block h-6 w-8" /> : <span className="num block text-[24px] leading-none">{value}</span>}
            <span className="block truncate text-[12px] text-faint group-hover:text-ink sm:mt-1">{label}</span>
          </Link>
        ))}
      </div>
      {known > 0 && (
        <div className="mt-2.5 flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {MIX.filter(([k]) => counts[k] > 0).map(([k, bg]) => (
            <span key={k} className={`${bg} h-full rounded-full`} style={{ flexGrow: counts[k] }} title={`${VERDICTS[k].short}: ${counts[k]}`} />
          ))}
        </div>
      )}
    </section>
  )
}

/** The last few analyses as compact rows, with the blur and only-flagged switches. */
function Recent({
  entries,
  data,
  loading,
  blur,
  onlyFlagged,
}: {
  entries: HistoryEntry[]
  data: ReturnType<typeof useSummaries>['data']
  loading: boolean
  blur: boolean
  onlyFlagged: boolean
}) {
  return (
    <section className="panel rounded-xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Recent analyses</h2>
        <Link to="/history" className="text-[13px] text-faint transition hover:text-ink">
          See all
        </Link>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <Chip icon={EyeOff} label="Blur previews" checked={blur} onChange={(v) => setPref('blurPreviews', v)} />
        <Chip icon={Filter} label="Only flagged" checked={onlyFlagged} onChange={(v) => setPref('onlyFlagged', v)} />
      </div>
      {entries.length === 0 ? (
        <p className="mt-3 text-[14px] text-muted">{loading ? 'Loading verdicts…' : 'Nothing edited or AI-generated among your analyses.'}</p>
      ) : (
        <ul className="-mx-1.5 mt-2">
          {entries.map((entry) => {
            const s = data[entry.jobId]
            return (
              <li key={entry.jobId}>
                <Link to={`/analysis/${entry.jobId}`} className="flex items-center gap-3 rounded-lg px-1.5 py-1.5 transition hover:bg-hover">
                  <Thumb sha={entry.sha256} blur={blur} className="size-10 shrink-0 rounded-[10px]" />
                  <div className="min-w-0 flex-1">
                    <FileName name={entry.filename} className="text-[14px]" />
                    <div className="flex min-w-0 items-center gap-2">
                      {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}
                      <span className="truncate text-[12px] text-faint">{formatWhen(entry.uploadedAt)}</span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
