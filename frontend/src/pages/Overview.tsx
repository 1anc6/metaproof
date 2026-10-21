import { ArrowUpRight, EyeOff, Filter, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { JobSummary, VerdictLabel } from '../lib/api'
import { formatWhen } from '../lib/format'
import type { HistoryEntry } from '../lib/history'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { VERDICTS } from '../lib/verdicts'
import { Chip, FileName, Ruler, Thumb, VerdictBadge } from '../components/ui'

const CHECKS = ['Metadata', 'File structure', 'Content Credentials', 'Invisible watermark', 'AI detector', 'Seen-before search']

export function Overview() {
  const history = useHistory()
  const { data, loading } = useSummaries(history.slice(0, 50))
  const n = (value: number) => (loading ? null : value)

  const counts = Object.values(data).reduce(
    (acc, s) => {
      if (s.label) acc[s.label] += 1
      return acc
    },
    { likely_authentic: 0, edited: 0, likely_ai_generated: 0, inconclusive: 0 } as Record<VerdictLabel, number>,
  )
  const flagged = counts.edited + counts.likely_ai_generated
  const prefs = usePrefs()
  const isFlagged = (jobId: string) => {
    const label = data[jobId]?.label
    return label === 'edited' || label === 'likely_ai_generated'
  }
  const recent = (prefs.onlyFlagged ? history.filter((e) => isFlagged(e.jobId)) : history).slice(0, 4)
  const latest = history.find((e) => data[e.jobId]?.status === 'done' && data[e.jobId]?.label)

  return (
    <div className="flex flex-col gap-8">
      <header className="animate-rise flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-2xl">
          <h1 className="text-[36px] leading-[1.04] font-normal tracking-[-0.04em] sm:text-[48px]">
            See what's behind the image
          </h1>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-muted">
            MetaProof reads an image's metadata, Content Credentials and pixels, then tells you what the
            evidence shows, and when it isn't enough to say anything.
          </p>
        </div>
        <Link to="/new" className="btn-primary h-12 px-6">
          <Plus className="size-4" strokeWidth={2.5} /> New analysis
        </Link>
      </header>

      {/* This browser's analyses: four counts in dot-matrix, then each analysis on a timeline. */}
      {history.length > 0 && (
        <section className="animate-rise flex flex-col gap-5" aria-label="Your analyses">
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <DotStat to="/history" value={history.length} label="Total" highlight />
            <DotStat to="/history?filter=flagged" value={n(flagged)} label="Flagged" tone={flagged ? 'text-edited' : undefined} />
            <DotStat to="/history?filter=likely_ai_generated" value={n(counts.likely_ai_generated)} label="Likely AI" tone={counts.likely_ai_generated ? 'text-ai' : undefined} />
            <DotStat to="/history?filter=inconclusive" value={n(counts.inconclusive)} label="Inconclusive" />
          </div>
          <Timeline entries={history} data={data} />
        </section>
      )}

      <section className="animate-rise grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,300px)]">
        {latest ? (
          <ScoreCard
            to={`/analysis/${latest.jobId}`}
            label="Latest analysis"
            verdict={data[latest.jobId].label!}
            pct={data[latest.jobId].confidence}
            caption="verdict confidence"
            name={latest.filename}
          />
        ) : (
          // The example's figures mirror the stored demo report (lib/demo.ts).
          <ScoreCard to={DEMO_REPORT_PATH} label="Example report" verdict="likely_ai_generated" pct={0.99} caption="AI likelihood, pixel detector" />
        )}
        <UploadCard />
        <ChecksCard />
      </section>

      <section className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-[24px] font-normal tracking-[-0.03em]">Recent analyses</h2>
            <p className="mt-1 text-[14px] text-muted">What this browser analyzed most recently.</p>
          </div>
          {history.length > 0 && (
            <Link to="/history" className="btn-ghost h-10 px-4 text-[14px]">
              See all
            </Link>
          )}
        </div>
        {history.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Chip icon={EyeOff} label="Blur previews" checked={prefs.blurPreviews} onChange={(v) => setPref('blurPreviews', v)} />
            <Chip icon={Filter} label="Only flagged" checked={prefs.onlyFlagged} onChange={(v) => setPref('onlyFlagged', v)} />
          </div>
        )}
        {history.length === 0 ? (
          <EmptyRecent />
        ) : recent.length === 0 ? (
          <p className="mt-4 text-[15px] text-muted">
            {loading ? 'Loading verdicts…' : 'Nothing edited or AI-generated among your analyses.'}
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {recent.map((entry) => {
              const s = data[entry.jobId]
              return (
                <li key={entry.jobId} className="min-w-0">
                  <Link to={`/analysis/${entry.jobId}`} className="panel flex h-full flex-col rounded-xl p-2.5 sm:p-3">
                    <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="aspect-[4/3] w-full rounded-lg" />
                    <FileName name={entry.filename} className="mt-3 px-1 text-[14px] font-semibold" />
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1">
                      {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}
                      <span className="truncate text-[12px] text-faint">{formatWhen(entry.uploadedAt)}</span>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

/** A count in dot-matrix with its label beside it; the first one carries the lime tag. */
function DotStat({ to, value, label, highlight, tone }: { to: string; value: number | null; label: string; highlight?: boolean; tone?: string }) {
  return (
    <Link to={to} className="group flex min-w-0 items-start gap-2 rounded-lg">
      {value === null ? (
        <span className="skeleton mt-2 h-10 w-14" />
      ) : (
        <span className={`dot-num text-[52px] sm:text-[60px] ${tone ?? 'text-ink'} transition-opacity group-hover:opacity-70`}>{value}</span>
      )}
      <span className={highlight ? 'tag-hi mt-1' : 'mt-1 rounded-full bg-raised px-2 py-0.5 text-[11px] leading-4 font-semibold text-muted'}>
        {label}
      </span>
    </Link>
  )
}

/**
 * Every analysis on one time axis, oldest at the left and now at the right, each a tick in its
 * verdict's colour over a faint scale. Pending or unknown verdicts are grey.
 */
function Timeline({ entries, data }: { entries: HistoryEntry[]; data: Record<string, JobSummary> }) {
  const [now] = useState(() => Date.now()) // fixed at mount, so renders stay stable
  const times = entries.map((e) => new Date(e.uploadedAt).getTime())
  const start = Math.min(...times, now - 24 * 3600_000)
  const span = Math.max(now - start, 1)
  const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (
    <div className="panel relative rounded-full px-6 pt-5 pb-3 sm:px-8">
      <div className="relative h-8" aria-hidden>
        {/* the scale */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between">
          {Array.from({ length: 61 }, (_, i) => (
            <span key={i} className={`w-px rounded-full ${i % 10 === 0 ? 'h-4 bg-line-strong' : 'h-2 bg-line-strong/60'}`} />
          ))}
        </div>
        {/* one tick per analysis */}
        {entries.map((e, i) => {
          const label = data[e.jobId]?.label
          const color = label ? VERDICTS[label].color : 'var(--color-line-strong)'
          return (
            <span
              key={e.jobId}
              className="absolute bottom-0 h-7 w-[3px] -translate-x-1/2 rounded-full"
              style={{ left: `${((times[i] - start) / span) * 100}%`, background: color }}
              title={`${e.filename} · ${label ? VERDICTS[label].short : 'pending'}`}
            />
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[12px] font-medium text-faint">
        <span>{fmt(start)}</span>
        <span>Today</span>
      </div>
      <p className="sr-only">
        {entries.length} analyses between {fmt(start)} and today.
      </p>
    </div>
  )
}

/** A verdict on its own colour field, with its figure in dot-matrix and a 0-100 ruler under it. */
function ScoreCard({
  to,
  label,
  verdict,
  pct,
  caption,
  name,
}: {
  to: string
  label: string
  verdict: VerdictLabel
  pct: number | null
  caption: string
  name?: string
}) {
  const v = VERDICTS[verdict]
  const value = pct === null ? null : Math.round(pct * 100)
  return (
    <Link to={to} className={`mesh ${v.mesh} group flex min-h-[280px] flex-col rounded-xl p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-white/90">{label}</p>
          {name && <FileName name={name} className="text-[13px] text-white/80" />}
        </div>
        <span className="frost grid size-9 shrink-0 place-items-center rounded-full">
          <ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </span>
      </div>
      <div className="my-auto py-4 text-center">
        {value !== null && <p className="dot-num text-[80px] text-white sm:text-[92px]">{value}</p>}
        <p className="mt-3 text-[17px] font-semibold">{v.title}</p>
        {value !== null && <p className="text-[13px] text-white/85">{value}% {caption}</p>}
      </div>
      {value !== null && <Ruler value={value} />}
    </Link>
  )
}

function UploadCard() {
  return (
    <Link to="/new" className="panel group flex flex-col gap-6 rounded-xl p-5 sm:p-6 md:min-h-[280px]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[17px] leading-snug font-medium tracking-[-0.01em]">
          Upload an
          <br />
          image to check
        </p>
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-transform group-hover:scale-105">
          <Plus className="size-4" strokeWidth={2.5} />
        </span>
      </div>
      <div className="mt-auto">
        <p className="text-[14px] text-muted">JPEG, PNG, WebP, TIFF or HEIC, up to 25 MB.</p>
        <p className="mt-3 rounded-lg bg-raised px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          The file is deleted as soon as it's analyzed. Only its hash, a thumbnail and the findings are kept.
        </p>
      </div>
    </Link>
  )
}

function ChecksCard() {
  return (
    <section className="panel flex flex-col rounded-xl p-5 sm:p-6 md:col-span-2 xl:col-span-1">
      <h2 className="text-[17px] font-medium tracking-[-0.01em]">Six checks on every image</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {CHECKS.map((name) => (
          <li key={name} className="rounded-full bg-raised px-3 py-1.5 text-[13px] font-medium text-ink">
            {name}
          </li>
        ))}
      </ul>
      <Link to="/method" className="btn-ghost mt-auto h-10 self-start px-4 text-[14px] max-xl:mt-5">
        How it works
      </Link>
    </section>
  )
}

function EmptyRecent() {
  return (
    <div className="panel mt-4 rounded-xl px-6 py-8">
      <p className="text-[15px] font-semibold">No analyses yet</p>
      <p className="mt-1 max-w-sm text-[15px] text-muted">
        Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
      </p>
      <Link to="/new" className="btn-primary mt-5">
        <Plus className="size-4" strokeWidth={2.5} /> Analyze an image
      </Link>
    </div>
  )
}
