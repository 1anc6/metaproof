import { ArrowUpRight, Fingerprint, Layers, Plus, ScanSearch, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { VerdictLabel } from '../lib/api'
import { formatWhen } from '../lib/format'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { Orb, Thumb, VerdictBadge } from '../components/ui'

const LAYERS = [
  { icon: Fingerprint, name: 'Metadata', detail: 'EXIF, XMP and generator traces', live: true },
  { icon: ShieldCheck, name: 'Content Credentials', detail: 'Signed C2PA provenance', live: true },
  { icon: Layers, name: 'Invisible watermark', detail: 'TrustMark detection', live: false },
  { icon: Sparkles, name: 'AI detector', detail: 'CLIP-based pixel analysis', live: false },
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
  const recent = history.slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      {/* Hero */}
      <section className="glass animate-rise relative overflow-hidden rounded-[32px] p-6 sm:p-10">
        <div className="relative z-10 max-w-xl">
          <p className="eyebrow mb-4">Image authenticity, explained</p>
          <h1 className="font-display text-[38px] leading-[1.02] font-semibold tracking-tight sm:text-6xl">
            See what's behind
            <br />
            <span className="bg-gradient-to-b from-zinc-300 to-zinc-600 bg-clip-text text-transparent">
              the image.
            </span>
          </h1>
          <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            MetaProof checks metadata, Content Credentials and the pixels themselves, then tells you
            what the evidence says — and when it isn't enough to say anything.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/new" className="btn-primary">
              <Plus className="size-4" strokeWidth={2.5} /> New analysis
            </Link>
            <Link to="/method" className="glass btn-ghost">
              How it works
            </Link>
          </div>
        </div>
        <Orb size={220} className="absolute -right-6 bottom-[-40px] opacity-90 max-sm:hidden lg:right-14" />
      </section>

      {/* Stats from this browser's analyses */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Your analyses">
        <Stat label="Files analyzed" value={history.length} note="on this device" />
        <Stat label="Flagged" value={n(flagged)} note="edited or AI" accent={flagged > 0 ? 'var(--color-edited)' : undefined} />
        <Stat label="Likely AI" value={n(counts.likely_ai_generated)} accent={counts.likely_ai_generated ? 'var(--color-ai)' : undefined} />
        <Stat label="Inconclusive" value={n(counts.inconclusive)} note="not enough evidence" />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Recent analyses */}
        <section className="glass animate-rise rounded-[28px] p-2">
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <div>
              <p className="eyebrow">Recent signals</p>
              <h2 className="mt-1 font-display text-lg font-semibold">Latest analyses</h2>
            </div>
            {history.length > 0 && (
              <Link to="/history" className="flex items-center gap-1 text-xs text-muted hover:text-ink">
                View all <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
          {recent.length === 0 ? (
            <EmptyRecent />
          ) : (
            <ul className="flex flex-col">
              {recent.map((entry) => {
                const s = data[entry.jobId]
                return (
                  <li key={entry.jobId}>
                    <Link
                      to={`/analysis/${entry.jobId}`}
                      className="flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-white/[0.04]"
                    >
                      <Thumb sha={entry.sha256} className="size-11 shrink-0 rounded-xl" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{entry.filename}</p>
                        <p className="text-xs text-faint">{formatWhen(entry.uploadedAt)}</p>
                      </div>
                      {s ? <VerdictBadge label={s.label} status={s.status} /> : <span className="skeleton h-3 w-16" />}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Evidence layers */}
        <section className="glass animate-rise rounded-[28px] p-5">
          <p className="eyebrow">Evidence layers</p>
          <h2 className="mt-1 font-display text-lg font-semibold">Four independent checks</h2>
          <ul className="mt-5 flex flex-col gap-3">
            {LAYERS.map(({ icon: Icon, name, detail, live }) => (
              <li key={name} className="flex items-center gap-3">
                <span className="glass grid size-10 shrink-0 place-items-center rounded-2xl">
                  <Icon className="size-4 text-ink" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-xs text-faint">{detail}</p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
                    live ? 'bg-authentic/10 text-authentic' : 'bg-white/5 text-faint'
                  }`}
                >
                  {live ? 'Live' : 'Soon'}
                </span>
              </li>
            ))}
          </ul>
          <Link to="/method" className="mt-5 flex items-center gap-1 text-xs text-muted hover:text-ink">
            Read the method <ArrowUpRight className="size-3.5" />
          </Link>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, note, accent }: { label: string; value: number | null; note?: string; accent?: string }) {
  return (
    <div className="glass animate-rise rounded-3xl p-4 sm:p-5">
      <p className="text-xs text-muted">{label}</p>
      {value === null ? (
        <div className="skeleton mt-4 h-8 w-10" />
      ) : (
        <p className="mt-3 font-display text-3xl font-semibold tabular-nums sm:text-4xl" style={accent ? { color: accent } : undefined}>
          {value}
        </p>
      )}
      {note && <p className="mt-1 text-[11px] text-faint">{note}</p>}
    </div>
  )
}

function EmptyRecent() {
  return (
    <div className="flex flex-col items-center px-6 pt-6 pb-10 text-center">
      <span className="glass grid size-14 place-items-center rounded-2xl">
        <ScanSearch className="size-6 text-muted" strokeWidth={1.5} />
      </span>
      <p className="mt-4 font-medium">No analyses yet</p>
      <p className="mt-1 max-w-xs text-sm text-faint">
        Upload an image to see its metadata, credentials and verdict. Your history stays on this device.
      </p>
      <Link to="/new" className="btn-primary mt-5">
        <Plus className="size-4" strokeWidth={2.5} /> Analyze an image
      </Link>
    </div>
  )
}
