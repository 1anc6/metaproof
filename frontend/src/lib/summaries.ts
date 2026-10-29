import { createContext, useContext } from 'react'
import type { VerdictLabel } from './api'
import type { HistoryEntry } from './history'
import type { useSummaries } from './hooks'

export type Summaries = ReturnType<typeof useSummaries>

/** The verdicts of every analysis this browser remembers; filled by SummariesProvider. */
export const SummariesContext = createContext<Summaries>({ data: {}, loading: false, error: null })

export const useHistorySummaries = () => useContext(SummariesContext)

/** The verdicts in the order the sidebar's folders and the counts list them: flags first. */
export const FOLDERS: VerdictLabel[] = ['likely_ai_generated', 'edited', 'inconclusive', 'likely_authentic']

/** How many analyses landed on each verdict, and the entries behind each count, newest first. */
export function tally(history: HistoryEntry[], data: Summaries['data']) {
  const byLabel = Object.fromEntries(FOLDERS.map((l) => [l, [] as HistoryEntry[]])) as Record<VerdictLabel, HistoryEntry[]>
  for (const entry of history) {
    const label = data[entry.jobId]?.label
    if (label) byLabel[label].push(entry)
  }
  const counts = Object.fromEntries(FOLDERS.map((l) => [l, byLabel[l].length])) as Record<VerdictLabel, number>
  const flagged = counts.edited + counts.likely_ai_generated
  const known = FOLDERS.reduce((n, l) => n + counts[l], 0)
  return { byLabel, counts, flagged, known }
}
