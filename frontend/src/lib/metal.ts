import { useEffect, useSyncExternalStore } from 'react'
import { isMetalFxSupported, pauseShared, PRESETS, resumeShared, setCursorLightConfig, setSharedPresetMode } from 'metal-fx'

// The liquid metal (the metal-fx library, libraries.dev/metal). Every piece of metal on the page is
// drawn by one shared WebGL renderer, so its colour, cursor light and motion are set here for the
// whole app rather than per ring.

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
 * Whether the metal holds still: reduced motion asked for (the library itself only calms its cursor
 * light). Call it from each piece of metal: the shared renderer is made with the first piece and
 * dropped with the last, so the pause is repeated on every mount.
 */
export function useMetalStill() {
  const still = useReducedMotion()
  useEffect(() => {
    if (still) pauseShared()
    else resumeShared()
  }, [still])
  return still
}

/** The metal's colour and cursor light, set once for all the metal. */
export function useMetalSettings(theme: 'light' | 'dark') {
  const supported = isMetalFxSupported()
  useEffect(() => {
    // the metal takes the theme's tuning; the override also wins over the LIVE badge
    if (supported) setSharedPresetMode(PRESETS.chromatic.modes[theme])
  }, [supported, theme])
  useEffect(() => {
    // the ring lights the pointer itself by default; MetaProof keeps it to the ring
    setCursorLightConfig({ cursor: false })
  }, [])
}
