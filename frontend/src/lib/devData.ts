import type { JobStatus, JobSummary, VerdictLabel } from './api'
import type { HistoryEntry } from './history'

// Development only: swaps the history list and its verdicts for fixed datasets, so the lists can be
// checked against realistic worst-case data. Chosen with ?data=worst|empty|one|max (kept for the
// tab in sessionStorage, since the History filters rewrite the query string). Never active in a
// production build: import.meta.env.DEV is false there and the whole module is dead code.

export type DevDataMode = 'off' | 'worst' | 'empty' | 'one' | 'max'
export const DEV_DATA_MODES: { key: DevDataMode; label: string }[] = [
  { key: 'off', label: 'Real data' },
  { key: 'worst', label: 'Worst case' },
  { key: 'empty', label: 'Empty' },
  { key: 'one', label: 'One' },
  { key: 'max', label: '100 rows' },
]

const SESSION_KEY = 'metaproof.devData'
const listeners = new Set<() => void>()
const now = Date.now()
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString()
const hex = (seed: number) => (seed.toString(16).padStart(8, '0') + 'a1b2c3d4').repeat(4).slice(0, 64)

type Row = [filename: string, sizeBytes: number, minutesAgo: number, label: VerdictLabel | null, status: JobStatus]

// Each row carries a different failure, as real data does.
const WORST_ROWS: Row[] = [
  ['IMG_20250914_183022_HDR_portrait_edited_edited_edited_final.HEIC', 25 * 1024 * 1024, 0, 'likely_ai_generated', 'done'],
  ['Q3 Board Deck — FINAL (revised) v12 [approved by legal] screenshot.png', 1_048_575, 3, 'edited', 'done'],
  ['a.jpg', 1, 59, 'likely_authentic', 'done'],
  ['Снимок экрана 2026-10-01 в 14.32.07.png', 7_340_032, 60 * 23, null, 'running'],
  ['스크린샷 2026-09-30 오후 3.12.44.png', 532_481, 60 * 24 * 6, null, 'queued'],
  ['ЗображенняДляПеревіркиАвтентичностіЗгенерованеШтучнимІнтелектом.webp', 2_400_000, 60 * 24 * 8, null, 'failed'],
  ['<b>bold</b> &amp; "quotes".jpg', 88_000, 60 * 24 * 400, 'inconclusive', 'done'],
  ['Q3 Board Deck — FINAL (revised) v12 [approved by legal] screenshot.png', 1_048_575, 60 * 24 * 401, 'likely_ai_generated', 'done'],
]

function build(rows: Row[]): { entries: HistoryEntry[]; summaries: Record<string, JobSummary> } {
  const entries = rows.map(([filename, sizeBytes, minutes], i) => ({
    jobId: `dev-job-${i}`,
    sha256: hex(i + 1),
    filename,
    sizeBytes,
    uploadedAt: ago(minutes),
  }))
  const summaries = rows.map(([, sizeBytes, minutes, label, status], i) => ({
    job_id: `dev-job-${i}`,
    status,
    sha256: hex(i + 1),
    mime_type: 'image/jpeg',
    size_bytes: sizeBytes,
    width: 4032,
    height: 3024,
    label,
    confidence: label ? 0.9 : null,
    created_at: ago(minutes),
    finished_at: status === 'done' ? ago(minutes) : null,
  }))
  return { entries, summaries: Object.fromEntries(summaries.map((s) => [s.job_id, s])) }
}

const LABELS: VerdictLabel[] = ['likely_ai_generated', 'edited', 'likely_authentic', 'inconclusive']
const FIXTURES: Record<Exclude<DevDataMode, 'off'>, ReturnType<typeof build>> = {
  worst: build(WORST_ROWS),
  empty: build([]),
  one: build([['photo.jpg', 2_048_000, 1, 'likely_ai_generated', 'done']]),
  // The history list keeps at most 100 entries (LIMIT in history.ts), so 100 is the real maximum.
  max: build(
    Array.from({ length: 100 }, (_, i): Row => [`IMG_${String(4000 + i)}.JPG`, 3_000_000 + i * 997, i * 90, LABELS[i % 4], 'done']),
  ),
}

export function devDataMode(): DevDataMode {
  if (!import.meta.env.DEV) return 'off'
  const fromUrl = new URLSearchParams(location.search).get('data')
  const mode = fromUrl ?? sessionStorage.getItem(SESSION_KEY) ?? 'off'
  return mode in FIXTURES ? (mode as DevDataMode) : 'off'
}

export function setDevDataMode(mode: DevDataMode) {
  sessionStorage.setItem(SESSION_KEY, mode)
  const url = new URL(location.href)
  if (mode === 'off') url.searchParams.delete('data')
  else url.searchParams.set('data', mode)
  history.replaceState(history.state, '', url)
  listeners.forEach((l) => l())
}

export function subscribeDevData(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function devFixture() {
  const mode = devDataMode()
  return mode === 'off' ? null : FIXTURES[mode]
}
