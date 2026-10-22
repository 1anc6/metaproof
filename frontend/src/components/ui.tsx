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
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_30%,#4d4d4d,#141414_70%)] text-white shadow-[0_0_0_2px_rgb(255_255_255/0.75),0_6px_14px_-4px_rgb(0_0_0/0.6),inset_0_1px_2px_rgb(255_255_255/0.3)]">
        <Mark className="size-5" />
      </span>
      {!compact && <span className="text-[16px] tracking-[-0.01em]">MetaProof</span>}
    </span>
  )
}

/** The reference's four-point sparkle, for the glowing orb. */
export function Sparkle({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M12 2.5c.5 4.6 2.4 7 7 9.5-4.6 2.5-6.5 4.9-7 9.5-.5-4.6-2.4-7-7-9.5 4.6-2.5 6.5-4.9 7-9.5Z" fill="currentColor" />
      <path d="M19.2 2.6c.2 1.5.8 2.2 2.2 2.9-1.4.7-2 1.4-2.2 2.9-.2-1.5-.8-2.2-2.2-2.9 1.4-.7 2-1.4 2.2-2.9Z" fill="currentColor" opacity="0.8" />
    </svg>
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

/** "• Diam 35 mm": a raised pill with a dot, a label and a fainter value. */
export function SpecChip({ label, value, className = '', style }: { label: string; value?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <span className={`chip ${className}`} style={style}>
      <span className="size-1.5 shrink-0 rounded-full bg-ink" aria-hidden />
      {label}
      {value !== undefined && <span className="text-[12px] text-faint">{value}</span>}
    </span>
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
 * The reference's arc gauge: a dotted arc for the whole range, a solid arc up to the value, and a
 * marked point with its label. `value` runs from 0 to 1.
 */
export function ArcGauge({
  value,
  valueLabel,
  startLabel,
  endLabel,
  className = '',
}: {
  value: number
  valueLabel: string
  startLabel?: string
  endLabel?: string
  className?: string
}) {
  const t = Math.max(0, Math.min(1, value))
  const cx = 160
  const cy = 170
  const r = 130
  const at = (f: number, rad = r) => {
    const a = ((160 - 140 * f) * Math.PI) / 180
    return [cx + rad * Math.cos(a), cy - rad * Math.sin(a)] as const
  }
  const arc = (f0: number, f1: number, rad = r) => {
    const [x0, y0] = at(f0, rad)
    const [x1, y1] = at(f1, rad)
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rad} ${rad} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
  }
  const [mx, my] = at(t)
  const [s0x, s0y] = at(0, r + 22)
  const [s1x, s1y] = at(1, r + 22)
  return (
    <svg viewBox="0 0 320 150" className={`w-full ${className}`} aria-hidden>
      <path d={arc(0, 1, r + 14)} fill="none" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" strokeDasharray="1 5" strokeLinecap="round" />
      <path d={arc(0, 1)} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 5" />
      {t > 0.005 && (
        <path d={arc(0, t)} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" className="animate-draw" />
      )}
      <circle cx={at(0)[0]} cy={at(0)[1]} r="3.5" fill="currentColor" fillOpacity="0.45" />
      <circle cx={at(1)[0]} cy={at(1)[1]} r="3.5" fill="currentColor" fillOpacity="0.45" />
      <g className="animate-rise [animation-delay:900ms]">
        <line x1={mx} y1={my - 16} x2={mx} y2={my - 6} stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx={mx} cy={my} r="6" fill="var(--color-accent)" stroke="currentColor" strokeWidth="2" />
        <text x={mx} y={my + 24} textAnchor="middle" fontSize="13" fill="currentColor">{valueLabel}</text>
      </g>
      {startLabel && <text x={s0x} y={s0y + 26} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.55">{startLabel}</text>}
      {endLabel && <text x={s1x} y={s1y + 26} textAnchor="middle" fontSize="12" fill="currentColor" fillOpacity="0.55">{endLabel}</text>}
    </svg>
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

/**
 * The reference's device view: a ringed circle with a dotted texture, its subject in the middle,
 * and spec chips floating around it.
 */
export function DeviceCircle({
  children,
  chips,
  className = '',
}: {
  children: ReactNode
  chips: { label: string; value?: ReactNode }[]
  className?: string
}) {
  // six places around the circle, top-left first, clockwise
  const SLOTS = ['left-[2%] top-[14%]', 'right-[0%] top-[6%]', 'right-[-2%] top-[52%]', 'right-[6%] bottom-[2%]', 'left-[0%] bottom-[10%]', 'left-[-2%] top-[48%]']
  return (
    <div className={`relative mx-auto aspect-square w-full max-w-[460px] ${className}`}>
      <div className="absolute inset-[12%] rounded-full border border-line-strong p-[3%]">
        <div className="relative size-full rounded-full border border-line-strong">
          {/* two dotted clusters, like the reference's perforated face */}
          <div
            className="animate-spin-slow absolute inset-[8%] rounded-full opacity-70"
            style={{
              backgroundImage: 'radial-gradient(var(--color-faint) 1.2px, transparent 1.6px)',
              backgroundSize: '12px 12px',
              maskImage: 'radial-gradient(40% 40% at 28% 30%, #000 40%, transparent 72%), radial-gradient(38% 38% at 72% 72%, #000 40%, transparent 72%)',
              WebkitMaskImage: 'radial-gradient(40% 40% at 28% 30%, #000 40%, transparent 72%), radial-gradient(38% 38% at 72% 72%, #000 40%, transparent 72%)',
            }}
            aria-hidden
          />
          <div className="absolute inset-[22%] grid place-items-center">{children}</div>
        </div>
      </div>
      {chips.slice(0, SLOTS.length).map((c, i) => (
        <SpecChip
          key={c.label}
          label={c.label}
          value={c.value}
          className={`animate-float absolute ${SLOTS[i]}`}
          style={{ animationDelay: `${i * -0.9}s` }}
        />
      ))}
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
    <div className="cream rounded-[28px] p-8 text-center sm:p-10">
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
