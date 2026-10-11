import { ArrowUpRight, Check, ChevronDown, Compass, Fingerprint, Link2, Plus, Printer, Share2, ShieldCheck, Sparkles } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, type AnalyzerResult, type Finding, type Job, type SimilarMedia, type Verdict } from '../lib/api'
import { formatBytes, formatDateTime, formatType, formatWhen, shortHash } from '../lib/format'
import { leaning, SIGNALS, STRENGTH_LABEL, VERDICTS } from '../lib/verdicts'
import { SignalDot, Thumb, VerdictBadge } from './ui'

export function ReportView({ job, filename }: { job: Job; filename?: string }) {
  const verdict = job.verdict!
  const v = VERDICTS[verdict.label]
  const lean = verdict.label === 'inconclusive' ? leaning(verdict.scores) : null
  const sha = job.media.sha256

  return (
    <div className="flex flex-col gap-6">
      {/* Verdict hero */}
      <section className="glass animate-rise relative overflow-hidden rounded-[32px] p-5 sm:p-8">
        <div
          className="pointer-events-none absolute -top-24 -right-24 size-72 rounded-full opacity-25 blur-3xl"
          style={{ background: v.color }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center">
          <Thumb sha={sha} className="aspect-square w-full max-w-[200px] shrink-0 rounded-3xl ring-1 ring-white/10 max-sm:mx-auto max-sm:max-w-[180px]" />
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Verdict</p>
            <h1 className={`mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl ${v.text} print-dark`}>
              {v.title}
            </h1>
            {lean && (
              <p className="mt-2 font-display text-lg font-medium" style={{ color: lean.color }}>
                leaning {lean.label}
              </p>
            )}
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">
              {lean
                ? `Some evidence points to ${lean.label === 'authentic' ? 'an authentic photo' : `an ${lean.label} image`}, but not enough to decide. Treat it as unverified.`
                : v.summary}
            </p>
            <DetectorChip job={job} />
            {filename && <p className="mt-4 truncate text-sm text-ink">{filename}</p>}
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 font-mono text-[11px] text-faint">
              <div>{formatType(job.media.mime_type)}</div>
              <div>
                {job.media.width}×{job.media.height}
              </div>
              <div>{formatBytes(job.media.size_bytes)}</div>
              <div title={sha}>sha256 {shortHash(sha)}</div>
              {job.finished_at && <div>{formatDateTime(job.finished_at)}</div>}
            </dl>
          </div>
        </div>
        <Actions sha={sha} title={lean ? `${v.title}, leaning ${lean.label}` : v.title} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Key findings */}
        <section className="glass animate-rise rounded-[28px] p-5 sm:p-6">
          <p className="eyebrow">Why</p>
          <h2 className="mt-1 font-display text-lg font-semibold">Key findings</h2>
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {verdict.top_reasons.map((f) => (
              <FindingRow key={f.code} finding={f} />
            ))}
          </ul>
        </section>

        {/* Evidence balance */}
        <section className="glass animate-rise rounded-[28px] p-5 sm:p-6">
          <p className="eyebrow">Evidence weight</p>
          <h2 className="mt-1 font-display text-lg font-semibold">Balance of signals</h2>
          <EvidenceBars scores={verdict.scores} />
          <p className="mt-5 text-xs leading-relaxed text-faint">
            Weights add up the findings for each outcome. A verdict needs enough weight and a clear
            lead; otherwise MetaProof says inconclusive.
          </p>
        </section>
      </div>

      {verdict.label === 'inconclusive' && <NextSteps />}

      <SeenBefore sha={sha} />

      {/* Analyzer details */}
      <section className="flex flex-col gap-3">
        <p className="eyebrow px-1">Analyzer details</p>
        {job.analyzers.map((a) => (
          <AnalyzerPanel key={a.analyzer} result={a} />
        ))}
      </section>

      <p className="px-1 text-xs leading-relaxed text-faint">
        MetaProof reports evidence, not absolute truth. Missing metadata or credentials are never
        counted against a file. Engine {verdict.engine_version} · pipeline {job.pipeline_version}.
      </p>
    </div>
  )
}

// Phones get the system share sheet (WhatsApp, Messages, …); desktops copy the link.
const nativeShare =
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

function Actions({ sha, title }: { sha: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = `${window.location.origin}/report/${sha}`
  const share = async () => {
    if (nativeShare) {
      try {
        await navigator.share({ title: `MetaProof report: ${title}`, url: shareUrl })
        return
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return // the user closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this link', shareUrl)
    }
  }
  return (
    <div className="no-print relative mt-6 flex flex-wrap gap-2 border-t border-white/5 pt-5">
      <button type="button" onClick={share} className="glass btn-ghost">
        {copied ? <Check className="size-4" /> : nativeShare ? <Share2 className="size-4" /> : <Link2 className="size-4" />}
        {copied ? 'Link copied' : nativeShare ? 'Share report' : 'Copy share link'}
      </button>
      <button type="button" onClick={() => window.print()} className="glass btn-ghost">
        <Printer className="size-4" /> Save as PDF
      </button>
      <Link to="/new" className="btn-primary ml-auto max-sm:w-full">
        <Plus className="size-4" strokeWidth={2.5} /> Analyze another
      </Link>
    </div>
  )
}

function FindingRow({ finding }: { finding: Finding }) {
  const s = SIGNALS[finding.signal]
  return (
    <li className="flex gap-3 py-3.5 first:pt-1 last:pb-1">
      <SignalDot signal={finding.signal} />
      <div className="min-w-0">
        <p className="text-sm leading-relaxed text-ink">{finding.message}</p>
        <p className="mt-1 font-mono text-[10px] tracking-wide text-faint uppercase">
          {s.label} · {STRENGTH_LABEL[finding.strength]}
        </p>
      </div>
    </li>
  )
}

function EvidenceBars({ scores }: { scores: Verdict['scores'] }) {
  const rows = [
    { key: 'authentic' as const, label: 'Authentic' },
    { key: 'edited' as const, label: 'Edited' },
    { key: 'ai' as const, label: 'AI-generated' },
  ]
  const max = Math.max(3, ...rows.map((r) => scores[r.key]))
  return (
    <ul className="mt-5 flex flex-col gap-4">
      {rows.map(({ key, label }) => {
        const value = scores[key]
        const color = SIGNALS[key].color
        return (
          <li key={key}>
            <div className="flex justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="font-mono text-faint tabular-nums">{value.toFixed(1)}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${(value / max) * 100}%`, background: color, boxShadow: `0 0 12px ${color}` }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const ANALYZER_META: Record<string, { title: string; icon: typeof Fingerprint; blurb: string }> = {
  metadata: { title: 'Metadata', icon: Fingerprint, blurb: 'EXIF, XMP and text chunks embedded in the file' },
  c2pa: { title: 'Content Credentials (C2PA)', icon: ShieldCheck, blurb: 'Signed provenance manifest' },
  detector: { title: 'AI-image detector', icon: Sparkles, blurb: 'CLIP features + calibrated classifier' },
}

function AnalyzerPanel({ result }: { result: AnalyzerResult }) {
  const [open, setOpen] = useState(false)
  const meta = ANALYZER_META[result.analyzer] ?? { title: result.analyzer, icon: Fingerprint, blurb: '' }
  const Icon = meta.icon
  return (
    <div className="glass animate-rise rounded-3xl">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left sm:p-5"
      >
        <span className="glass grid size-10 shrink-0 place-items-center rounded-2xl">
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{meta.title}</p>
          <p className="truncate text-xs text-faint">
            {result.ok ? `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'} · ${result.duration_ms} ms` : 'Analyzer error'}
            <span className="max-sm:hidden"> · {meta.blurb}</span>
          </p>
        </div>
        <ChevronDown className={`no-print size-4 text-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      <div className={`${open ? 'block' : 'hidden'} border-t border-white/5 px-4 pt-4 pb-5 sm:px-5 print:block`}>
        {!result.ok ? (
          <p className="text-sm text-ai">{result.error}</p>
        ) : result.analyzer === 'metadata' ? (
          <MetadataDetails raw={result.raw} />
        ) : result.analyzer === 'c2pa' ? (
          <C2paDetails raw={result.raw} />
        ) : result.analyzer === 'detector' ? (
          <DetectorDetails raw={result.raw} />
        ) : (
          <pre className="overflow-x-auto font-mono text-xs text-muted">{JSON.stringify(result.raw, null, 2)}</pre>
        )}
      </div>
    </div>
  )
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11px] text-faint">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-ink" title={typeof v === 'string' ? v : undefined}>
            {v ?? <span className="text-faint">—</span>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function MetadataDetails({ raw }: { raw: Record<string, unknown> }) {
  const f = (raw.fields ?? {}) as Record<string, unknown>
  const exiftool = raw.exiftool as Record<string, unknown> | undefined
  const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
  return (
    <div className="flex flex-col gap-5">
      <Fields
        rows={[
          ['Camera', str([f.make, f.model].filter(Boolean).join(' '))],
          ['Software', str(f.software)],
          ['Captured', str(f.datetime_original)],
          ['Modified', str(f.datetime_modified)],
          ['Creator tool (XMP)', str(f.xmp_creator_tool)],
          ['IPTC source type', str(f.xmp_digital_source_type)],
          ['PNG text keys', (f.png_text_keys as string[] | undefined)?.join(', ') || null],
          ['GPS', f.has_gps ? 'Present (coordinates not stored)' : 'None'],
        ]}
      />
      {exiftool && Object.keys(exiftool).length > 0 && (
        <details className="group rounded-2xl border border-white/5 bg-black/20">
          <summary className="cursor-pointer list-none px-4 py-3 text-xs text-muted hover:text-ink">
            All {Object.keys(exiftool).length} ExifTool tags
          </summary>
          <div className="max-h-80 overflow-auto px-4 pb-4">
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {Object.entries(exiftool).map(([k, v]) => (
                  <tr key={k} className="border-t border-white/5">
                    <td className="py-1.5 pr-4 align-top text-faint">{k}</td>
                    <td className="py-1.5 break-all text-muted">{String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  )
}

function C2paDetails({ raw }: { raw: Record<string, unknown> }) {
  if (!raw.present) {
    return (
      <p className="text-sm text-muted">
        No Content Credentials found. Most images have none, and re-saving or uploading to social
        media usually strips them, so this is not evidence either way.
      </p>
    )
  }
  const actions = (raw.actions as { action: string; digital_source_type: string; software_agent: string | null }[]) ?? []
  const failures = (raw.validation_failures as string[]) ?? []
  return (
    <div className="flex flex-col gap-5">
      <Fields
        rows={[
          ['Validation', String(raw.validation_state ?? 'Unknown')],
          ['Signer', (raw.signer as string) ?? null],
          ['Signer on trust list', raw.signer_trusted ? 'Yes' : 'No'],
          ['Claim generator', (raw.claim_generator as string) ?? null],
          ['Signed at', (raw.signed_at as string) ?? null],
          ['Ingredients', String(raw.ingredient_count ?? 0)],
        ]}
      />
      {failures.length > 0 && <p className="text-sm text-ai">Validation failures: {failures.join(', ')}</p>}
      {actions.length > 0 && (
        <div>
          <p className="text-[11px] text-faint">Recorded actions</p>
          <ol className="mt-2 flex flex-col gap-1.5">
            {actions.map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-mono text-xs text-faint">{i + 1}.</span>
                <span>{a.action}</span>
                {a.digital_source_type && <span className="text-xs text-muted">· {a.digital_source_type}</span>}
                {a.software_agent && <span className="text-xs text-faint">· {a.software_agent}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

function DetectorDetails({ raw }: { raw: Record<string, unknown> }) {
  if (!raw.available || typeof raw.p_ai !== 'number') {
    return <p className="text-sm text-muted">The detector model is not loaded on this server.</p>
  }
  const pct = Math.round(raw.p_ai * 100)
  const color = pct >= 85 ? 'var(--color-ai)' : pct < 10 ? 'var(--color-authentic)' : 'var(--color-neutral)'
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] text-faint">Probability the pixels are AI-generated</span>
          <span className="font-display text-2xl font-semibold tabular-nums" style={{ color }}>
            {pct}%
          </span>
        </div>
        <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 14px ${color}` }} />
          {/* band edges used by the evidence engine */}
          {[10, 85, 95].map((t) => (
            <span key={t} className="absolute top-0 h-full w-px bg-white/25" style={{ left: `${t}%` }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
          <span>camera-like</span>
          <span>unsure</span>
          <span>AI</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-faint">
        A calibrated classifier on CLIP image features, tested on generators it never saw during
        training. It is one signal among several: strong provenance evidence outweighs it, and it
        cannot detect local edits to real photos.
      </p>
    </div>
  )
}

function DetectorChip({ job }: { job: Job }) {
  const raw = job.analyzers.find((a) => a.analyzer === 'detector')?.raw
  if (!raw?.available || typeof raw.p_ai !== 'number') return null
  const pct = Math.round(raw.p_ai * 100)
  const color = pct >= 85 ? 'var(--color-ai)' : pct < 10 ? 'var(--color-authentic)' : 'var(--color-neutral)'
  return (
    <span className="glass mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs">
      <Sparkles className="size-3.5" style={{ color }} />
      <span className="text-muted">AI detector</span>
      <span className="font-mono font-semibold tabular-nums" style={{ color }}>
        {pct}%
      </span>
    </span>
  )
}

/** Near-duplicates found by CLIP embedding similarity (pgvector). */
function SeenBefore({ sha }: { sha: string }) {
  const [items, setItems] = useState<SimilarMedia[] | null>(null)
  useEffect(() => {
    let cancelled = false
    api
      .similar(sha)
      .then((rows) => !cancelled && setItems(rows))
      .catch(() => !cancelled && setItems([]))
    return () => {
      cancelled = true
    }
  }, [sha])
  if (!items || items.length === 0) return null
  return (
    <section className="glass animate-rise rounded-[28px] p-5 sm:p-6">
      <p className="eyebrow">Seen before</p>
      <h2 className="mt-1 font-display text-lg font-semibold">
        {items.length === 1 ? 'A near-identical image was analyzed before' : `${items.length} near-identical images were analyzed before`}
      </h2>
      <p className="mt-1 text-xs text-faint">
        Resized, cropped or recompressed copies have a different file hash, so MetaProof also compares what the images look like.
      </p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((m) => (
          <li key={m.sha256}>
            <Link to={`/report/${m.sha256}`} className="flex items-center gap-3 rounded-2xl p-2 transition hover:bg-white/[0.04]">
              <Thumb sha={m.sha256} className="size-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="font-mono text-xs text-muted">{Math.round(m.similarity * 100)}% similar</p>
                <p className="text-xs text-faint">First seen {formatWhen(m.first_seen_at)}</p>
              </div>
              <VerdictBadge label={m.label} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

const SEARCH_TOOLS = [
  { name: 'Google Lens', url: 'https://lens.google.com/' },
  { name: 'TinEye', url: 'https://tineye.com/' },
  { name: 'Bing Visual Search', url: 'https://www.bing.com/visualsearch' },
]

/** Inconclusive is the most common verdict, so it should leave the reader with something to do. */
function NextSteps() {
  return (
    <section className="glass animate-rise rounded-[28px] p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <Compass className="size-5" strokeWidth={1.5} />
        <h2 className="font-display text-lg font-semibold">What you can do next</h2>
      </div>
      <ol className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-muted">
        <li>
          <span className="text-ink">Find the original.</span> A reverse image search shows where the
          picture appeared first and whether an older or larger version exists:
          <span className="mt-2 flex flex-wrap gap-2">
            {SEARCH_TOOLS.map((t) => (
              <a key={t.name} href={t.url} target="_blank" rel="noreferrer" className="glass btn-ghost !py-1.5 !text-xs">
                {t.name} <ArrowUpRight className="size-3.5" />
              </a>
            ))}
          </span>
        </li>
        <li>
          <span className="text-ink">Ask for the original file.</span> Photos straight from a camera or
          phone keep more metadata, and some carry signed Content Credentials that MetaProof can verify.
        </li>
        <li>
          <span className="text-ink">Look at the context.</span> Who posted it first, and do other
          sources show the same scene from another angle?
        </li>
      </ol>
      <p className="mt-4 text-xs text-faint">
        These sites open in a new tab; you upload the image there yourself. MetaProof sends them nothing.
      </p>
    </section>
  )
}
