import { useState, type ReactNode } from 'react'
import { ArrowUpRight, ImageOff, Monitor, Moon, Sun } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, type JobStatus, type Signal, type VerdictLabel } from '../lib/api'
import { setPref, usePrefs } from '../lib/prefs'
import { PENDING, SIGNALS, VERDICTS } from '../lib/verdicts'

/** A viewfinder: four corner brackets around a lime point of focus. */
export function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" fill="var(--color-accent)" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <span className="well size-10">
        <Mark className="size-5" />
      </span>
      {!compact && <span className="text-[15px] font-bold tracking-[0.08em] uppercase">MetaProof</span>}
    </span>
  )
}

/** A frosted round arrow button for the top-right corner of a gradient card. */
export function CardArrow({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} aria-label={label} className="frost grid size-12 shrink-0 place-items-center rounded-full text-white transition">
      <ArrowUpRight className="size-5" strokeWidth={1.75} />
    </Link>
  )
}

/** Three linked orbits, the evidence map in miniature. Takes currentColor. */
export function OrbitGlyph({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 60" fill="none" stroke="currentColor" className={className} aria-hidden>
      <path d="M28 30H92" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" opacity="0.8" />
      <circle cx="28" cy="30" r="22" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" opacity="0.7" />
      <path d="M28 8a22 22 0 0 1 22 22" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="60" cy="30" r="13" strokeWidth="1.5" />
      <circle cx="92" cy="30" r="22" strokeWidth="1.5" strokeDasharray="1 5" strokeLinecap="round" opacity="0.7" />
      <path d="M92 52a22 22 0 0 1-22-22" strokeWidth="1.75" strokeLinecap="round" />
      <circle cx="28" cy="30" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="92" cy="30" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A label pill floating over the evidence map. */
function MapLabel({ children, className }: { children: ReactNode; className: string }) {
  return (
    <span className={`frost absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide text-white/90 ${className}`}>
      {children}
    </span>
  )
}

/**
 * The evidence map: the checks drawn as linked orbits on a gradient card, with a slider for the
 * AI likelihood. Decorative; with `src`, the uploaded picture sits in the middle orbit.
 */
export function EvidenceMap({
  className = '',
  src,
  title = 'Evidence map',
  to,
  mesh = 'mesh-gold',
  score = 0.62,
}: {
  className?: string
  src?: string
  title?: string
  to?: string
  mesh?: string
  score?: number
}) {
  return (
    <div className={`mesh ${mesh} flex flex-col rounded-xl p-6 sm:p-7 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <p className="text-[22px] font-medium tracking-[-0.02em]">{title}</p>
        {to && <CardArrow to={to} label="Open" />}
      </div>

      <div className="relative mt-4 aspect-[2/1] w-full" aria-hidden>
        <svg viewBox="0 0 400 200" className="absolute inset-0 size-full" fill="none" stroke="white">
          {/* links between the orbit centres */}
          <path d="M92 100 H200 H308" strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round" opacity="0.8" />
          {/* left orbit: dotted ring with a solid sweep that turns slowly */}
          <circle cx="92" cy="100" r="66" strokeWidth="1.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.7" />
          <g className="animate-orbit origin-center [transform-box:fill-box]">
            <circle cx="92" cy="100" r="66" strokeWidth="1.75" strokeDasharray="230 400" strokeLinecap="round" />
          </g>
          {/* middle orbit */}
          <circle cx="200" cy="100" r="46" strokeWidth="1.5" strokeDasharray="1 6" strokeLinecap="round" opacity="0.8" />
          <path d="M165 130 A46 46 0 0 0 235 130" strokeWidth="1.75" strokeLinecap="round" />
          {/* right orbit */}
          <circle cx="308" cy="104" r="66" strokeWidth="1.5" strokeDasharray="1 7" strokeLinecap="round" opacity="0.7" />
          <g className="animate-orbit-slow origin-center [transform-box:fill-box]">
            <circle cx="308" cy="104" r="66" strokeWidth="1.75" strokeDasharray="250 420" strokeLinecap="round" />
          </g>
          <circle cx="92" cy="100" r="3" fill="white" stroke="none" />
          <circle cx="146" cy="100" r="3" fill="white" stroke="none" />
          <circle cx="254" cy="100" r="3" fill="white" stroke="none" />
          <circle cx="308" cy="104" r="3" fill="white" stroke="none" />
        </svg>
        {/* the middle orbit holds the picture, or three bars */}
        <div className="frost absolute top-1/2 left-1/2 grid aspect-square w-[19%] -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-full">
          {src ? (
            <img src={src} alt="" className="size-full object-cover" />
          ) : (
            <span className="flex items-end gap-[3px]">
              <span className="h-3 w-[2px] rotate-12 rounded bg-white" />
              <span className="h-4 w-[2px] rotate-12 rounded bg-white" />
              <span className="h-5 w-[2px] rotate-12 rounded bg-white" />
            </span>
          )}
        </div>
        <MapLabel className="top-[22%] left-[10%]">EXIF</MapLabel>
        <MapLabel className="top-[76%] left-[30%]">C2PA</MapLabel>
        <MapLabel className="top-[16%] left-[50%]">PIXELS</MapLabel>
        <MapLabel className="top-[80%] left-[67%]">WMARK</MapLabel>
        <MapLabel className="top-[32%] left-[92%]">HASH</MapLabel>
      </div>

      {/* mt-auto pins the slider to the bottom when the card is stretched beside a taller panel */}
      <Meter value={score} className="mt-auto pt-5" onDark />
    </div>
  )
}

/**
 * A slider-style meter: a gold fill up to a triangle marker, over a dotted scale with
 * labels. `onDark` draws it in white for gradient cards.
 */
export function Meter({
  value,
  className = '',
  onDark = false,
  color,
  labels = ['0.0', '0.25', '0.5', '0.75', '1.0'],
  ticks = [],
}: {
  value: number
  className?: string
  onDark?: boolean
  color?: string
  labels?: string[]
  ticks?: number[]
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const fill = color ?? (onDark ? '#efd9a6' : 'var(--color-accent)')
  return (
    <div className={className}>
      <div className="relative h-5">
        <div className={`absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full ${onDark ? 'bg-white/30' : 'bg-line-strong'}`} />
        <div
          className="animate-grow absolute top-1/2 left-0 h-[3px] origin-left -translate-y-1/2 rounded-full"
          style={{ width: `${pct}%`, background: fill }}
        />
        {ticks.map((t) => (
          <span
            key={t}
            className={`absolute top-1/2 h-2.5 w-px -translate-y-1/2 ${onDark ? 'bg-white/60' : 'bg-faint/60'}`}
            style={{ left: `${t * 100}%` }}
          />
        ))}
        {/* triangle marker */}
        <svg
          viewBox="0 0 20 18"
          className="absolute top-1/2 size-5 -translate-x-1/2 -translate-y-[55%] drop-shadow-[0_2px_4px_rgb(0_0_0/0.25)]"
          style={{ left: `${pct}%` }}
          aria-hidden
        >
          <path d="M10 2 L18 16 H2 Z" fill="white" stroke={onDark ? '#6f5232' : 'var(--color-ink)'} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <div
        className={`mt-1 h-px bg-[length:8px_1px] bg-repeat-x ${onDark ? 'opacity-50' : 'opacity-40'}`}
        style={{ backgroundImage: `radial-gradient(circle, ${onDark ? 'white' : 'var(--color-ink)'} 0.8px, transparent 1px)` }}
      />
      <div className={`mt-2 flex justify-between text-[12px] font-medium tabular-nums ${onDark ? 'text-white/75' : 'text-faint'}`}>
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}

export function VerdictBadge({ label, status = 'done' }: { label: VerdictLabel | null; status?: JobStatus }) {
  if (status !== 'done' || !label) {
    const p = PENDING[status === 'done' ? 'queued' : status]
    return (
      <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${p.text}`}>
        <span className={`size-1.5 rounded-full bg-current ${status === 'running' || status === 'queued' ? 'animate-pulse' : ''}`} />
        {p.title}
      </span>
    )
  }
  const v = VERDICTS[label]
  if (label === 'inconclusive') {
    // Not a finding, so no pill: it should not weigh as much as a real flag beside it.
    return (
      <span className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs font-medium whitespace-nowrap text-faint">
        <span className="size-1.5 rounded-full bg-current" />
        {v.short}
      </span>
    )
  }
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap ${v.text}`}
      style={{ background: `color-mix(in srgb, ${v.color} 12%, transparent)` }}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {v.short}
    </span>
  )
}

export function SignalDot({ signal }: { signal: Signal }) {
  return <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: SIGNALS[signal].color }} aria-hidden />
}

/**
 * A file name cut in the middle: phone photos share long prefixes (IMG_2025…), so cutting the end
 * would make them all look alike. The last characters and the extension always stay visible.
 */
export function FileName({ name, className = '' }: { name: string; className?: string }) {
  const chars = Array.from(name) // code points, so an emoji or accent is never split
  const tail = chars.length > 16 ? chars.slice(-10).join('') : ''
  const head = tail ? chars.slice(0, -10).join('') : name
  return (
    <p className={`flex min-w-0 ${className}`} title={name}>
      <span className="truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </p>
  )
}

export function Thumb({ sha, className = '', blur = false }: { sha: string; className?: string; blur?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      {failed ? (
        <div className="grid size-full place-items-center text-faint">
          <ImageOff className="size-4" />
        </div>
      ) : (
        <img
          src={api.thumbnailUrl(sha)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className={`size-full object-cover transition-[filter] duration-300 ${blur ? 'scale-110 blur-xl' : ''}`}
        />
      )}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  dim,
  subtitle,
  action,
}: {
  eyebrow: string
  title: string
  dim?: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="animate-rise mb-8 flex flex-col gap-5 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-3 text-[36px] leading-[1.04] font-medium tracking-[-0.035em] sm:mt-4 sm:text-[56px] sm:leading-[1.02]">
          {title}
          {dim && (
            <>
              <br />
              <span className="text-faint">{dim}</span>
            </>
          )}
        </h1>
        {subtitle && <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted sm:mt-4 sm:text-[17px]">{subtitle}</p>}
      </div>
      {/* On phones the tab bar's centre button covers the action, so it would only repeat it. */}
      {action && <div className="no-print shrink-0 max-sm:hidden">{action}</div>}
    </header>
  )
}

/** Section heading inside a panel: a small capitals label over a short title. */
export function PanelTitle({ eyebrow, title, action }: { eyebrow: string; title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-1 text-[22px] font-medium tracking-[-0.02em]">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function ErrorPanel({
  message,
  title = 'Something went wrong',
  label = 'Error',
  children,
}: {
  message: string
  title?: string
  label?: string
  children?: ReactNode
}) {
  return (
    <div className="mesh mesh-graphite rounded-xl p-8 text-center sm:p-10">
      <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-white/80">{label}</p>
      <h1 className="mt-2 text-3xl font-medium tracking-[-0.02em]">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-white/85">{message}</p>
      {children && <div className="mt-7 flex justify-center gap-3">{children}</div>}
    </div>
  )
}

export function GithubMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/** Pill switch: a soft track with a white knob that slides right and turns the track gold. */
export function Toggle({
  checked,
  onChange,
  label,
  className = '',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  className?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-line-strong'} ${className}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-[22px] rounded-full bg-white shadow-[0_2px_6px_rgb(60_40_30/0.3)] transition-transform duration-300 ease-[var(--ease-out)] ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  )
}

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/**
 * Light / dark / system, as a row of round segments. `labels` shows the words beside the icons;
 * `stretch` fills the container with three equal segments.
 */
export function ThemeSwitch({
  labels = false,
  stretch = false,
  className = '',
}: {
  labels?: boolean
  stretch?: boolean
  className?: string
}) {
  const { theme } = usePrefs()
  return (
    <div
      className={`well gap-0.5 p-1 ${stretch ? 'flex w-full' : 'inline-flex'} ${className}`}
      role="radiogroup"
      aria-label="Colour theme"
    >
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          aria-label={labels ? undefined : label}
          title={label}
          onClick={() => setPref('theme', value)}
          className={`flex h-8 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition ${
            stretch ? 'flex-1' : labels ? 'px-3.5' : 'w-8'
          } ${theme === value ? 'selected' : 'text-faint hover:text-ink'}`}
        >
          <Icon className="size-4" strokeWidth={1.75} />
          {labels && label}
        </button>
      ))}
    </div>
  )
}

/** One tap between light and dark, for the phone top bar. */
export function ThemeToggle({ resolved }: { resolved: 'light' | 'dark' }) {
  const next = resolved === 'dark' ? 'light' : 'dark'
  const Icon = resolved === 'dark' ? Sun : Moon
  return (
    <button type="button" onClick={() => setPref('theme', next)} className="well size-10" aria-label={`Switch to ${next} theme`}>
      <Icon className="size-[18px]" strokeWidth={1.75} />
    </button>
  )
}

/** A pill-shaped on/off filter: ink when on, quiet when off. Announced as a switch. */
export function Chip({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon: typeof Sun
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition ${
        checked ? 'bg-primary text-on-primary' : 'bg-raised text-muted hover:text-ink'
      }`}
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {label}
    </button>
  )
}
