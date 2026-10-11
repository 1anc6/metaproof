import { useSyncExternalStore } from 'react'

// There are no accounts: each browser remembers its own uploads. The server only ever
// sees job ids, and filenames stay on this device.
export interface HistoryEntry {
  jobId: string
  sha256: string
  filename: string
  sizeBytes: number
  uploadedAt: string
}

const KEY = 'metaproof.history.v1'
const LIMIT = 100
const listeners = new Set<() => void>()
let cache: HistoryEntry[] | null = null

function read(): HistoryEntry[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    cache = Array.isArray(parsed) ? parsed : []
  } catch {
    cache = [] // storage blocked (private mode) or corrupted: start empty
  }
  return cache
}

function write(entries: HistoryEntry[]) {
  cache = entries
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    /* storage unavailable: keep the in-memory copy for this session */
  }
  listeners.forEach((l) => l())
}

export function addToHistory(entry: HistoryEntry) {
  const rest = read().filter((e) => e.jobId !== entry.jobId)
  write([entry, ...rest].slice(0, LIMIT))
}

export function removeFromHistory(jobId: string) {
  write(read().filter((e) => e.jobId !== jobId))
}

export function clearHistory() {
  write([])
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null
      listener()
    }
  }
  window.addEventListener('storage', onStorage) // keep several tabs in sync
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(subscribe, read, () => [])
}
