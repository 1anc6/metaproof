import { useEffect } from 'react'
import {
  countDots,
  finalizeFrame,
  hashD,
  lerp,
  MODE_DRAWS,
  radiusScale,
  resolvePreset,
  scaleCounts,
  setGravityConfig,
  setGravitySprite,
  vnoise,
  type CursorSprite,
  type Dot,
  type ModeFrame,
  type OrbSize,
  type OrbState,
} from 'thinking-orbs'
import { usePrefs } from './prefs'

// The thinking orbs (the thinking-orbs library, libraries.dev/orbs): which orb shows which moment,
// the tints and engine knobs the Settings playground offers, MetaProof's own fingerprint orb, the
// pointer that cursor gravity draws, and the orb in the tab's icon while an analysis runs.

export interface OrbMeaning {
  state: OrbState
  name: string
  /** What the orb's pill says while it runs. */
  label: string
  meaning: string
  /** MetaProof's own geometry in place of the state's (the fingerprint). */
  frame?: ModeFrame
}

/**
 * MetaProof's own orb, for "File received and hashed": the ridges of a fingerprint, read by a scan
 * line that runs down the print and back. It takes the working orb's knobs, so the dot count, dot
 * size, orbit paths and speed chosen in Settings tune it like every other orb.
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

/** The nine orbs, in the order a file meets them, then MetaProof's own. */
export const ORB_GUIDE: OrbMeaning[] = [
  { state: 'breathing', name: 'Breathing', label: 'Waiting in the queue…', meaning: 'Waiting: the server is waking up, or your file is next in line.' },
  { state: 'working', name: 'Working', label: 'Uploading your image…', meaning: 'Your file is on its way to the server.' },
  { state: 'searching', name: 'Searching', label: 'Reading metadata…', meaning: 'Reading the EXIF and XMP the file carries, or looking up your verdicts.' },
  { state: 'shaping', name: 'Shaping', label: 'Inspecting the file structure…', meaning: "Walking the file's segments, tables and colour profile." },
  { state: 'connecting', name: 'Connecting', label: 'Checking Content Credentials…', meaning: 'Following the chain of signatures in a C2PA manifest, or reaching the server.' },
  { state: 'listening', name: 'Listening', label: 'Looking for invisible watermarks…', meaning: 'Listening for a message a generator hid in the pixels.' },
  { state: 'solving', name: 'Solving', label: 'Running the AI-image detector…', meaning: 'The classifier works through every pixel.' },
  { state: 'weaving', name: 'Weaving', label: 'Weighing the evidence…', meaning: 'Metadata, credentials and pixels are plaited into one verdict.' },
  { state: 'composing', name: 'Composing', label: 'Computing error levels…', meaning: 'Your browser re-saves the image to show its error levels, or lays out a report.' },
  { state: 'working', frame: fingerprint, name: 'Fingerprint', label: 'File received and hashed…', meaning: "MetaProof's own orb: the file's SHA-256 fingerprint is taken." },
]

/** Ink tints for the orbs. '' is the library's own monochrome ink, the default: light on MetaProof's
 *  glass, like its type, where a tint's darker far side sinks into the warm brown. */
export const TINTS = [
  { value: '', name: 'Mono' },
  { value: '#b4d055', name: 'Lime' },
  { value: '#ecd5ab', name: 'Champagne' },
  { value: '#79dcae', name: 'Mint' },
  { value: '#ff9478', name: 'Coral' },
  { value: '#9cc4ff', name: 'Sky' },
]

export interface Knob {
  key: string
  label: string
  min: number
  max: number
  step: number
}

const RIBBON: Knob[] = [
  { key: 'bandMul', label: 'Bands', min: 1, max: 8, step: 0.1 },
  { key: 'wobMul', label: 'Wobble', min: 0, max: 3, step: 0.05 },
  { key: 'spin', label: 'Spin', min: 0, max: 2, step: 0.05 },
]

/** The engine's own knobs each state reads (its `opts`), for the playground's advanced section.
 *  Solving and listening have none; the working orb's orbit paths have a slider of their own. */
export const KNOBS: Partial<Record<OrbState, Knob[]>> = {
  working: [{ key: 'particles', label: 'Particles per orbit', min: 1, max: 8, step: 1 }],
  searching: [
    { key: 'scanMul', label: 'Scan brightness', min: 1, max: 8, step: 0.1 },
    { key: 'dimBase', label: 'Unscanned dots', min: 0, max: 1, step: 0.05 },
  ],
  connecting: [
    { key: 'thr', label: 'Link distance', min: 0.3, max: 1.2, step: 0.02 },
    { key: 'signals', label: 'Signals', min: 0, max: 12, step: 1 },
    { key: 'lineW', label: 'Line width', min: 0.2, max: 2, step: 0.1 },
    { key: 'spread', label: 'Spread', min: 0.6, max: 1.4, step: 0.02 },
  ],
  weaving: [{ key: 'turns', label: 'Turns', min: 1, max: 6, step: 0.5 }],
  composing: RIBBON,
  breathing: RIBBON,
  shaping: [{ key: 'spread', label: 'Spread', min: 0.8, max: 2, step: 0.05 }],
}

/** The shapes the shaping orb can hold instead of cycling through them (its `shape` knob). */
export const SHAPES = [
  { value: undefined, name: 'Cycle' },
  { value: 0, name: 'Circle' },
  { value: 1, name: 'Triangle' },
  { value: 2, name: 'Square' },
]

/** A knob's tuned value for a state and size, before anything chosen in Settings. */
export function tunedValue(state: OrbState, size: OrbSize, key: string) {
  return resolvePreset(state, size).opts[key]
}

/** How many dots an orb draws, counted the way the library's playground counts them; for geometry
 *  of MetaProof's own, the dots it actually draws. */
export function dotCount(state: OrbState, size: OrbSize, dots: number, frame?: ModeFrame) {
  const { opts } = resolvePreset(state, size)
  const scaled = dots !== 1 ? scaleCounts(opts, Math.max(0.1, dots)) : opts
  if (frame) return frame(size, 0, scaled).dots.length
  // the shaping orb's outline has a density rather than a count; the engine turns it into dots so
  return state === 'shaping' ? Math.max(6, Math.round(34 * (scaled.iconD ?? 1))) : countDots(scaled)
}

/**
 * A raster of the platform's arrow pointer, which cursor gravity draws bent toward an orb: on a Mac
 * a black arrow with a white edge, elsewhere Windows' white arrow with a black edge. It is drawn
 * here at the screen's pixel ratio, so a customised pointer (larger, or another colour) won't match.
 */
export function pointerSprite(): CursorSprite | null {
  const dpr = window.devicePixelRatio || 1
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const pad = 2
  const width = 13 + pad * 2
  const height = 20 + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.scale(dpr, dpr)
  ctx.translate(pad + 0.5, pad + 0.5) // half a pixel in, so a 1px edge lands on whole pixels
  const arrow = new Path2D('M0 0V16.6L4 12.8L6.8 19.2L9.3 18.1L6.6 11.8H11.9Z')
  ctx.lineJoin = 'round'
  if (mac) {
    // the white edge carries the soft shadow; the black body covers its inner half
    ctx.shadowColor = 'rgb(0 0 0 / 0.35)'
    ctx.shadowBlur = 2
    ctx.shadowOffsetY = 1
    ctx.lineWidth = 1.6
    ctx.strokeStyle = '#fff'
    ctx.stroke(arrow)
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = '#000'
    ctx.fill(arrow)
  } else {
    ctx.fillStyle = '#fff'
    ctx.fill(arrow)
    ctx.lineWidth = 1
    ctx.strokeStyle = '#000'
    ctx.stroke(arrow)
  }
  return { src: canvas.toDataURL('image/png'), width: canvas.width / dpr, height: canvas.height / dpr, hotX: pad, hotY: pad }
}

/** Cursor gravity for the whole app: the pointer raster while it is on, and the reach and bend
 *  chosen in Settings, which tune every orb's pull at once. */
export function useOrbGravity() {
  const { gravity, reach, bend } = usePrefs().orbs
  useEffect(() => {
    setGravitySprite(gravity ? pointerSprite() : null)
  }, [gravity])
  useEffect(() => {
    setGravityConfig({ reach, deform: bend })
  }, [reach, bend])
}

/**
 * While `state` is set, the tab's icon is that orb, redrawn a few times a second, so an analysis can
 * be followed from another tab; then the logo comes back. Drawn in grey for the browser's own theme.
 */
export function useOrbFavicon(state: OrbState | null) {
  const { animate } = usePrefs().orbs
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
    const still = !animate || matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = still ? undefined : setInterval(paint, 250)
    return () => {
      clearInterval(timer)
      link.type = type
      link.href = href
    }
  }, [state, animate])
}
