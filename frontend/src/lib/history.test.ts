// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from './history'

const entry = (n: number): HistoryEntry => ({
  jobId: `job-${n}`,
  sha256: `${n}`.padStart(64, '0'),
  filename: `photo-${n}.jpg`,
  sizeBytes: 1000 + n,
  uploadedAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
})

const KEY = 'metaproof.history.v1'
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '[]') as HistoryEntry[]

// The module caches what it read, so each test gets a fresh copy over a fresh localStorage.
async function load() {
  vi.resetModules()
  return import('./history')
}

beforeEach(() => localStorage.clear())

describe('history', () => {
  it('puts the newest upload first and never lists a job twice', async () => {
    const h = await load()
    h.addToHistory(entry(1))
    h.addToHistory(entry(2))
    h.addToHistory({ ...entry(1), filename: 'again.jpg' })
    expect(stored().map((e) => e.jobId)).toEqual(['job-1', 'job-2'])
    expect(stored()[0].filename).toBe('again.jpg')
  })

  it('keeps at most 100 entries', async () => {
    const h = await load()
    for (let n = 0; n < 105; n++) h.addToHistory(entry(n))
    expect(stored()).toHaveLength(100)
    expect(stored()[0].jobId).toBe('job-104')
  })

  it('undoes a removal in date order, without duplicates', async () => {
    const h = await load()
    for (const n of [1, 2, 3]) h.addToHistory(entry(n))
    const removed = h.removeFromHistory('job-2')
    expect(stored().map((e) => e.jobId)).toEqual(['job-3', 'job-1'])
    h.restoreHistory([...removed, entry(3)])
    expect(stored().map((e) => e.jobId)).toEqual(['job-3', 'job-2', 'job-1'])
  })

  it('clears everything and hands back what it removed', async () => {
    const h = await load()
    h.addToHistory(entry(1))
    expect(h.clearHistory().map((e) => e.jobId)).toEqual(['job-1'])
    expect(stored()).toEqual([])
  })

  it('starts empty when the stored history is corrupted', async () => {
    localStorage.setItem(KEY, '{not json')
    const h = await load()
    h.addToHistory(entry(1))
    expect(stored().map((e) => e.jobId)).toEqual(['job-1'])
  })
})
