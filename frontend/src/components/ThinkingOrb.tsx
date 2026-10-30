import type { ReactNode } from 'react'
import { ThinkingOrb as Orb, type ModeFrame, type OrbSize, type OrbState } from 'thinking-orbs'
import { fingerprint } from '../lib/orbs'

/**
 * A thinking orb from libraries.dev (the thinking-orbs library): a dotted sphere whose motion says
 * what MetaProof is doing. MetaProof's glass is dark in both themes, so the ink is always light.
 * With `label` the orb is an image of that name; without one it is decoration beside words that
 * already say what is happening. Reduced motion holds it on one frame; offscreen and in a hidden
 * tab it stops drawing.
 */
export function ThinkingOrb({
  state,
  size = 32,
  label,
  frame,
  className,
}: {
  state: OrbState
  size?: OrbSize
  label?: string
  /** geometry of MetaProof's own in place of the state's, such as the fingerprint */
  frame?: ModeFrame
  className?: string
}) {
  return (
    <Orb
      state={state}
      size={size}
      theme="dark"
      frame={frame}
      aria-label={label}
      {...(!label && { role: 'presentation', 'aria-hidden': true })}
      data-orb={frame === fingerprint ? 'fingerprint' : state}
      className={className}
    />
  )
}

/** Words with an orb at their size before them, like "Loading verdicts…" or a row still analyzing. */
export function OrbText({ state, children, className = '' }: { state: OrbState; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <ThinkingOrb state={state} size={20} className="-my-1 -ml-0.5 shrink-0" />
      {children}
    </span>
  )
}

/** The orb on a tile beside what is happening, like "Reading metadata…". Announced politely. */
export function ThinkingPill({ label, state, frame, className = '' }: { label: string; state: OrbState; frame?: ModeFrame; className?: string }) {
  return (
    <span role="status" className={`well inline-flex items-center gap-3 rounded-[18px] py-1.5 pr-4 pl-1.5 ${className}`}>
      <span className="raise grid size-10 shrink-0 place-items-center rounded-[13px]">
        <ThinkingOrb state={state} frame={frame} size={32} />
      </span>
      <span className="min-w-0 text-[14.5px] leading-snug font-medium text-ink">{label}</span>
    </span>
  )
}
