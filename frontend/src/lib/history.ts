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

export function removeFromHistory(jobId: string): HistoryEntry[] {
  const removed = read().filter((e) => e.jobId === jobId)
  write(read().filter((e) => e.jobId !== jobId))
  return removed
}

export function clearHistory(): HistoryEntry[] {
  const removed = read()
  write([])
  return removed
}

/** Puts removed entries back (Undo), newest first, without duplicating any added since. */
export function restoreHistory(entries: HistoryEntry[]) {
  const current = read()
  const ids = new Set(current.map((e) => e.jobId))
  const merged = [...current, ...entries.filter((e) => !ids.has(e.jobId))]
  merged.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  write(merged.slice(0, LIMIT))
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
