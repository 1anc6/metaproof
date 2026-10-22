import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ImageOff, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react'
import { api, type JobStatus, type Signal, type VerdictLabel } from '../lib/api'
import { setPref, usePrefs } from '../lib/prefs'
import { PENDING, SIGNALS, VERDICTS } from '../lib/verdicts'

/** A viewfinder: four corner brackets around a lemon point of focus. */
export function Mark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    </svg>
  )
}

/** The mark on a glossy dark disc with a bright rim beside the name, like the reference's badge. */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-3 text-ink">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
        <Mark className="size-5" />
      </span>
      {!compact && <span className="text-[16px] tracking-[-0.01em]">MetaProof</span>}
    </span>
  )
}

/**
 * A slider-style meter: a fill up to a marker over a dotted scale with labels. Kept for the
 * detector's band scale in the report details.
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
  onDark?: boolean
  color?: string
  labels?: string[]
  ticks?: number[]
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className={className}>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-line-strong" />
        <div
          className="animate-grow absolute top-1/2 left-0 h-[3px] origin-left -translate-y-1/2 rounded-full"
          style={{ width: `${pct}%`, background: color ?? 'var(--color-ink)' }}
        />
        {ticks.map((t) => (
          <span key={t} className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-faint/60" style={{ left: `${t * 100}%` }} />
        ))}
        <span
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-accent"
          style={{ left: `${pct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-2 flex justify-between text-[12px] text-faint tabular-nums">
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    </div>
  )
}

/** "• Active": a status dot and a word, as the reference marks state. */
export function VerdictBadge({ label, status = 'done' }: { label: VerdictLabel | null; status?: JobStatus }) {
  if (status !== 'done' || !label) {
    const p = PENDING[status === 'done' ? 'queued' : status]
    return (
      <span className={`inline-flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap ${p.text}`}>
        <span className={`size-2 rounded-full bg-current ${status === 'running' || status === 'queued' ? 'animate-pulse' : ''}`} />
        {p.title}
      </span>
    )
  }
  const v = VERDICTS[label]
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap ${v.text}`}>
      <span className="size-2 rounded-full bg-current" />
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

/** "Signal ········ Strong": a label, a dotted leader and the value. Use inside a <dl>. */
export function LeaderRow({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-[15px]">
      {Icon && <Icon className="size-[18px] shrink-0 text-faint" strokeWidth={1.5} aria-hidden />}
      <dt className="shrink-0 text-muted">{label}</dt>
      <span className="leader" aria-hidden />
      <dd className="min-w-0 truncate text-right text-ink">{value}</dd>
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

/** A figure's value, counting up when it is a plain number like 99 or 2.0. */
function animated(value: ReactNode) {
  if (typeof value === 'number') return <CountUp to={value} decimals={Number.isInteger(value) ? 0 : 1} />
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
    return <CountUp to={Number(value)} decimals={value.split('.')[1]?.length ?? 0} />
  }
  return value
}

/** "Accuracy / 98 %": a label over a large light figure and its unit. */
export function Figure({
  label,
  value,
  unit,
  size = 'md',
  className = '',
}: {
  label: string
  value: ReactNode
  unit?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const text = size === 'lg' ? 'text-[64px] sm:text-[76px]' : size === 'sm' ? 'text-[34px]' : 'text-[48px] sm:text-[56px]'
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="text-[15px] text-muted">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className={`num leading-none ${text}`}>{animated(value)}</span>
        {unit && <span className="text-[14px] text-faint">{unit}</span>}
      </p>
    </div>
  )
}

/**
 * The reference's range ruler: fine ticks, taller marks with labels, shaded bands, and a lemon
 * marker at the value. Positions run from 0 to 100.
 */
export function RangeRuler({
  value,
  marks,
  bands = [],
  className = '',
}: {
  value: number
  marks: { at: number; label: string }[]
  bands?: { from: number; to: number; label?: string }[]
  className?: string
}) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className={className} aria-hidden>
      <div className="relative h-10">
        {bands.map((b) => (
          <span
            key={`${b.from}-${b.to}`}
            className="absolute bottom-0 h-6 rounded-sm bg-accent-soft"
            style={{ left: `${b.from}%`, width: `${b.to - b.from}%` }}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between">
          {Array.from({ length: 51 }, (_, i) => (
            <span key={i} className={`w-px ${i % 10 === 0 ? 'h-5 bg-ink/60' : 'h-2.5 bg-ink/25'}`} />
          ))}
        </div>
        <span
          className="animate-slide-to absolute bottom-0 h-9 w-[3px] -translate-x-1/2 rounded-full bg-ink"
          style={{ left: `${v}%`, '--to': `${v}%` } as CSSProperties}
        >
          <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-ink bg-accent" />
        </span>
      </div>
      <div className="relative mt-2 h-4 text-[12px] text-faint tabular-nums">
        {marks.map((m) => (
          <span key={m.at} className="absolute -translate-x-1/2" style={{ left: `${m.at}%` }}>
            {m.label}
          </span>
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
          <ImageOff className="size-4" />
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

/** A screen's title, named like its nav item, with one line of context. */
export function PageHeader({
  title,
  dim,
  subtitle,
  action,
}: {
  title: string
  dim?: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="animate-rise mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="display text-[38px] leading-none sm:text-[48px]">
          {title}
          {dim && <span className="text-faint italic"> {dim}</span>}
        </h1>
        {subtitle && <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {/* On phones the bottom bar's centre button covers the action, so it would only repeat it. */}
      {action && <div className="no-print shrink-0 max-sm:hidden">{action}</div>}
    </header>
  )
}

/** A card's title in the reference's voice: plain capitals, with an optional status and action. */
export function PanelTitle({ title, status, action }: { eyebrow?: string; title: ReactNode; status?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="eyebrow">{title}</h2>
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
    <div className="cream rounded-xl p-8 text-center sm:p-10">
      <p className="eyebrow text-faint">{label}</p>
      <h1 className="display mt-3 text-[42px] leading-none">{title}</h1>
      <p className="mx-auto mt-3 max-w-md text-[15px] text-muted">{message}</p>
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

/** Pill switch: a soft track with a white knob that slides right and turns the track lemon. */
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
      className={`track relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? '!bg-primary' : ''} ${className}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-[22px] rounded-full bg-[linear-gradient(180deg,#ffffff,#d6d6d6)] shadow-[0_2px_6px_rgb(0_0_0/0.35)] transition-transform duration-300 ease-[var(--ease-out)] ${
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
      className={`track gap-0.5 rounded-full p-1 ${stretch ? 'flex w-full' : 'inline-flex'} ${className}`}
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
          className={`flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] transition ${
            stretch ? 'flex-1' : labels ? 'px-4' : 'w-9'
          } ${theme === value ? 'selected' : 'text-faint hover:text-ink'}`}
        >
          <Icon className="size-4" strokeWidth={1.5} />
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
    <button type="button" onClick={() => setPref('theme', next)} className="well-glass size-10 lg:size-11" aria-label={`Switch to ${next} theme`}>
      <Icon className="size-[18px]" strokeWidth={1.5} />
    </button>
  )
}

/** A pill tab, like the reference's "Cholesterol / Metabolic" row: dark when on, raised when off. */
export function Chip({
  icon: Icon,
  label,
  checked,
  onChange,
}: {
  icon?: LucideIcon
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
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] transition ${
        checked ? 'selected' : 'well text-muted hover:text-ink'
      }`}
    >
      {Icon && <Icon className="size-4" strokeWidth={1.5} />}
      {label}
    </button>
  )
}
