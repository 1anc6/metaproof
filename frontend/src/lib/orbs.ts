import { useEffect } from 'react'
import {
  finalizeFrame,
  hashD,
  lerp,
  MODE_DRAWS,
  radiusScale,
  resolvePreset,
  vnoise,
  type Dot,
  type ModeFrame,
  type OrbState,
} from 'thinking-orbs'

// The thinking orbs (the thinking-orbs library, libraries.dev/orbs): MetaProof's own fingerprint
// orb, and the orb in the tab's icon while an analysis runs.

/**
 * MetaProof's own orb, for "File received and hashed": the ridges of a fingerprint, read by a scan
 * line that runs down the print and back. It takes the working orb's knobs, so its dots scale with
 * the orb's size as that orb's do.
 */
export const fingerprint: ModeFrame = (size, t, o) => {
  const c = size / 2
  const R = c * 0.84
  const rs = radiusScale(size, o.rsPow ?? 0.6)
  const ridges = size >= 64 ? 8 : size >= 32 ? 6 : 4
  // Dots sit closer along a ridge than the ridges sit apart, or the eye joins them into spokes.
  const density = (o.ghostN ?? 40) * 2.6
  const rest = 0.35 + 0.5 * (o.ghostA ?? 0.5) // how clear a ridge is away from the scan line
  const scanY = lerp(-1.1, 1.1, 0.5 - 0.5 * Math.cos(t * 0.9))
  const dots: Dot[] = []
  for (let k = 0; k < ridges; k++) {
    const f = (k + 0.7) / (ridges + 0.2)
    const n = Math.max(8, Math.round(density * f))
    const start = hashD(k, 1.1) // each ridge starts somewhere else, so no dots line up across them
    const lift = (1 - f) * 0.18 // inner ridges sit higher: a loop rather than a target
    for (let i = 0; i < n; i++) {
      if (hashD(k * 7.1 + Math.floor(i / 5), 3.3) < 0.1) continue // ridges break now and then, as real ones do
      const a = ((i + start) / n) * Math.PI * 2
      const wobble = 1 + 0.1 * (vnoise(Math.cos(a) * 1.6 + k * 0.37, Math.sin(a) * 1.6 + 2.1) - 0.5)
      const y = Math.sin(a) * f * wobble - lift
      const glow = Math.max(0, 1 - Math.abs(y - scanY) / 0.24) ** 2
      dots.push({
        x: c + Math.cos(a) * f * 0.8 * wobble * R,
        y: c + y * R,
        z: glow,
        r: (o.partR ?? 1.2) * rs * (1.5 + 1.3 * glow),
        white: 0.42 - 0.34 * glow,
        a: lerp(rest, 1, glow),
      })
    }
  }
  return finalizeFrame(dots, [], o.rMin)
}

/**
 * While `state` is set, the tab's icon is that orb, redrawn a few times a second, so an analysis can
 * be followed from another tab; then the logo comes back. Drawn in grey for the browser's own theme.
 */
export function useOrbFavicon(state: OrbState | null) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const ctx = document.createElement('canvas').getContext('2d')
    if (!state || !link || !ctx) return
    const { href, type } = link
    ctx.canvas.width = ctx.canvas.height = 32
    const { mode, speed, opts } = resolvePreset(state, 32)
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const paint = () => {
      ctx.clearRect(0, 0, 32, 32)
      MODE_DRAWS[mode](ctx, 32, (performance.now() / 1000) * speed, dark, opts)
      link.type = 'image/png'
      link.href = ctx.canvas.toDataURL('image/png')
    }
    paint()
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = still ? undefined : setInterval(paint, 250)
    return () => {
      clearInterval(timer)
      link.type = type
      link.href = href
    }
  }, [state])
}
