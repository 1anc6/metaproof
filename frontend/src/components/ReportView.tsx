import { Check, ChevronDown, Fingerprint, Link2, Plus, Printer, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { AnalyzerResult, Finding, Job, Verdict } from '../lib/api'
import { formatBytes, formatDateTime, formatType, shortHash } from '../lib/format'
import { SIGNALS, STRENGTH_LABEL, VERDICTS } from '../lib/verdicts'
import { SignalDot, Thumb } from './ui'

export function ReportView({ job, filename }: { job: Job; filename?: string }) {
  const verdict = job.verdict!
  const v = VERDICTS[verdict.label]
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
            <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted">{v.summary}</p>
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
        <Actions sha={sha} />
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

function Actions({ sha }: { sha: string }) {
  const [copied, setCopied] = useState(false)
  const shareUrl = `${window.location.origin}/report/${sha}`
  const copy = async () => {
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
      <button type="button" onClick={copy} className="glass btn-ghost">
        {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
        {copied ? 'Link copied' : 'Copy share link'}
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
