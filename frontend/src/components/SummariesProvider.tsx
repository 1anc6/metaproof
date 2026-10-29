import type { ReactNode } from 'react'
import { useHistory } from '../lib/history'
import { useSummaries } from '../lib/hooks'
import { SummariesContext } from '../lib/summaries'

/** Fetches the verdicts of this browser's analyses once, for the sidebar and every page. */
export function SummariesProvider({ children }: { children: ReactNode }) {
  const value = useSummaries(useHistory())
  return <SummariesContext.Provider value={value}>{children}</SummariesContext.Provider>
}
