import { ArrowLeft, ArrowUpRight, ChevronDown, Compass, Droplets, Fingerprint, Layers, Link2, Plus, Printer, Share2, ShieldCheck, Sparkles } from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { api, type AnalyzerResult, type Finding, type Job, type SimilarMedia, type Verdict } from '../lib/api'
import { formatBytes, formatType, formatWhen, shortHash } from '../lib/format'
import { leaning, SIGNALS, STRENGTH_LABEL, VERDICTS } from '../lib/verdicts'
import { FileName, Gauge, Meter, PanelTitle, SignalDot, Thumb, VerdictBadge } from './ui'
import { VerdictGlyph, VerdictSpectrum } from './Verdict'
import { ErrorLevel } from './ErrorLevel'

export function ReportView({ job, filename }: { job: Job; filename?: string }) {
  const verdict = job.verdict!
  const v = VERDICTS[verdict.label]
  const lean = verdict.label === 'inconclusive' ? leaning(verdict.scores) : null
  const sha = job.media.sha256
  const reading = detectorReading(job)
  const summary = lean
    ? lean.key === 'authentic'
      ? leansRealSummary(job)
      : `Some evidence points to an ${lean.label} image, but not enough to decide. Treat it as unverified.`
    : v.summary
  const completed = job.analyzers.filter((a) => a.ok).length
  const evidence = job.analyzers.reduce((n, a) => n + a.findings.filter((f) => f.signal !== 'neutral').length, 0)

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Breadcrumb" className="no-print -mt-1 flex min-w-0 items-center gap-3 lg:-mt-3">
        <Link to="/history" className="icon-btn size-9" aria-label="Back to history">
          <ArrowLeft className="size-4" strokeWidth={1.8} />
        </Link>
        <p className="flex min-w-0 items-center gap-1.5 text-[14px] text-faint">
          <Link to="/history" className="shrink-0 hover:text-ink">
            History
          </Link>
          <span aria-hidden>/</span>
          {filename ? <FileName name={filename} className="font-medium text-ink" /> : <span className="font-medium text-ink">Report</span>}
        </p>
      </nav>

      {/* The image beside its verdict: one outcome, its place on the scale, one sentence, three facts. */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <figure className="panel flex min-w-0 flex-col rounded-[28px] p-2.5 lg:col-span-5">
          <div className="relative min-h-[clamp(190px,50vw,340px)] flex-1 overflow-hidden rounded-[20px] bg-[var(--frame-bg)]">
            {/* the blurred copy is glass's backdrop; on paper it would print as grey smudges */}
            <Thumb sha={sha} className="!absolute inset-0 scale-125 !bg-transparent opacity-50 blur-2xl print:hidden" />
            <img
              src={api.thumbnailUrl(sha)}
              alt={filename ? `The analyzed image, ${filename}` : 'The analyzed image'}
              className="absolute inset-0 size-full object-contain"
            />
          </div>
          <figcaption className="flex flex-wrap gap-x-2 gap-y-0.5 px-2.5 pt-3 pb-1.5 text-[12.5px] text-faint">
            <span>{formatType(job.media.mime_type)}</span>
            <span aria-hidden>·</span>
            <span>
              {job.media.width}×{job.media.height}
            </span>
            <span aria-hidden>·</span>
            <span>{formatBytes(job.media.size_bytes)}</span>
            <span aria-hidden>·</span>
            <span>{job.finished_at ? `Analyzed ${analyzedWhen(job.finished_at)}` : 'Not finished'}</span>
            <span aria-hidden>·</span>
            <span>SHA {shortHash(sha).slice(0, 8)}</span>
          </figcaption>
        </figure>

        <section className="panel rounded-[28px] p-5 sm:p-6 lg:col-span-7" aria-labelledby="verdict-title">
          <div className="flex items-center gap-3.5">
            <VerdictGlyph label={verdict.label} className="size-10 sm:size-12" />
            <div className="min-w-0">
              <p className="label">Verdict</p>
              <h1 id="verdict-title" className="print-dark text-[26px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[34px]" style={{ color: v.color }}>
                {/* Keep "AI-generated" whole; a break at the hyphen reads as a typo. */}
                {v.title.split(' ').map((word, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' '}
                    <span className="whitespace-nowrap">{word}</span>
                  </Fragment>
                ))}
              </h1>
            </div>
          </div>
          {lean && (
            <p className="mt-3 flex items-center gap-2 text-[15px] font-medium text-ink">
              <span className="size-2 rounded-full" style={{ background: lean.color }} aria-hidden />
              Leaning {lean.label}
            </p>
          )}

          <VerdictSpectrum label={verdict.label} lean={lean} className="mt-5" />
          <p className="mt-5 text-[15px] leading-relaxed text-ink">{summary}</p>

          {/* three facts in one strip, split by thin dividers */}
          <dl className="well mt-5 grid grid-cols-3 rounded-[18px] py-3">
            <Indicator label="Checks completed" value={`${completed}/${job.analyzers.length}`} />
            <Indicator label="Evidence found" value={evidence === 0 ? 'None' : String(evidence)} />
            <Indicator label="Detector score" value={reading ? String(reading.pct) : '—'} unit={reading ? '/ 100' : undefined} />
          </dl>
          {reading && (
            <p className="mt-2.5 text-[12.5px] leading-relaxed text-faint">
              The detector score is how closely the pixels resemble the AI images the model learned from. It often misses
              newer generators, so it is one signal among the checks, not the chance that this image is AI-generated.
            </p>
          )}

          <EvidenceChips job={job} verdict={verdict} />
          <Actions sha={sha} title={lean ? `${v.title}, leaning ${lean.label}` : v.title} />
        </section>
      </section>

      {/* The findings, then the weight behind each outcome and the detector's score: three in a row
          on a wide screen, the findings above the other two on a narrower one. */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
        <section className="panel rounded-[28px] p-5 sm:p-6 md:col-span-2 xl:col-span-6">
          <PanelTitle
            title="Key findings"
            status={verdict.top_reasons.length > 0 && <span className="text-[13px] text-faint tabular-nums">{verdict.top_reasons.length}</span>}
          />
          {verdict.top_reasons.length === 0 ? (
            <p className="mt-3 text-[14px] text-muted">No single finding stood out. Every check is listed under analysis details below.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {verdict.top_reasons.map((f) => (
                <FindingRow key={f.code} finding={f} />
              ))}
            </ul>
          )}
        </section>

        <section className={`panel rounded-[28px] p-5 sm:p-6 ${reading ? 'xl:col-span-3' : 'md:col-span-2 xl:col-span-6'}`}>
          <PanelTitle title="Balance of signals" />
          <EvidenceBars verdict={verdict} />
          <p className="mt-4 text-[13px] leading-relaxed text-faint">
            {decisive(verdict)
              ? 'Decided by conclusive evidence, which outweighs everything else on its own.'
              : 'Weights add up the findings for each outcome. A verdict needs enough weight and a clear lead; otherwise MetaProof says inconclusive.'}
          </p>
        </section>
        <DetectorScore job={job} className="xl:col-span-3" />
      </div>

      {verdict.label === 'inconclusive' && <NextSteps />}

      <SeenBefore sha={sha} />

      <ErrorLevel job={job} />

      <AnalysisDetails analyzers={job.analyzers} />

      <p className="px-2 text-[13px] leading-relaxed text-faint">
        MetaProof reports evidence, not absolute truth. Missing metadata or credentials are never
        counted against a file. Engine {verdict.engine_version} · pipeline {job.pipeline_version}.
      </p>
    </div>
  )
}

/** "just now", "5 hours ago", or a date as it is ("Oct 11, 2026"), to follow "Analyzed". */
function analyzedWhen(iso: string) {
  const when = formatWhen(iso)
  return /\d{4}$/.test(when) ? when : when.charAt(0).toLowerCase() + when.slice(1)
}

/** One of the verdict's three facts: a small label over its value. */
function Indicator({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0 border-l border-line px-3 first:border-l-0 sm:px-4">
      <dt className="text-[12px] leading-tight text-faint">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1">
        <span className="text-[20px] leading-none font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-[12px] text-faint">{unit}</span>}
      </dd>
    </div>
  )
}

/** Every check in full, folded away until asked for, so the verdict leads. */
function AnalysisDetails({ analyzers }: { analyzers: AnalyzerResult[] }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="flex flex-col gap-2.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="analysis-details"
        className="panel flex items-center gap-3 rounded-[22px] px-5 py-4 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Analysis details</span>
          <span className="block truncate text-[13px] text-faint" aria-hidden>
            {analyzers.map((a) => SHORT_NAME[a.analyzer] ?? a.analyzer).join(' · ')}
          </span>
        </span>
        <span className="icon-btn no-print size-9" aria-hidden>
          <ChevronDown className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {/* Always in the page, so a printed report or PDF carries every check, open or not. */}
      <div id="analysis-details" className={`animate-rise flex-col gap-2.5 print:flex ${open ? 'flex' : 'hidden'}`}>
        {analyzers.map((a) => (
          <AnalyzerPanel key={a.analyzer} result={a} />
        ))}
      </div>
    </section>
  )
}

// Phones get the system share sheet (WhatsApp, Messages, …); desktops copy the link.
const nativeShare =
  typeof navigator !== 'undefined' &&
  typeof navigator.share === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

function Actions({ sha, title }: { sha: string; title: string }) {
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
      toast.success('Link copied', { description: 'Anyone with the link can open this report.' })
    } catch {
      window.prompt('Copy this link', shareUrl)
    }
  }
  return (
    <div className="no-print mt-5 flex flex-wrap gap-2.5">
      <button type="button" onClick={share} className="btn-ghost">
        {nativeShare ? <Share2 className="size-4" strokeWidth={1.7} /> : <Link2 className="size-4" strokeWidth={1.7} />}
        {nativeShare ? 'Share report' : 'Copy share link'}
      </button>
      <button type="button" onClick={() => window.print()} className="btn-ghost">
        <Printer className="size-4" strokeWidth={1.7} /> Save as PDF
      </button>
      <Link to="/new" className="btn-primary max-sm:w-full sm:ml-auto">
        <Plus className="size-4" strokeWidth={2.4} /> Analyze another
      </Link>
    </div>
  )
}

function FindingRow({ finding }: { finding: Finding }) {
  const s = SIGNALS[finding.signal]
  return (
    <li className="flex gap-3 border-t border-line py-3.5 first:border-t-0 first:pt-2 last:pb-1">
      <SignalDot signal={finding.signal} />
      <div className="min-w-0">
        <p className="text-[15px] leading-relaxed text-ink">{finding.message}</p>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-faint">
          {s.label}
          <span className="tag">{STRENGTH_LABEL[finding.strength]}</span>
        </p>
      </div>
    </li>
  )
}

/** The outcome settled by conclusive evidence (e.g. signed Content Credentials), if any. */
function decisive(verdict: Verdict): 'authentic' | 'edited' | 'ai' | null {
  const top = verdict.top_reasons[0]
  return top?.strength === 'conclusive' && top.signal !== 'neutral' ? top.signal : null
}

/** The weight behind each outcome, as the reference's thin coloured lines with the value at the end. */
function EvidenceBars({ verdict }: { verdict: Verdict }) {
  const { scores } = verdict
  const settled = decisive(verdict)
  const rows = [
    { key: 'authentic' as const, label: 'Authentic' },
    { key: 'edited' as const, label: 'Edited' },
    { key: 'ai' as const, label: 'AI-generated' },
  ]
  const max = Math.max(3, ...rows.map((r) => scores[r.key]))
  return (
    <ul className="mt-4 flex flex-col gap-4">
      {rows.map(({ key, label }) => {
        const value = scores[key]
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between text-[14px]">
              <span className="font-medium text-muted">{label}</span>
              <span className="text-[15px] font-semibold text-ink tabular-nums">{key === settled ? 'conclusive' : value.toFixed(1)}</span>
            </div>
            <div className="bar-track relative mt-2 h-1.5 overflow-hidden rounded-full">
              <div className="animate-grow h-full origin-left rounded-full" style={{ width: `${(value / max) * 100}%`, background: SIGNALS[key].dot }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const SHORT_NAME: Record<string, string> = {
  metadata: 'Metadata',
  structure: 'Structure',
  c2pa: 'Credentials',
  watermark: 'Watermark',
  detector: 'Pixel detector',
}

// The arc's blend for each band: warm when the pixels look generated, green when they look like a camera's.
const BAND_ARC: Record<Band['key'], [string, string]> = {
  strong: ['#f7b733', '#f04e36'],
  weak: ['#f7c948', '#f59e0b'],
  unsure: ['#cfcfd6', '#a3a3ad'],
  camera: ['#8fdcb4', '#22b46e'],
}

/** The detector's score on the reference's half-ring, with a tick where it starts to count as AI evidence. */
function DetectorScore({ job, className = '' }: { job: Job; className?: string }) {
  const raw = job.analyzers.find((a) => a.analyzer === 'detector')?.raw
  const reading = detectorReading(job)
  if (!raw || !reading) return null
  const b = detectorBands(raw)
  return (
    <section className={`panel flex flex-col rounded-[28px] p-5 sm:p-6 ${className}`}>
      <PanelTitle title="Detector score" />
      <p className="mt-0.5 text-[13px] font-medium" style={{ color: reading.band.color }}>
        {reading.band.label}
      </p>
      {/* when the row is taller than this card, the gauge takes the middle of the extra height */}
      <div className="flex flex-1 items-center">
        <Gauge
          value={reading.pct / 100}
          figure={reading.pct}
          unit="/ 100"
          caption="Pixel detector"
          colors={BAND_ARC[reading.band.key]}
          ticks={[b.weak / 100]}
          label={`Detector score ${reading.pct} out of 100: ${reading.band.label.toLowerCase()}`}
          className="mx-auto my-4 w-full max-w-[250px]"
        />
      </div>
      <p className="text-[13px] leading-relaxed text-faint">
        The tick marks {Math.round(b.weak)}, where the score starts to count as AI evidence. A score is how much the pixels
        resemble AI images, not a probability; on its own it never decides the verdict.
      </p>
    </section>
  )
}

/** What supports "real" in plain words, so a lean is not mistaken for proof. */
function leansRealSummary(job: Job) {
  const codes = new Set(job.analyzers.flatMap((a) => a.findings.map((f) => f.code)))
  const traces = [
    codes.has('meta.camera_capture') && 'camera data',
    codes.has('meta.camera_original') && 'the structure of an untouched camera file',
    codes.has('detector.camera_like') && 'pixels that look like a camera photo',
  ].filter(Boolean) as string[]
  const found = traces.length
    ? `${traces.slice(0, -1).join(', ')}${traces.length > 1 ? ' and ' : ''}${traces.at(-1)}`
    : 'some signs of a real photo'
  const ai = job.verdict?.scores.ai ? 'only weak signs of AI' : 'no signs of AI'
  return `It has ${found}, and ${ai}. Nothing here proves it is unedited, such as signed Content Credentials, so treat it as probably real but unverified.`
}

const ANALYZER_META: Record<string, { title: string; icon: typeof Fingerprint; blurb: string }> = {
  metadata: { title: 'Metadata', icon: Fingerprint, blurb: 'EXIF, XMP and text chunks embedded in the file' },
  structure: { title: 'File structure', icon: Layers, blurb: 'Segments, JPEG quality and colour profile' },
  c2pa: { title: 'Content Credentials (C2PA)', icon: ShieldCheck, blurb: 'Signed provenance manifest' },
  watermark: { title: 'Invisible watermark', icon: Droplets, blurb: 'Marks hidden by Stable Diffusion tools' },
  detector: { title: 'AI-image detector', icon: Sparkles, blurb: 'CLIP features + calibrated classifier' },
}

function AnalyzerPanel({ result }: { result: AnalyzerResult }) {
  const [open, setOpen] = useState(false)
  const meta = ANALYZER_META[result.analyzer] ?? { title: result.analyzer, icon: Fingerprint, blurb: '' }
  const Icon = meta.icon
  return (
    <div className="panel rounded-[22px]">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3.5 p-4 text-left sm:px-5">
        <Icon className="size-[18px] shrink-0 text-faint" strokeWidth={1.6} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{meta.title}</p>
          <p className="truncate text-[13px] text-faint">
            {result.ok ? `${result.findings.length} finding${result.findings.length === 1 ? '' : 's'} · ${result.duration_ms} ms` : 'Analyzer error'}
            <span className="max-sm:hidden"> · {meta.blurb}</span>
          </p>
        </div>
        <ChevronDown className={`no-print size-4 text-faint transition duration-300 ease-(--ease-drawer) ${open ? 'rotate-180' : ''}`} />
      </button>
      {/* Height animates through grid rows, so the panel opens to its natural size without measuring. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-(--ease-drawer) print:grid-rows-[1fr] ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
        inert={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <div className={`mx-4 border-t border-line pt-4 pb-5 transition-opacity duration-300 sm:mx-5 print:opacity-100 ${open ? 'opacity-100' : 'opacity-0'}`}>
            {!result.ok ? (
              <p className="text-sm text-ai">{result.error}</p>
            ) : result.analyzer === 'metadata' ? (
              <MetadataDetails raw={result.raw} />
            ) : result.analyzer === 'structure' ? (
              <StructureDetails raw={result.raw} />
            ) : result.analyzer === 'c2pa' ? (
              <C2paDetails raw={result.raw} />
            ) : result.analyzer === 'watermark' ? (
              <WatermarkDetails raw={result.raw} />
            ) : result.analyzer === 'detector' ? (
              <DetectorDetails raw={result.raw} />
            ) : (
              <pre className="overflow-x-auto font-mono text-[13px] text-muted">{JSON.stringify(result.raw, null, 2)}</pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Empty fields collapse into one line, so a stripped file doesn't read as a wall of dashes.
function Fields({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined)
  const missing = rows.filter(([, v]) => v === null || v === undefined).map(([k]) => k)
  return (
    <div>
      {shown.length > 0 && (
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {shown.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[12px] text-faint">{k}</dt>
              <dd className="mt-0.5 truncate text-sm text-ink" title={typeof v === 'string' ? v : undefined}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {missing.length > 0 && (
        <p className={`text-[13px] leading-relaxed text-faint ${shown.length > 0 ? 'mt-4' : ''}`}>
          Not recorded: {missing.join(', ')}.
        </p>
      )}
    </div>
  )
}

function MetadataDetails({ raw }: { raw: Record<string, unknown> }) {
  const f = (raw.fields ?? {}) as Record<string, unknown>
  const exiftool = raw.exiftool as Record<string, unknown> | undefined
  const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
  return (
    <div className="flex flex-col gap-4">
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
          ['Maker data', f.has_exif ? (f.has_makernote ? 'Present' : 'None') : null],
          ['Recorded size', f.exif_size_matches == null ? null : f.exif_size_matches ? 'Matches the pixels' : 'Differs from the pixels'],
          ['Embedded preview', typeof f.thumbnail_similarity === 'number'
            ? `${f.thumbnail_similarity >= 0.9 ? 'Matches the picture' : 'Differs from the picture'} (${f.thumbnail_similarity.toFixed(2)})`
            : null],
        ]}
      />
      {exiftool && Object.keys(exiftool).length > 0 && (
        <details className="well group rounded-[16px]">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-muted hover:text-ink">
            All {Object.keys(exiftool).length} ExifTool tags
          </summary>
          <div className="max-h-80 overflow-auto px-4 pb-4">
            <table className="w-full font-mono text-[12px]">
              <tbody>
                {Object.entries(exiftool).map(([k, v]) => (
                  <tr key={k} className="border-t border-line">
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

type StructureSegment = { name: string; note: string | null; offset: number; length: number; count: number; kind?: string }
type StructureJpeg = {
  coding?: string
  subsampling?: string | null
  precision?: number
  scans?: number
  comments?: string[]
  quality?: { estimate: number | null; exact: boolean; fit_error?: number }
  quant_tables?: { id: number; values: number[] }[]
}
type StructureIcc = {
  description?: string | null
  manufacturer?: string | null
  model?: string | null
  color_space?: string | null
  version?: number | null
}

const STRUCTURE_UNITS: Record<string, [string, string]> = {
  segment: ['Segment', 'segments'],
  chunk: ['Chunk', 'chunks'],
  box: ['Box', 'boxes'],
}

function jpegQuality(q: StructureJpeg['quality']) {
  if (q?.estimate == null) return null
  if (q.exact) return `${q.estimate} · standard IJG tables`
  // A poor fit means the encoder has its own tables, so the number is only a rough guide.
  return `about ${q.estimate} · custom tables${(q.fit_error ?? 0) > 0.25 ? ', rough estimate' : ''}`
}

function StructureDetails({ raw }: { raw: Record<string, unknown> }) {
  const segments = (raw.segments as StructureSegment[] | undefined) ?? []
  const jpeg = raw.jpeg as StructureJpeg | undefined
  const icc = raw.icc as StructureIcc | null | undefined
  const trailing = raw.trailing_bytes as number | null | undefined
  const [unit, units] = STRUCTURE_UNITS[raw.unit as string] ?? STRUCTURE_UNITS.segment
  const str = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x))
  const rows: [string, ReactNode][] = [['Format', str(raw.format)?.toUpperCase() ?? null]]
  if (jpeg) {
    rows.push(
      ['Coding', str([jpeg.coding, jpeg.precision && jpeg.precision !== 8 ? `${jpeg.precision}-bit` : null].filter(Boolean).join(', '))],
      ['Chroma subsampling', str(jpeg.subsampling)],
      ['Estimated quality', jpegQuality(jpeg.quality)],
      ['Scans', str(jpeg.scans)],
    )
  }
  if (raw.brand) rows.push(['Brand', str(raw.brand)])
  rows.push([
    'Data after the image',
    trailing == null ? null : trailing === 0 ? 'None' : `${formatBytes(trailing)}${raw.trailing_signature ? ` (${String(raw.trailing_signature)})` : ''}`,
  ])
  rows.push(['Colour profile', icc ? (icc.description ?? 'Embedded, unnamed') : 'None'])
  if (icc) {
    rows.push(
      ['Profile maker', str([icc.manufacturer, icc.model].filter(Boolean).join(' '))],
      ['Profile colour space', str([icc.color_space, icc.version ? `ICC v${icc.version}` : null].filter(Boolean).join(' · '))],
    )
  }
  if (jpeg?.comments?.length) rows.push(['JPEG comment', jpeg.comments.join(' · ')])

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        How the file itself was written. It can show which software last saved it, but on its own it
        says nothing about whether the picture is real.
      </p>
      <Fields rows={rows} />
      {typeof raw.parse_note === 'string' && <p className="text-[13px] text-faint">{raw.parse_note}</p>}
      {segments.length > 0 && (
        <div className="well rounded-[16px]">
          <p className="px-4 pt-3 text-[13px] font-medium text-muted">
            {segments.reduce((n, s) => n + s.count, 0)} {units} in file order
            {typeof raw.segments_truncated === 'number' && `, first ${segments.length} rows shown`}
          </p>
          <div className="max-h-80 overflow-auto px-4 pb-3">
            <table className="w-full font-mono text-[12px]">
              <thead>
                <tr className="text-left text-faint">
                  <th className="py-1.5 pr-4 font-normal">{unit}</th>
                  <th className="py-1.5 pr-4 font-normal">Contents</th>
                  <th className="py-1.5 text-right font-normal">Size</th>
                </tr>
              </thead>
              <tbody>
                {segments.map((s) => (
                  <tr key={s.offset} className="border-t border-line">
                    <td className="py-1.5 pr-4 align-top whitespace-nowrap text-ink">
                      {s.name}
                      {s.count > 1 && <span className="text-faint"> ×{s.count}</span>}
                    </td>
                    <td className="py-1.5 pr-4 align-top break-all text-muted">
                      {s.note ?? (s.kind === 'private' ? 'Private chunk' : s.kind === 'unknown' ? 'Unknown chunk' : '')}
                    </td>
                    <td className="py-1.5 text-right align-top whitespace-nowrap text-muted tabular-nums">
                      {s.length ? formatBytes(s.length) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {jpeg?.quant_tables && jpeg.quant_tables.length > 0 && (
        <details className="well group rounded-[16px]">
          <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-medium text-muted hover:text-ink">
            {jpeg.quant_tables.length} quantization table{jpeg.quant_tables.length === 1 ? '' : 's'}
          </summary>
          <div className="grid gap-4 px-4 pb-4 sm:grid-cols-2">
            {jpeg.quant_tables.map((t) => (
              <div key={t.id}>
                <p className="mb-1.5 text-[12px] text-faint">Table {t.id}</p>
                <div className="grid grid-cols-8 gap-px font-mono text-[11px] text-muted tabular-nums">
                  {t.values.map((v, i) => (
                    <span key={i} className="rounded-[3px] bg-[var(--raise-bg)] py-0.5 text-center">{v}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function WatermarkDetails({ raw }: { raw: Record<string, unknown> }) {
  if (!raw.checked) {
    return <p className="text-sm text-muted">The image is too small to check for invisible watermarks.</p>
  }
  const found = raw.found as { generator: string; bits_matched: number; bits_total: number } | undefined
  const marks = (raw.marks as Record<string, number>) ?? {}
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        {found
          ? `The pixels carry the invisible watermark ${found.generator} adds to every image it generates.`
          : 'No known generator watermark. Most images have none, and resizing or recompressing an image removes it, so this is not evidence either way.'}
      </p>
      <Fields rows={Object.entries(marks).map(([name, n]) => [name, `${n} bits match`] as [string, ReactNode])} />
    </div>
  )
}

type C2paAction = { action: string; digital_source_type: string; software_agent: string | null }

function ActionList({ title, actions }: { title: string; actions: C2paAction[] }) {
  if (actions.length === 0) return null
  return (
    <div>
      <p className="text-[12px] text-faint">{title}</p>
      <ol className="mt-2 flex flex-col gap-1.5">
        {actions.map((a, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-[13px] text-faint tabular-nums">{i + 1}.</span>
            <span>{a.action}</span>
            {a.digital_source_type && <span className="text-[13px] text-muted">· {a.digital_source_type}</span>}
            {a.software_agent && <span className="text-[13px] text-faint">· {a.software_agent}</span>}
          </li>
        ))}
      </ol>
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
  const actions = (raw.actions as C2paAction[]) ?? []
  const history = (raw.history_actions as C2paAction[] | undefined) ?? []
  const failures = (raw.validation_failures as string[]) ?? []
  return (
    <div className="flex flex-col gap-4">
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
      <ActionList title="Recorded actions" actions={actions} />
      <ActionList title="Earlier history: the original it was made from" actions={history} />
    </div>
  )
}

type DetectorBands = { strong: number; weak: number; likely_real_below: number }

// Reports from before the API sent its band edges, keyed by the model that produced them.
const LEGACY_BANDS: Record<string, DetectorBands> = {
  'clip-vitb16-mlp-v1': { strong: 0.95, weak: 0.85, likely_real_below: 0.1 },
  'clip-vitb16-mlp-v3': { strong: 0.91, weak: 0.79, likely_real_below: 0.05 },
}

/** The band edges the evidence engine used for this score, as percentages. */
function detectorBands(raw: Record<string, unknown>) {
  const b = (raw.bands as DetectorBands | undefined) ??
    LEGACY_BANDS[raw.model as string] ?? LEGACY_BANDS['clip-vitb16-mlp-v1']
  return { strong: b.strong * 100, weak: b.weak * 100, real: b.likely_real_below * 100 }
}

type Band = { key: 'strong' | 'weak' | 'unsure' | 'camera'; label: string; color: string }

/** The detector's score in words, cut at the same edges the evidence engine used. */
function detectorBand(pct: number, bands: ReturnType<typeof detectorBands>): Band {
  if (pct >= bands.strong) return { key: 'strong', label: 'Strong signs of AI', color: 'var(--color-ai)' }
  if (pct >= bands.weak) return { key: 'weak', label: 'Some signs of AI', color: 'var(--color-ai)' }
  if (pct < bands.real) return { key: 'camera', label: 'Looks like a camera photo', color: 'var(--color-authentic)' }
  return { key: 'unsure', label: 'No clear signs either way', color: 'var(--color-neutral)' }
}

function detectorReading(job: Job) {
  const raw = job.analyzers.find((a) => a.analyzer === 'detector')?.raw
  if (!raw?.available || typeof raw.p_ai !== 'number') return null
  const pct = Math.round(raw.p_ai * 100)
  return { pct, band: detectorBand(pct, detectorBands(raw)) }
}

// Measured on a held-out benchmark (ml/MODEL_CARD.md): the share of each generator's images the
// detector scores above 0.5. Quoted so a low score on a new generator is not read as "real".
const KNOWN_GAP =
  'The pixel detector misses most images from the newest photorealistic generators: it catches about 1 in 5 from Google\'s Nano Banana 2 and OpenAI\'s GPT Image 2. A low score does not mean a photo is real.'

function DetectorDetails({ raw }: { raw: Record<string, unknown> }) {
  if (!raw.available || typeof raw.p_ai !== 'number') {
    return <p className="text-sm text-muted">The detector model is not loaded on this server.</p>
  }
  const pct = Math.round(raw.p_ai * 100)
  const bands = detectorBands(raw)
  const { label, color } = detectorBand(pct, bands)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[16px] font-semibold" style={{ color }}>
            {label}
          </span>
          <span className="num text-[24px] leading-none text-ink">{pct}%</span>
        </div>
        {/* ticks mark the band edges the evidence engine used */}
        <Meter
          value={pct / 100}
          color={color}
          ticks={[bands.real, bands.weak, bands.strong].map((t) => t / 100)}
          labels={['camera-like', 'unsure', 'AI']}
          className="mt-3"
        />
      </div>
      <p className="text-[13px] leading-relaxed text-faint">
        A calibrated classifier on CLIP image features, tested on generators it never saw during
        training. It is one signal among several: strong provenance evidence outweighs it, and it
        cannot detect local edits to real photos. {KNOWN_GAP}
      </p>
    </div>
  )
}

// Where the leading finding came from, named for a reader rather than by analyzer.
const SOURCE: Record<string, string> = {
  c2pa: 'signed Content Credentials',
  meta: 'file metadata',
  watermark: 'an invisible generator watermark',
  detector: 'the pixel detector',
  structure: 'the file structure',
}

/** What decided the verdict, then what the pixel detector saw, in words rather than a bare number. */
function EvidenceChips({ job, verdict }: { job: Job; verdict: Verdict }) {
  const top = verdict.top_reasons[0]
  const source = top && top.signal !== 'neutral' ? SOURCE[top.code.split('.')[0]] : undefined
  const settled = decisive(verdict)
  const reading = detectorReading(job)
  const flagsAi = reading && (reading.band.key === 'strong' || reading.band.key === 'weak')
  // The detector disagrees with a verdict that other evidence carried.
  const missedAi = verdict.label === 'likely_ai_generated' && reading && !flagsAi && source !== SOURCE.detector
  const outweighed = verdict.label === 'likely_authentic' && flagsAi
  if (!(source && verdict.label !== 'inconclusive') && !reading) return null
  return (
    <div className="mt-4 flex flex-wrap items-start gap-2">
      {/* shrink lets a chip wrap its words on the narrowest phones instead of running off the card */}
      {source && verdict.label !== 'inconclusive' && (
        <span className="chip h-auto min-h-8 min-w-0 shrink gap-2 py-1.5 text-[13px] whitespace-normal">
          <ShieldCheck className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
          <span>
            <span className="text-muted">{settled ? 'Decided by ' : 'Mainly from '}</span>
            <span className="font-semibold">{source}</span>
          </span>
        </span>
      )}
      {reading && (
        <span className="chip h-auto min-h-8 min-w-0 shrink gap-2 py-1.5 text-[13px] whitespace-normal">
          <Sparkles className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
          <span>
            <span className="text-muted">Pixel detector: </span>
            <span className="font-semibold">{reading.band.label}</span>
          </span>
        </span>
      )}
      {missedAi && <p className="max-w-lg text-[13px] leading-relaxed text-muted">{KNOWN_GAP}</p>}
      {outweighed && (
        <p className="max-w-lg text-[13px] leading-relaxed text-muted">
          The pixel detector flags this image, but stronger evidence outweighs it. It also flags some real
          photos, especially heavily filtered ones.
        </p>
      )}
    </div>
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
    <section className="panel rounded-[28px] p-5 sm:p-6">
      <PanelTitle
        title={items.length === 1 ? 'A near-identical image was analyzed before' : `${items.length} near-identical images were analyzed before`}
      />
      <p className="mt-1 text-[13px] text-faint">
        Resized, cropped or recompressed copies have a different file hash, so MetaProof also compares what the images look like.
      </p>
      <ul className="mt-3 grid gap-1 sm:grid-cols-2">
        {items.map((m) => (
          <li key={m.sha256}>
            <Link to={`/report/${m.sha256}`} className="flex items-center gap-3 rounded-[16px] p-2 transition hover:bg-[var(--raise-bg)] hover:shadow-[var(--raise-shadow)]">
              <Thumb sha={m.sha256} className="size-12 shrink-0 rounded-[12px]" />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium tabular-nums">{Math.round(m.similarity * 100)}% similar</p>
                <p className="text-[13px] text-faint">First seen {formatWhen(m.first_seen_at)}</p>
              </div>
              <VerdictBadge label={m.label} pill />
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
    <section className="panel rounded-[28px] p-5 sm:p-6">
      <div className="flex items-center gap-2.5">
        <Compass className="size-[18px] text-faint" strokeWidth={1.6} />
        <h2 className="card-title">What you can do next</h2>
      </div>
      <ol className="mt-4 grid gap-4 text-[14px] leading-relaxed text-muted md:grid-cols-3 md:gap-6">
        <li>
          <span className="font-semibold text-ink">Find the original.</span> A reverse image search shows where the
          picture appeared first and whether an older or larger version exists:
          <span className="mt-2.5 flex flex-wrap gap-2">
            {SEARCH_TOOLS.map((t) => (
              <a key={t.name} href={t.url} target="_blank" rel="noreferrer" className="chip h-8 px-3 text-[13px] hover:bg-[var(--btn-hover)]">
                {t.name} <ArrowUpRight className="size-3.5 text-faint" />
              </a>
            ))}
          </span>
        </li>
        <li>
          <span className="font-semibold text-ink">Ask for the original file.</span> Photos straight from a camera or
          phone keep more metadata, and some carry signed Content Credentials that MetaProof can verify.
        </li>
        <li>
          <span className="font-semibold text-ink">Look at the context.</span> Who posted it first, and do other
          sources show the same scene from another angle?
        </li>
      </ol>
      <p className="mt-4 text-[13px] text-faint">
        These sites open in a new tab; you upload the image there yourself. MetaProof sends them nothing.
      </p>
    </section>
  )
}
