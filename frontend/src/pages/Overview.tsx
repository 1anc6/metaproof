import { ArrowUpRight, EyeOff, Filter, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { toneOf, VERDICTS } from '../lib/verdicts'
import { ArcGauge, Chip, FileName, Figure, LeaderRow, PanelTitle, RadialChecks, Thumb, VerdictBadge } from '../components/ui'
import { CHECKS, DEMO_SHA } from '../lib/checks'


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
  const counted = Math.min(history.length, 50) // verdicts are fetched for the 50 most recent

  return (
    <div className="flex flex-col gap-6 lg:gap-8">
      <section className="animate-rise grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <div>
            <h1 className="max-w-xl text-[40px] leading-[1.02] font-normal tracking-[-0.035em] sm:text-[56px]">
              See what's behind the image
            </h1>
            <p className="mt-4 max-w-lg text-[16px] leading-relaxed text-muted">
              MetaProof reads an image's metadata, Content Credentials and pixels, then tells you what the
              evidence shows, and when it isn't enough to say anything.
            </p>
          </div>
          <ChecksPanel />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {latest ? (
            <ResultCard
              to={`/analysis/${latest.jobId}`}
              title="Latest analysis"
              verdict={data[latest.jobId].label!}
              figures={[
                ['Confidence', data[latest.jobId].confidence === null ? '–' : Math.round(data[latest.jobId].confidence! * 100), '%'],
                ['Size', formatBytes(latest.sizeBytes).split(' ')[0], formatBytes(latest.sizeBytes).split(' ')[1]],
              ]}
              rows={[
                ['File', <FileName key="f" name={latest.filename} className="justify-end" />],
                ['Pixels', `${data[latest.jobId].width}×${data[latest.jobId].height}`],
                ['Analyzed', formatWhen(latest.uploadedAt)],
              ]}
            />
          ) : (
            // The example's figures mirror the stored demo report (lib/demo.ts).
            <ResultCard
              to={DEMO_REPORT_PATH}
              title="Example report"
              verdict="likely_ai_generated"
              figures={[
                ['AI likelihood', 99, '%'],
                ['Findings', 3, 'checks'],
              ]}
              rows={[
                ['Metadata', 'None found'],
                ['Credentials', 'None found'],
                ['Pixel detector', 'Strong signs of AI'],
              ]}
            />
          )}

          {history.length > 0 ? (
            <section className="panel rounded-xl p-5 sm:p-6" aria-label="Your analyses">
              <PanelTitle
                title="Your analyses"
                action={
                  <Link to="/history" className="well size-10" aria-label="Open history">
                    <ArrowUpRight className="size-4" strokeWidth={1.5} />
                  </Link>
                }
              />
              <div className="mt-2 text-ink">
                <ArcGauge value={counted ? flagged / counted : 0} valueLabel={loading ? '…' : `${flagged} flagged`} startLabel="0" endLabel={`${counted}`} />
              </div>
              <div className="mt-1 grid grid-cols-3 gap-3">
                <StatLink to="/history" label="Total" value={history.length} />
                <StatLink to="/history?filter=likely_ai_generated" label="Likely AI" value={n(counts.likely_ai_generated)} />
                <StatLink to="/history?filter=inconclusive" label="Inconclusive" value={n(counts.inconclusive)} />
              </div>
            </section>
          ) : (
            <UploadCard />
          )}
        </div>
      </section>

      <section className="animate-rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-[26px] font-normal tracking-[-0.02em]">Recent analyses</h2>
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
          <div className="panel mt-4 rounded-xl px-6 py-8">
            <p className="text-[17px]">No analyses yet</p>
            <p className="mt-1 max-w-sm text-[15px] text-muted">
              Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
            </p>
            <Link to="/new" className="btn-primary mt-5">
              <Plus className="size-4" strokeWidth={2} /> Analyze an image
            </Link>
          </div>
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
                  <Link to={`/analysis/${entry.jobId}`} className="panel flex h-full flex-col rounded-xl p-3">
                    <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="aspect-[4/3] w-full rounded-lg" />
                    <FileName name={entry.filename} className="mt-3 px-1 text-[14px]" />
                    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-1">
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

/**
 * The reference's monitoring home: a dark photo panel (the example image, blurred), the six checks
 * as a radial menu around a lemon lens, and a glass card that explains the chosen check.
 */
export function ChecksPanel({ className = '' }: { className?: string }) {
  const [active, setActive] = useState('c2pa')
  const check = CHECKS.find((c) => c.key === active)!
  return (
    <section className={`relative isolate overflow-hidden rounded-xl bg-[#2a2620] p-5 text-white sm:p-7 ${className}`} aria-label="The six checks">
      <Thumb sha={DEMO_SHA} eager className="!absolute inset-0 -z-10 scale-125 !bg-transparent opacity-80 blur-2xl brightness-[0.55]" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/10 via-transparent to-black/40" aria-hidden />
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] tracking-[0.02em] uppercase">Six checks</h2>
        <span className="status text-white/80">
          <span className="size-2 rounded-full bg-accent" aria-hidden /> Live
        </span>
      </div>
      <RadialChecks
        items={CHECKS}
        active={active}
        onSelect={setActive}
        className="mx-auto mt-2 max-w-[420px]"
        center={
          <span className="grid size-full place-items-center rounded-full bg-[#1d1b17] p-[14%] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)]">
            <span className="grid size-full place-items-center rounded-full bg-[#e6ec8f]">
              <span className="size-[9%] rounded-full bg-[#1d1b17]" />
            </span>
          </span>
        }
      />
      <div className="glass mt-4 rounded-lg p-4 sm:p-5" aria-live="polite">
        <h3 className="text-[15px] tracking-[0.02em] uppercase">{check.label}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-white/85">{check.detail}</p>
        <div className="mt-3 flex items-center gap-3 text-[14px]">
          <span className="text-white/70">Weight in the verdict</span>
          <span className="leader opacity-60 invert" aria-hidden />
          <span>{check.weight}</span>
        </div>
      </div>
    </section>
  )
}

/** The reference's sensor card: a cream panel with a title and status, figures, and leader rows. */
function ResultCard({
  to,
  title,
  verdict,
  figures,
  rows,
}: {
  to: string
  title: string
  verdict: VerdictLabel
  figures: [string, number | string, string?][]
  rows: [string, ReactNode][]
}) {
  const v = VERDICTS[verdict]
  return (
    <Link to={to} className={`cream ${toneOf(verdict)} group flex flex-col rounded-xl p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">{title}</p>
          <span className={`status mt-1 ${v.text}`}>
            <span className="size-2 rounded-full bg-current" aria-hidden /> {v.title}
          </span>
        </div>
        <span className="well size-10">
          <ArrowUpRight className="size-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" strokeWidth={1.5} />
        </span>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-4">
        {figures.map(([label, value, unit]) => (
          <Figure key={label} label={label} value={value} unit={unit} />
        ))}
      </div>
      <dl className="mt-4">
        {rows.map(([label, value]) => (
          <LeaderRow key={label} label={label} value={value} />
        ))}
      </dl>
    </Link>
  )
}

function StatLink({ to, label, value }: { to: string; label: string; value: number | null }) {
  return (
    <Link to={to} className="group min-w-0 rounded-lg">
      <p className="text-[14px] text-muted">{label}</p>
      {value === null ? (
        <span className="skeleton mt-2 block h-8 w-10" />
      ) : (
        <p className="num mt-1 text-[36px] leading-none transition-opacity group-hover:opacity-70">{value}</p>
      )}
    </Link>
  )
}

function UploadCard() {
  return (
    <Link to="/new" className="panel group flex flex-col gap-6 rounded-xl p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">Upload an image</p>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-transform group-hover:scale-105">
          <Plus className="size-5" strokeWidth={1.75} />
        </span>
      </div>
      <dl>
        <LeaderRow label="Formats" value="JPEG · PNG · WebP · TIFF · HEIC" />
        <LeaderRow label="Size" value="Up to 25 MB" />
        <LeaderRow label="File" value="Deleted after" />
      </dl>
    </Link>
  )
}
