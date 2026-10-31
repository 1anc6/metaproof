import { describe, expect, it } from 'vitest'
import type { JobSummary } from './api'
import type { HistoryEntry } from './history'
import { tally } from './summaries'

const entry = (jobId: string): HistoryEntry => ({ jobId, sha256: jobId, filename: `${jobId}.jpg`, sizeBytes: 1, uploadedAt: '' })
const summary = (label: JobSummary['label']) => ({ label }) as JobSummary

describe('tally', () => {
  it('counts each verdict and the flagged ones, skipping unfinished jobs', () => {
    const history = ['a', 'b', 'c', 'd', 'e'].map(entry)
    const data = {
      a: summary('likely_ai_generated'),
      b: summary('edited'),
      c: summary('likely_authentic'),
      d: summary(null), // still running
      // e: not known to the server any more
    }
    const { counts, flagged, known, byLabel } = tally(history, data)
    expect(counts).toEqual({ likely_ai_generated: 1, edited: 1, inconclusive: 0, likely_authentic: 1 })
    expect(flagged).toBe(2)
    expect(known).toBe(3)
    expect(byLabel.edited.map((e) => e.jobId)).toEqual(['b'])
  })
})
