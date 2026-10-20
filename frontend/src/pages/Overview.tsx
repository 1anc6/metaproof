import { ArrowUpRight, Copy, Droplets, Fingerprint, Layers, Plus, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { EvidenceMap, PanelTitle, Thumb, Toggle, VerdictBadge } from '../components/ui'

const LAYERS = [
  { icon: Fingerprint, name: 'Metadata', detail: 'EXIF, XMP and generator traces' },
  { icon: Layers, name: 'File structure', detail: 'JPEG quality, segments and colour profile' },
  { icon: ShieldCheck, name: 'Content Credentials', detail: 'Signed C2PA provenance' },
  { icon: Droplets, name: 'Invisible watermark', detail: 'Marks hidden by Stable Diffusion tools' },
  { icon: Sparkles, name: 'AI detector', detail: 'CLIP features, tested on unseen generators' },
  { icon: Copy, name: 'Seen-before search', detail: 'Finds resized or recompressed copies' },
]

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
  const recent = (prefs.onlyFlagged ? history.filter((e) => isFlagged(e.jobId)) : history).slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <section className="animate-rise grid items-center gap-8 pb-4 xl:grid-cols-[1fr_460px] xl:gap-12">
        <div className="max-w-xl">
          <p className="mb-4 text-sm text-faint">
            MetaProof <span aria-hidden>›</span> Overview
          </p>
          <h1 className="text-[46px] leading-[0.98] font-medium tracking-[-0.045em] sm:text-[72px]">
            See what's behind the image.
          </h1>
          <p className="eyebrow mt-6">Image forensics, explained</p>
          <p className="mt-2 max-w-md text-[17px] leading-relaxed text-muted">
            MetaProof checks metadata, Content Credentials and the pixels themselves, then tells you
            what the evidence says — and when it isn't enough to say anything.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/new" className="btn-primary h-12 px-6">
              <Plus className="size-4" strokeWidth={2.5} /> New analysis
            </Link>
            <Link to={DEMO_REPORT_PATH} className="btn-ghost h-12 px-5">
              See an example report <ArrowUpRight className="size-4 text-faint" />
            </Link>
          </div>
        </div>
        <EvidenceMap to={DEMO_REPORT_PATH} title="Example findings" />
      </section>

      {/* Stats from this browser's analyses; four zeros tell a first-time visitor nothing */}
      {history.length > 0 && (
        <section className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Your analyses">
          <Stat label="Files analyzed" value={history.length} note="on this device" />
          <Stat label="Flagged" value={n(flagged)} note="edited or AI" tone={flagged ? 'text-edited' : undefined} />
          <Stat label="Likely AI" value={n(counts.likely_ai_generated)} note="AI-generated verdicts" tone={counts.likely_ai_generated ? 'text-ai' : undefined} />
          <Stat label="Inconclusive" value={n(counts.inconclusive)} note="not enough evidence" />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* Recent analyses */}
        <section className="panel animate-rise rounded-xl p-2">
          <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4 pb-3 sm:px-5">
            <PanelTitle eyebrow="Recent signals" title="Latest analyses" />
            {history.length > 0 && (
              <Link to="/history" className="well size-11" aria-label="View all analyses">
                <ArrowUpRight className="size-4" />
              </Link>
            )}
          </div>
          {history.length > 0 && (
            <div className="flex flex-wrap gap-x-5 gap-y-2 px-4 pb-3 sm:px-5">
              <label className="flex items-center gap-2.5 text-sm text-muted">
                <Toggle label="Blur previews" checked={prefs.blurPreviews} onChange={(v) => setPref('blurPreviews', v)} />
                Blur previews
              </label>
              <label className="flex items-center gap-2.5 text-sm text-muted">
                <Toggle label="Only flagged" checked={prefs.onlyFlagged} onChange={(v) => setPref('onlyFlagged', v)} />
                Only flagged
              </label>
            </div>
          )}
          {history.length === 0 ? (
            <EmptyRecent />
          ) : recent.length === 0 ? (
            <p className="px-5 pt-2 pb-8 text-[15px] text-faint">
              {loading ? 'Loading verdicts…' : 'Nothing edited or AI-generated among your analyses.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {recent.map((entry) => {
                const s = data[entry.jobId]
                return (
                  <li key={entry.jobId}>
                    <Link
                      to={`/analysis/${entry.jobId}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-hover"
                    >
                      <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="size-12 shrink-0 rounded-full" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-semibold">{entry.filename}</p>
                        <p className="text-[13px] text-faint">{formatWhen(entry.uploadedAt)}</p>
                      </div>
                      {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton h-6 w-20" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Evidence layers */}
        <section className="panel animate-rise rounded-xl p-6">
          <PanelTitle eyebrow="Evidence layers" title="Six independent checks" />
          <ul className="stagger mt-5 flex flex-col gap-2">
            {LAYERS.map(({ icon: Icon, name, detail }) => (
              <li key={name} className="animate-rise flex items-center gap-3">
                <span className="well size-10">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold">{name}</p>
                  <p className="truncate text-[13px] text-faint">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <Link to="/method" className="btn-ghost mt-6 w-full">
            Read the method <ArrowUpRight className="size-4 text-faint" />
          </Link>
        </section>
      </div>
    </div>
  )
}

/** A count on neutral glass. Only a count that needs attention takes its verdict colour. */
function Stat({ label, value, note, tone }: { label: string; value: number | null; note?: string; tone?: string }) {
  return (
    <div className="panel animate-rise flex flex-col rounded-xl p-4 sm:p-5">
      <p className="text-[15px] font-medium text-muted">{label}</p>
      {value === null ? (
        <span className="skeleton mt-5 h-11 w-14" />
      ) : (
        <span className={`num mt-4 text-[48px] leading-none ${tone ?? 'text-ink'}`}>{value}</span>
      )}
      {note && <p className="mt-2 px-1 text-[12px] text-faint">{note}</p>}
    </div>
  )
}

function EmptyRecent() {
  return (
    <div className="flex flex-col items-center px-6 pt-6 pb-10 text-center">
      <span className="well size-16">
        <ScanSearch className="size-6 text-muted" strokeWidth={1.5} />
      </span>
      <p className="mt-4 text-[17px] font-semibold">No analyses yet</p>
      <p className="mt-1 max-w-xs text-[15px] text-faint">
        Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
      </p>
      <Link to="/new" className="btn-ghost mt-6">
        <Plus className="size-4" strokeWidth={2.5} /> Analyze an image
      </Link>
    </div>
  )
}
