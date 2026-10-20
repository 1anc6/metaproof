import { ArrowUpRight, Copy, Droplets, EyeOff, Filter, Fingerprint, Layers, Plus, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { Chip, EvidenceMap, PanelTitle, Thumb, VerdictBadge } from '../components/ui'

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
      <section className="animate-rise grid items-center gap-8 xl:grid-cols-[minmax(0,1fr)_400px] xl:gap-10">
        <div className="max-w-xl">
          <p className="eyebrow">Image forensics, explained</p>
          {/* Sized to break into two even lines: on a phone, and beside the card on desktop. */}
          <h1 className="mt-3 text-[40px] leading-[1.02] font-medium tracking-[-0.04em] sm:mt-4 sm:text-[72px] sm:leading-[0.98] sm:tracking-[-0.045em] xl:text-[60px]">
            See what's behind the image.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted sm:hidden">
            Checks metadata, credentials and pixels, and tells you what the evidence says.
          </p>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-muted max-sm:hidden">
            MetaProof checks metadata, Content Credentials and the pixels themselves, then tells you
            what the evidence says — and when it isn't enough to say anything.
          </p>
          {/* Two equal buttons side by side on a phone; natural widths from the small breakpoint. */}
          <div className="mt-7 grid grid-cols-2 gap-2.5 sm:mt-8 sm:flex sm:flex-wrap sm:gap-3">
            <Link to="/new" className="btn-primary h-12 px-4 sm:px-6">
              <Plus className="size-4" strokeWidth={2.5} /> New analysis
            </Link>
            <Link to={DEMO_REPORT_PATH} className="btn-ghost h-12 px-4 sm:px-5">
              <span className="sm:hidden">Example report</span>
              <span className="max-sm:hidden">See an example report</span>
              <ArrowUpRight className="size-4 shrink-0 text-faint" />
            </Link>
          </div>
        </div>
        <EvidenceMap to={DEMO_REPORT_PATH} title="Example findings" meterOnPhones={false} />
      </section>

      {/* Stats from this browser's analyses; four zeros tell a first-time visitor nothing. Two by
          two on phones, where four columns would wrap the labels and misalign the numbers. */}
      {history.length > 0 && (
        <section className="panel animate-rise grid grid-cols-2 rounded-xl sm:grid-cols-4" aria-label="Your analyses">
          <Stat to="/history" label="Files analyzed" value={history.length} note="on this device" />
          <Stat to="/history?filter=flagged" label="Flagged" value={n(flagged)} note="edited or AI" tone={flagged ? 'text-edited' : undefined} />
          <Stat to="/history?filter=likely_ai_generated" label="Likely AI" value={n(counts.likely_ai_generated)} note="AI-generated verdicts" tone={counts.likely_ai_generated ? 'text-ai' : undefined} />
          <Stat to="/history?filter=inconclusive" label="Inconclusive" value={n(counts.inconclusive)} note="not enough evidence" />
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
            <div className="flex flex-wrap gap-2 px-4 pb-3 sm:px-5">
              <Chip icon={EyeOff} label="Blur previews" checked={prefs.blurPreviews} onChange={(v) => setPref('blurPreviews', v)} />
              <Chip icon={Filter} label="Only flagged" checked={prefs.onlyFlagged} onChange={(v) => setPref('onlyFlagged', v)} />
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
          {/* Returning visitors on phones came for their files; the checks fold down to the link. */}
          <ul className={`stagger mt-5 flex flex-col gap-2 ${history.length > 0 ? 'max-sm:hidden' : ''}`}>
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
          <Link to="/method" className="btn-ghost mt-6 w-full max-sm:mt-4">
            Read the method <ArrowUpRight className="size-4 text-faint" />
          </Link>
        </section>
      </div>
    </div>
  )
}

/**
 * One cell of the counts strip, linking to History filtered to it. Only a count that needs
 * attention takes its verdict colour.
 */
function Stat({ to, label, value, note, tone }: { to: string; label: string; value: number | null; note?: string; tone?: string }) {
  return (
    <Link
      to={to}
      className="flex min-w-0 flex-col border-line px-4 py-4 transition first:rounded-tl-xl hover:bg-hover max-sm:odd:border-r max-sm:nth-[-n+2]:border-b max-sm:nth-2:rounded-tr-xl max-sm:nth-3:rounded-bl-xl last:rounded-br-xl sm:px-6 sm:py-5 sm:not-last:border-r sm:first:rounded-l-xl sm:last:rounded-r-xl"
    >
      <p className="truncate text-[13px] leading-tight font-medium whitespace-nowrap text-muted sm:text-[15px]">{label}</p>
      {value === null ? (
        <span className="skeleton mt-3 h-9 w-12 sm:mt-4 sm:h-11 sm:w-14" />
      ) : (
        <span className={`num mt-2.5 text-[36px] leading-none sm:mt-3 sm:text-[48px] ${tone ?? 'text-ink'}`}>{value}</span>
      )}
      {note && <p className="mt-2 text-[12px] text-faint max-sm:hidden">{note}</p>}
    </Link>
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
