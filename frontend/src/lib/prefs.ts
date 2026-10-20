import { useSyncExternalStore } from 'react'

// Small per-browser switches from the overview. Storage can be blocked (private mode), so the
// in-memory copy is the source of truth and storage is only a best-effort mirror.
export interface Prefs {
  blurPreviews: boolean
  onlyFlagged: boolean
}

const KEY = 'metaproof.prefs.v1'
const DEFAULTS: Prefs = { blurPreviews: false, onlyFlagged: false }
const listeners = new Set<() => void>()
let cache: Prefs | null = null

function read(): Prefs {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
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
