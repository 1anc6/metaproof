import { useEffect, useSyncExternalStore } from 'react'
import {
  GLOW_DEFAULTS,
  isMetalFxSupported,
  pauseShared,
  PRESETS,
  resumeShared,
  setCursorLightConfig,
  setCursorSprite,
  setGlowConfig,
  setSharedPresetMode,
} from 'metal-fx'
import { pointerSprite } from './orbs'
import { usePrefs } from './prefs'

// The liquid metal (the metal-fx library, libraries.dev/metal). Every piece of metal on the page is
// drawn by one shared WebGL renderer, so its colour, glow, cursor light and motion are set here for
// the whole app rather than per ring.

const reduced = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null

function useReducedMotion() {
  return useSyncExternalStore(
    (l) => {
      reduced?.addEventListener('change', l)
      return () => reduced?.removeEventListener('change', l)
    },
    () => reduced?.matches ?? false,
  )
}

/**
 * Whether the metal holds still: paused in Settings, or reduced motion asked for (the library
 * itself only calms its cursor light). Call it from each piece of metal: the shared renderer is
 * made with the first piece and dropped with the last, so the pause is repeated on every mount.
 */
export function useMetalStill() {
  const { animate } = usePrefs().metal
  const reducedMotion = useReducedMotion()
  const still = !animate || reducedMotion
  useEffect(() => {
    if (still) pauseShared()
    else resumeShared()
  }, [still])
  return still
}

/** The colour, glow and cursor light chosen in Settings, applied to all the metal at once. */
export function useMetalSettings() {
  const { preset, glow, glowStrength, cursorLight } = usePrefs().metal
  const supported = isMetalFxSupported()
  useEffect(() => {
    // MetaProof's glass is dark in both themes, so the metal always takes its dark tuning; the
    // override also wins over the LIVE badge, whose own colour is fixed at chromatic
    if (supported) setSharedPresetMode(PRESETS[preset].modes.dark)
  }, [supported, preset])
  useEffect(() => {
    const g = glow ? glowStrength : 0
    setGlowConfig({ haloOpMul: GLOW_DEFAULTS.haloOpMul * g, extraIntensity: GLOW_DEFAULTS.extraIntensity * g })
  }, [glow, glowStrength])
  useEffect(() => {
    setCursorSprite(cursorLight ? pointerSprite() : null)
    setCursorLightConfig({ cursor: cursorLight })
  }, [cursorLight])
}
