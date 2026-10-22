import { CircleCheck, CircleHelp, PenLine, Sparkles, type LucideIcon } from 'lucide-react'
import type { VerdictLabel } from '../lib/api'
import { VERDICTS } from '../lib/verdicts'

/** A shape for each verdict, so the result never rests on colour alone. */
const ICONS: Record<VerdictLabel, LucideIcon> = {
  likely_authentic: CircleCheck,
  inconclusive: CircleHelp,
  edited: PenLine,
  likely_ai_generated: Sparkles,
}

/** The verdict's icon in a softly tinted circle. */
export function VerdictGlyph({ label, className = 'size-10' }: { label: VerdictLabel; className?: string }) {
  const Icon = ICONS[label]
  const color = VERDICTS[label].color
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full ${className}`}
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
      aria-hidden
    >
      <Icon className="size-[48%]" strokeWidth={1.75} />
    </span>
  )
}

/** The scale's segments, from a camera original to a generated image. */
const SEGMENTS: { key: VerdictLabel; label: string }[] = [
  { key: 'likely_authentic', label: 'Authentic' },
  { key: 'inconclusive', label: 'Inconclusive' },
  { key: 'edited', label: 'Edited' },
  { key: 'likely_ai_generated', label: 'AI-generated' },
]

/**
 * The verdict as a place on a segmented scale: the outcome's segment fills with its colour and its
 * label darkens; the rest stay quiet. For an inconclusive verdict that still tilts one way, a small
 * dot inside the grey segment sits toward that side. Categories only: no invented percentages.
 */
export function VerdictSpectrum({
  label,
  lean,
  className = '',
}: {
  label: VerdictLabel
  /** Which way an inconclusive verdict tilts, from `leaning()`. */
  lean?: { key: 'authentic' | 'edited' | 'ai'; label: string; color: string } | null
  className?: string
}) {
  const v = VERDICTS[label]
  return (
    <div
      role="img"
      aria-label={`${v.title}${lean ? `, leaning ${lean.label}` : ''}, on a scale from authentic to AI-generated`}
      className={className}
    >
      <div className="grid grid-cols-4 gap-1">
        {SEGMENTS.map((s) => {
          const on = s.key === label
          return (
            <span
              key={s.key}
              className="relative h-2 rounded-full transition-colors duration-500"
              style={{ background: on ? VERDICTS[s.key].color : 'var(--color-line)' }}
            >
              {on && lean && (
                <span
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--panel-bg)]"
                  style={{ left: lean.key === 'authentic' ? '12%' : '88%', background: lean.color }}
                />
              )}
            </span>
          )
        })}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1 text-[11px] leading-tight" aria-hidden>
        {SEGMENTS.map((s) => (
          <span key={s.key} className={s.key === label ? 'font-medium text-ink' : 'text-faint'}>
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
