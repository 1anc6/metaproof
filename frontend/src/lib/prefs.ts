import { useSyncExternalStore } from 'react'
import type { MetalFxPreset } from 'metal-fx'
import type { ModeOpts, OrbState } from 'thinking-orbs'

// Small per-browser switches: blurred previews, the overview's period, the rail's width, the
// colour theme, and how the thinking orbs and the liquid metal look. Storage can be
// blocked (private mode), so the in-memory copy is the source of truth and storage is only a
// best-effort mirror.
export type ThemePref = 'system' | 'light' | 'dark'
/** How far back the overview counts. */
export type Period = 'all' | 'month' | 'week'

/** How every thinking orb in the app looks and moves, tuned in Settings. */
export interface OrbPrefs {
  /** Off freezes each orb on its current frame. */
  animate: boolean
  /** Multiplier on each orb's tuned speed. */
  speed: number
  /** The ink: a #rrggbb tint, or '' for the library's monochrome. */
  tint: string
  /** Multipliers on each orb's tuned dot count and dot size. */
  dots: number
  dotSize: number
  /** How strongly the working orb draws its orbit paths, 0 to 1. */
  orbitPaths: number
  /** The orbs pull the pointer in; reach and bend are in CSS px. */
  gravity: boolean
  reach: number
  bend: number
  /** The engine's own knobs, per state, from the playground's advanced section. */
  opts: Partial<Record<OrbState, ModeOpts>>
}

/** How the liquid metal looks: the LIVE badge and the rings on the ways to add a picture. */
export interface MetalPrefs {
  /** Off freezes the metal on its current frame. */
  animate: boolean
  preset: MetalFxPreset
  /** How much metal shows, 0 to 1. */
  strength: number
  /** The wandering halo: on or off, and how bright, 0 to 1. */
  glow: boolean
  glowStrength: number
  /** Zoom into the metal's pattern; larger shows bigger features. */
  shaderScale: number
  /** Neighbouring buttons and words catch a reflection of the ring. */
  reflection: boolean
  /** The pointer dents the ring as it passes. */
  bend: boolean
  /** The ring lights a copy of the pointer as it nears. */
  cursorLight: boolean
}

export interface Prefs {
  blurPreviews: boolean
  period: Period
  /** The desktop rail shows the screens' names beside their icons. */
  railOpen: boolean
  theme: ThemePref
  orbs: OrbPrefs
  metal: MetalPrefs
}

const KEY = 'metaproof.prefs.v1'
export const ORB_DEFAULTS: OrbPrefs = {
  animate: true,
  speed: 1,
  tint: '',
  dots: 1,
  dotSize: 1,
  orbitPaths: 0.5,
  gravity: false,
  reach: 160,
  bend: 19,
  opts: {},
}
/** The library playground's own starting point: chromatic, 90%, full glow, 1.6×. */
export const METAL_DEFAULTS: MetalPrefs = {
  animate: true,
  preset: 'chromatic',
  strength: 0.9,
  glow: true,
  glowStrength: 1,
  shaderScale: 1.6,
  reflection: true,
  bend: true,
  cursorLight: false,
}
const DEFAULTS: Prefs = { blurPreviews: false, period: 'all', railOpen: false, theme: 'system', orbs: ORB_DEFAULTS, metal: METAL_DEFAULTS }
const listeners = new Set<() => void>()
let cache: Prefs | null = null

function read(): Prefs {
  if (cache) return cache
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    // the orbs' and the metal's settings arrive one at a time, so fill in any a stored copy predates
    cache = { ...DEFAULTS, ...stored, orbs: { ...ORB_DEFAULTS, ...stored.orbs }, metal: { ...METAL_DEFAULTS, ...stored.metal } }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache!
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cache = { ...read(), [key]: value }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable: keep the in-memory copy */
  }
  listeners.forEach((l) => l())
}

/** Changes some of the orbs' settings; `null` puts them all back. */
export function setOrbPrefs(patch: Partial<OrbPrefs> | null) {
  setPref('orbs', patch ? { ...read().orbs, ...patch } : ORB_DEFAULTS)
}

/** Changes some of the metal's settings; `null` puts them all back. */
export function setMetalPrefs(patch: Partial<MetalPrefs> | null) {
  setPref('metal', patch ? { ...read().metal, ...patch } : METAL_DEFAULTS)
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    read,
    () => DEFAULTS,
  )
}
