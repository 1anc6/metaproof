import { useEffect, useId, useState, type ReactNode } from 'react'
import { ImageOff, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { api, type JobStatus, type Signal, type VerdictLabel } from '../lib/api'
import { setPref, usePrefs } from '../lib/prefs'
import { PENDING, SIGNALS, VERDICTS } from '../lib/verdicts'
import { OrbText } from './ThinkingOrb'

/** A viewfinder: four corner brackets around a lime point of focus. */
export function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.4" fill="var(--color-primary)" />
    </svg>
  )
}

/** The mark beside the name, like the reference's small logo over the sidebar. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-ink">
      <Mark className="size-[26px] shrink-0" />
      {!compact && (
        <span translate="no" className="text-[17px] font-semibold tracking-[-0.015em]">
          MetaProof
        </span>
      )}
    </span>
  )
}

/** The verdict's dot, in its bright colour. */
export function VerdictDot({ label, className = 'size-2' }: { label: VerdictLabel; className?: string }) {
  return <span className={`shrink-0 rounded-full ${className}`} style={{ background: VERDICTS[label].dot }} aria-hidden />
}

/**
 * "• Off Track": a dot and a word, as the reference marks state. `pill` sets it on a small white pill,
 * for tables.
 */
export function VerdictBadge({ label, status = 'done', pill = false }: { label: VerdictLabel | null; status?: JobStatus; pill?: boolean }) {
  const shell = pill ? 'chip' : 'inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap'
  if (status !== 'done' || !label) {
    const pending = status === 'done' ? 'queued' : status
    const p = PENDING[pending]
    // still going: the working orb while it runs, the breathing one while it waits its turn
    return pending === 'failed' ? (
      <span className={`${shell} ${p.text}`}>
        <span className="size-1.5 rounded-full bg-current" />
        {p.title}
      </span>
    ) : (
      <OrbText state={pending === 'running' ? 'working' : 'breathing'} className={`${shell} ${p.text}`}>
        {p.title}
      </OrbText>
    )
  }
  const v = VERDICTS[label]
  return (
    <span className={`${shell} text-ink`}>
      <VerdictDot label={label} className="size-1.5" />
      {v.short}
    </span>
  )
}

export function SignalDot({ signal }: { signal: Signal }) {
  return <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: SIGNALS[signal].dot }} aria-hidden />
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
    <span className={`flex min-w-0 ${className}`} title={name}>
      <span className="truncate">{head}</span>
      {tail && <span className="shrink-0 whitespace-pre">{tail}</span>}
    </span>
  )
}

/** "Fingerprint      SHA-256": a label and its value on one line. Use inside a <dl>. */
export function KeyRow({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-[14px]">
      {Icon && <Icon className="size-[18px] shrink-0 text-faint" strokeWidth={1.5} aria-hidden />}
      <dt className="min-w-0 flex-1 text-muted">{label}</dt>
      <dd className="shrink-0 text-right font-medium text-ink">{value}</dd>
    </div>
  )
}

const stillMotion = () =>
  typeof window === 'undefined' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.visibilityState !== 'visible'

/** A number that counts up from zero when it appears. Shows the final value at once for reduced
 *  motion, or when the page isn't visible (animation frames would never arrive). */
export function CountUp({ to, decimals = 0, ms = 900 }: { to: number; decimals?: number; ms?: number }) {
  const [shown, setShown] = useState(0)
  const still = stillMotion()
  useEffect(() => {
    if (still) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      setShown(to * (1 - Math.pow(1 - t, 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [to, ms, still])
  return <>{(still ? to : shown).toFixed(decimals)}</>
}

/** "Steps done / 4 of 7": a label over a large light figure and its unit. */
export function Figure({ label, value, unit, className = '' }: { label: string; value: ReactNode; unit?: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="label">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="num text-[30px] leading-none">{value}</span>
        {unit && <span className="text-[13px] text-faint">{unit}</span>}
      </p>
    </div>
  )
}

/**
 * The reference's half-ring gauge ("57% / 100%"): a thick grey arc, the value drawn over it in one
 * colour or a two-stop blend, and the figure in light type under its centre. `value` runs 0 to 1.
 */
export function Gauge({
  value,
  figure,
  unit,
  caption,
  colors = ['#f5a524', '#f7c948'],
  ticks = [],
  className = '',
  label,
}: {
  value: number
  figure: ReactNode
  unit?: string
  caption?: ReactNode
  /** one colour, or the arc's start and end */
  colors?: [string, string] | [string]
  /** marks across the arc, 0 to 1: where a band starts */
  ticks?: number[]
  className?: string
  /** what the gauge measures, for screen readers */
  label: string
}) {
  const id = useId()
  const v = Math.max(0, Math.min(1, value))
  const [from, to = from] = colors
  return (
    <div className={`relative ${className}`} role="img" aria-label={label}>
      <svg viewBox="0 0 200 108" className="w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${id}-arc`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={from} />
            <stop offset="1" stopColor={to} />
          </linearGradient>
        </defs>
        <path d="M16 100 A84 84 0 0 1 184 100" fill="none" stroke="var(--track-bg)" strokeWidth="13" strokeLinecap="round" />
        {v > 0 && (
          <path
            d="M16 100 A84 84 0 0 1 184 100"
            pathLength={1}
            fill="none"
            stroke={`url(#${id}-arc)`}
            strokeWidth="13"
            strokeLinecap="round"
            strokeDasharray={`${v} 1`}
            className="animate-draw"
            style={{ strokeDashoffset: 0 }}
          />
        )}
        {ticks.map((t) => {
          const a = Math.PI * (1 - Math.max(0, Math.min(1, t)))
          const at = (r: number) => [100 + r * Math.cos(a), 100 - r * Math.sin(a)]
          const [x1, y1] = at(72)
          const [x2, y2] = at(96)
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--color-ink)" strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" />
        })}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center text-center">
        {caption && <p className="label mb-1">{caption}</p>}
        <p className="flex items-baseline gap-0.5">
          <span className="num text-[40px] leading-[0.9]">{figure}</span>
          {unit && <span className="text-[14px] text-faint">{unit}</span>}
        </p>
      </div>
    </div>
  )
}

/**
 * A track with a fill up to a marker, over labels. Kept for the detector's bands in the report
 * details, with ticks where the evidence engine cuts.
 */
export function Meter({
  value,
  className = '',
  color,
  labels = ['0.0', '0.25', '0.5', '0.75', '1.0'],
  ticks = [],
}: {
  value: number
  className?: string
  color?: string
  labels?: string[]
  ticks?: number[]
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={className}>
      <div className="relative h-4">
        <div className="bar-track absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full" />
        <div
          className="animate-grow absolute top-1/2 left-0 h-1.5 origin-left -translate-y-1/2 rounded-full"
          style={{ width: `${pct}%`, background: color ?? 'var(--color-primary)' }}
        />
        {ticks.map((t) => (
          <span key={t} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-line-strong" style={{ left: `${t * 100}%` }} />
        ))}
        <span
          className="raise absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${pct}%`, boxShadow: `0 0 0 4px color-mix(in srgb, ${color ?? 'var(--color-primary)'} 22%, transparent), var(--raise-shadow)` }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex justify-between text-meta text-faint tabular-nums">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}

/** `eager` for a picture that is the screen's main subject, so it is not held back as offscreen. */
export function Thumb({ sha, className = '', blur = false, eager = false }: { sha: string; className?: string; blur?: boolean; eager?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden bg-raised ${className}`}>
      {failed ? (
        <div className="grid size-full place-items-center text-faint">
          <ImageOff className="size-4" strokeWidth={1.5} />
        </div>
      ) : (
        <img
          src={api.thumbnailUrl(sha)}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailed(true)}
          className={`size-full object-cover transition-[filter] duration-300 ${blur ? 'scale-110 blur-xl' : ''}`}
        />
      )}
    </div>
  )
}

/** A screen's title, large and light, named like its nav item, with one line of context. */
export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="display text-[26px] leading-[1.1] sm:text-[34px]">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {/* On phones the bar's centre button already starts an analysis, so it would only repeat it. */}
      {action && <div className="no-print flex shrink-0 gap-2 max-sm:hidden">{action}</div>}
    </header>
  )
}

/** A card's header: its title, an optional status beside it, and an action on the right. */
export function PanelTitle({ title, status, action, id }: { title: ReactNode; status?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id={id} className="card-title">
          {title}
        </h2>
        {status}
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
    <div className="panel mx-auto max-w-xl rounded-3xl px-6 py-10 text-center sm:px-10">
      <p className="num text-[44px] leading-none text-faint">{label}</p>
      <h1 className="display mt-4 text-[30px] leading-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-muted">{message}</p>
      {children && <div className="mt-6 flex justify-center gap-3">{children}</div>}
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

const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

/**
 * Light / dark / system as a segmented track with a white chosen segment. `labels` shows the words
 * beside the icons; `stretch` fills the container with three equal segments.
 */
export function ThemeSwitch({ labels = false, stretch = false, className = '' }: { labels?: boolean; stretch?: boolean; className?: string }) {
  const { theme } = usePrefs()
  // with labels it fills a phone's card, where the three words don't fit side by side at their own width
  const fill = labels && !stretch
  return (
    <div
      className={`track gap-0.5 rounded-full p-1 ${stretch ? 'flex w-full' : fill ? 'flex w-full sm:inline-flex sm:w-auto' : 'inline-flex'} ${className}`}
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
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[13.5px] transition ${
            stretch ? 'flex-1' : fill ? 'flex-1 px-3 sm:flex-none sm:px-4' : 'w-9'
          } ${theme === value ? 'selected font-medium' : 'text-faint hover:text-ink'}`}
        >
          <Icon className="size-4" strokeWidth={1.6} />
          {labels && label}
        </button>
      ))}
    </div>
  )
}

/** One tap between light and dark. */
export function ThemeToggle({ resolved, className = 'size-10' }: { resolved: 'light' | 'dark'; className?: string }) {
  const next = resolved === 'dark' ? 'light' : 'dark'
  const Icon = resolved === 'dark' ? Sun : Moon
  return (
    <button type="button" onClick={() => setPref('theme', next)} className={`icon-btn ${className}`} aria-label={`Switch to ${next} theme`}>
      <Icon className="size-[17px]" strokeWidth={1.6} />
    </button>
  )
}

/** The reference's toggle: a lime track with a white knob when on. Named by `label`. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className="switch">
      <span aria-hidden />
    </button>
  )
}
