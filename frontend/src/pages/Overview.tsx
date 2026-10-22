import { ArrowRight, ArrowUpRight, EyeOff, Filter, Plus, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatBytes, formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { toneOf, VERDICTS } from '../lib/verdicts'
import { ArcGauge, Chip, FileName, Figure, LeaderRow, PanelTitle, Thumb, VerdictBadge } from '../components/ui'
import { CheckDial } from '../components/CheckDial'
import { CHECKS } from '../lib/checks'


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
    <div className="flex flex-col gap-10 lg:gap-14">
      <Hero />

      {/* The two cards side by side, on the hero's column edges. */}
      <section className="grid gap-4 md:grid-cols-2" aria-label="Your reports">
        <div className="animate-rise flex min-w-0 flex-col [&>*]:flex-1">
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
        </div>
        <div className="animate-rise flex min-w-0 flex-col [&>*]:flex-1">
          {history.length > 0 ? (
            <section className="panel rounded-[26px] p-4 sm:p-6" aria-label="Your analyses">
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
          <h2 className="display text-[36px] leading-none">Recent analyses</h2>
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
          <div className="panel mt-4 rounded-[26px] px-4 py-6 sm:px-6 sm:py-8">
            <p className="text-[17px]">No analyses yet</p>
            <p className="mt-1 max-w-sm text-[15px] text-muted">
              Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
            </p>
            <Link to="/new" className="btn-primary mt-4">
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
                  <Link to={`/analysis/${entry.jobId}`} className="panel flex h-full flex-col rounded-[24px] p-2.5">
                    <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="aspect-[4/3] w-full rounded-[16px]" />
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
 * The first screen. On a desktop the words take the left column (the title, the sentence under it,
 * the two ways in, and the chosen check explained) and the dial takes the right as the picture; the
 * explanation's foot lines up with the dial's toolbar. On a phone they stack: words, dial, explanation.
 */
function Hero() {
  const [active, setActive] = useState('c2pa')
  const check = CHECKS.find((c) => c.key === active)!
  const Icon = check.icon
  return (
    <section
      aria-labelledby="overview-title"
      className="grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:[grid-template-areas:'words_dial'_'check_dial'] xl:grid-cols-[minmax(0,1fr)_minmax(0,460px)] xl:gap-x-16"
    >
      <div className="animate-rise min-w-0 lg:[grid-area:words]">
        <h1 id="overview-title" className="display max-w-[7em] text-[52px] leading-[0.95] sm:text-[76px] lg:text-[66px] xl:text-[76px]">
          See what's behind the <span className="mark-word">image</span>
        </h1>
        <p className="mt-6 max-w-[46ch] text-[18px] leading-relaxed text-ink">
          MetaProof reads an image's metadata, Content Credentials and pixels, then tells you what the evidence
          shows, and when it isn't enough to say anything.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/new" className="btn-primary h-12 px-6 text-[16px] max-sm:w-full">
            Analyze an image <ArrowRight className="size-4" strokeWidth={2} />
          </Link>
          <Link to={DEMO_REPORT_PATH} className="btn-ghost h-12 px-6 text-[16px] max-sm:w-full">
            See an example report
          </Link>
        </div>
      </div>

      <div className="animate-rise min-w-0 lg:[grid-area:dial]">
        <h2 className="sr-only">The six checks</h2>
        <CheckDial active={active} onSelect={setActive} className="lg:max-w-none" />
      </div>

      <div className="panel animate-rise mx-auto w-full max-w-[460px] self-end rounded-[26px] p-4 sm:p-5 lg:mx-0 lg:max-w-[520px] lg:[grid-area:check]" aria-live="polite">
        <div className="flex items-center gap-3">
          <span className="well size-10">
            <Icon className="size-[18px]" strokeWidth={1.5} aria-hidden />
          </span>
          <h3 key={check.key} className="animate-rise text-[17px]">{check.label}</h3>
        </div>
        <p key={`${check.key}-d`} className="animate-rise mt-3 text-[15px] leading-relaxed text-muted [animation-delay:60ms]">{check.detail}</p>
        <div key={`${check.key}-w`} className="animate-rise mt-3 flex items-center gap-3 text-[14px] [animation-delay:120ms]">
          <span className="text-faint">Weight in the verdict</span>
          <span className="leader" aria-hidden />
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
    <Link to={to} className={`cream ${toneOf(verdict)} group flex flex-col rounded-[26px] p-4 sm:p-6`}>
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
      <div className="mt-4 grid grid-cols-2 gap-4">
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

/** A small copy of the upload page's drop zone: the dashed field with its glowing button, then the limits. */
function UploadCard() {
  return (
    <Link to="/new" className="panel group flex flex-col gap-4 rounded-[26px] p-4 sm:p-6">
      <p className="eyebrow">Upload an image</p>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-[20px] border-[1.5px] border-dashed border-line-strong px-4 py-6 text-center transition group-hover:bg-hover">
        <span className="relative grid place-items-center" aria-hidden>
          <span className="pointer-events-none absolute -inset-5 rounded-full bg-[radial-gradient(circle,color-mix(in_srgb,var(--color-ink)_28%,transparent),transparent_68%)] transition-transform duration-500 group-hover:scale-110" />
          <span className="relative grid size-14 place-items-center rounded-full bg-[radial-gradient(circle_at_40%_28%,#ffffff,#e2e2e2_55%,#a9a9a9)] text-[#161616] shadow-[0_0_0_1px_rgb(255_255_255/0.7),0_12px_24px_-10px_rgb(0_0_0/0.55)] transition duration-300 group-hover:scale-105">
            <Upload className="size-6" strokeWidth={1.75} />
          </span>
        </span>
        <p className="text-[15px]">Drop or choose an image</p>
      </div>
      <dl>
        <LeaderRow label="Formats" value="JPEG · PNG · WebP · TIFF · HEIC" />
        <LeaderRow label="Size" value="Up to 25 MB" />
        <LeaderRow label="File" value="Deleted after" />
      </dl>
    </Link>
  )
}
