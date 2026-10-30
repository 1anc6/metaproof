import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { BEND, BEND_DEFAULTS, MetalBadge, MetalFx, useMetalBend, type MetalFxReflectionTarget } from 'metal-fx'
import { useMetalStill } from '../lib/metal'
import { usePrefs } from '../lib/prefs'

const BEND_OFF = { ...BEND_DEFAULTS, enabled: false }

/**
 * A ring of liquid metal round one button or face, from libraries.dev/metal (metal-fx). The pointer
 * dents it as it passes, and the elements in `reflect` catch its light. The host keeps its own
 * shadows and focus outline. `rootRef` reaches the wrapper, for moving button and ring together.
 *
 * `bezel` stands the ring that many px out from the button, round a sliver of the glass behind it:
 * the metal's chrome reads against dark, and on MetaProof's lime and white buttons a ring at their
 * own edge reads as a grey outline. A negative margin keeps the button's place in the layout.
 */
export function MetalRing({
  variant = 'button',
  bezel = 0,
  reflect,
  rootRef,
  className,
  children,
}: {
  variant?: 'button' | 'circle'
  bezel?: number
  reflect?: MetalFxReflectionTarget[]
  rootRef?: RefObject<HTMLDivElement | null>
  className?: string
  children: ReactNode
}) {
  const m = usePrefs().metal
  const still = useMetalStill()
  const own = useRef<HTMLDivElement | null>(null)
  const bendOn = useRef(m.bend)
  useEffect(() => {
    bendOn.current = m.bend
  }, [m.bend])
  useMetalBend(own, () => (bendOn.current ? BEND : BEND_OFF))
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      own.current = el
      if (rootRef) rootRef.current = el
    },
    [rootRef],
  )
  // the scale chosen in Settings is the pill's; a circle keeps its own proportion to it
  const scale = (variant === 'circle' ? 1.3 / 1.6 : 1) * m.shaderScale
  return (
    <MetalFx
      ref={ref}
      variant={variant}
      preset={m.preset}
      theme="dark"
      strength={m.strength}
      shaderScale={scale}
      disableGlow={!m.glow}
      paused={still}
      innerShadow
      normalizeHostStyles={false}
      reflectionTargets={m.reflection ? reflect : undefined}
      className={className}
      style={bezel ? { margin: -bezel } : undefined}
    >
      {bezel ? (
        <span className="flex flex-1 rounded-full" style={{ padding: bezel }}>
          {children}
        </span>
      ) : (
        children
      )}
    </MetalFx>
  )
}

/**
 * "LIVE" on a pill of liquid metal: the library's MetalBadge, the "New" badge on libraries.dev/metal.
 * Its colour, glow and pause come from the shared settings (lib/metal.ts). The pill is for the eye;
 * `label` says the same in words for screen readers (null where words already sit beside it).
 *
 * In development only, React's double-mount leaves metal that appears after other metal blank (the
 * library draws nothing for it); production builds, which mount once, show it. So a badge missing
 * under `npm run dev` beside the phone's + is that, not a fault here.
 */
export function LiveBadge({
  label,
  reflect,
  scale = 1,
  className = '',
}: {
  label: string | null
  reflect?: MetalFxReflectionTarget[]
  scale?: number
  className?: string
}) {
  const m = usePrefs().metal
  useMetalStill()
  return (
    <span className={`metal-badge inline-flex shrink-0 ${className}`}>
      <span aria-hidden className="inline-flex">
        <MetalBadge theme="dark" scale={scale} strength={m.strength} shaderScale={m.shaderScale} reflectionTargets={m.reflection ? reflect : undefined}>
          LIVE
        </MetalBadge>
      </span>
      {label && <span className="sr-only">{label}</span>}
    </span>
  )
}
