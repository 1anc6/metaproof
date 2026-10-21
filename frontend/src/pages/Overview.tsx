import { ArrowRight, EyeOff, Filter, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { setPref, usePrefs } from '../lib/prefs'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { Chip, FileName, PanelTitle, Thumb, VerdictBadge } from '../components/ui'

const LAYERS = [
  { name: 'Metadata', detail: 'EXIF, XMP and generator traces' },
  { name: 'File structure', detail: 'JPEG quality, segments and colour profile' },
  { name: 'Content Credentials', detail: 'Signed C2PA provenance' },
  { name: 'Invisible watermark', detail: 'Marks hidden by Stable Diffusion tools' },
  { name: 'AI detector', detail: 'CLIP features, tested on unseen generators' },
  { name: 'Seen-before search', detail: 'Finds resized or recompressed copies' },
]

const DEMO_SHA = DEMO_REPORT_PATH.split('/').pop()!

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
      {/* Hero: what this is, one action, and a real report beside it instead of decoration. */}
      <section className="animate-rise grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:items-end lg:gap-12">
        <div className="max-w-xl">
          <h1 className="text-[36px] leading-[1.04] font-medium tracking-[-0.035em] sm:text-[48px]">
            See what's behind the image
          </h1>
          <p className="mt-4 max-w-lg text-[17px] leading-relaxed text-muted">
            MetaProof reads an image's metadata, Content Credentials and pixels, then tells you what the
            evidence shows, and when it isn't enough to say anything.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link to="/new" className="btn-primary h-12 px-6">
              <Plus className="size-4" strokeWidth={2.5} /> New analysis
            </Link>
            <Link to="/method" className="inline-flex items-center gap-1.5 text-[15px] font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
              How it works
            </Link>
          </div>
        </div>
        <ExampleReport />
      </section>

      {/* Stats from this browser's analyses; four zeros tell a first-time visitor nothing. Two by
          two on phones, where four columns would wrap the labels and misalign the numbers. */}
      {history.length > 0 && (
        <section className="panel animate-rise grid grid-cols-2 rounded-xl sm:grid-cols-4" aria-label="Your analyses">
          <Stat to="/history" label="Files analyzed" value={history.length} note="on this device" />
          <Stat to="/history?filter=flagged" label="Flagged" value={n(flagged)} note="edited or AI" tone={flagged ? 'text-edited' : undefined} />
          <Stat to="/history?filter=likely_ai_generated" label="Likely AI" value={n(counts.likely_ai_generated)} note={counts.likely_ai_generated === 1 ? 'AI-generated verdict' : 'AI-generated verdicts'} tone={counts.likely_ai_generated ? 'text-ai' : undefined} />
          <Stat to="/history?filter=inconclusive" label="Inconclusive" value={n(counts.inconclusive)} note="not enough evidence" />
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        {/* Recent analyses */}
        <section className="panel animate-rise rounded-xl p-2">
          <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4 pb-3 sm:px-5">
            <PanelTitle title="Recent analyses" />
            {history.length > 0 && (
              <Link to="/history" className="inline-flex items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
                View all <ArrowRight className="size-3.5" />
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
                      <Thumb sha={entry.sha256} blur={prefs.blurPreviews} className="size-12 shrink-0 rounded-md" />
                      <div className="min-w-0 flex-1">
                        <FileName name={entry.filename} className="text-[15px] font-semibold" />
                        {/* On phones the verdict sits under the name, so the name gets the row's full width. */}
                        <div className="flex min-w-0 items-center gap-2 max-sm:mt-1">
                          <span className="shrink-0 sm:hidden">
                            {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-3 w-16" />}
                          </span>
                          <span className="truncate text-[13px] text-faint">{formatWhen(entry.uploadedAt)}</span>
                        </div>
                      </div>
                      <span className="shrink-0 max-sm:hidden">
                        {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton block h-6 w-20" />}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* The six checks, as a plain list: the names carry it, no icons needed. */}
        <section className="panel animate-rise rounded-xl p-6">
          <PanelTitle title="Six checks on every image" />
          {/* Returning visitors on phones came for their files; the checks fold down to the link. */}
          <dl className={`mt-4 flex flex-col divide-y divide-line ${history.length > 0 ? 'max-sm:hidden' : ''}`}>
            {LAYERS.map(({ name, detail }) => (
              <div key={name} className="py-3 first:pt-0">
                <dt className="text-[15px] font-semibold">{name}</dt>
                <dd className="mt-0.5 text-[14px] text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
          <Link to="/method" className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-muted hover:text-ink">
            Read the method <ArrowRight className="size-3.5" />
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
    <div className="px-5 pt-1 pb-6">
      <p className="text-[15px] font-semibold">No analyses yet</p>
      <p className="mt-1 max-w-sm text-[15px] text-muted">
        Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
      </p>
      <Link to="/new" className="btn-ghost mt-5">
        <Plus className="size-4" strokeWidth={2.5} /> Analyze an image
      </Link>
    </div>
  )
}

/**
 * A real report in miniature: the stored demo image and what its report found. The copy mirrors
 * that report (lib/demo.ts), so keep the two in step if the demo changes.
 */
function ExampleReport() {
  return (
    <Link to={DEMO_REPORT_PATH} className="panel group flex gap-4 rounded-xl p-3 sm:gap-5 sm:p-4">
      <Thumb sha={DEMO_SHA} className="aspect-square w-28 shrink-0 rounded-lg sm:w-36" />
      <div className="flex min-w-0 flex-col py-1">
        <p className="text-[13px] font-medium text-faint">Example report</p>
        <p className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ai">Likely AI-generated</p>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          The pixel detector rates it 99% AI. No camera metadata, no Content Credentials.
        </p>
        <span className="mt-auto inline-flex items-center gap-1 pt-2 text-[14px] font-medium text-ink">
          Open the report <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  )
}
