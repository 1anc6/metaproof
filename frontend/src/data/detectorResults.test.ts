import { describe, expect, it } from 'vitest'
import before from '../../../ml/results_robustness.json?raw'
import raw from '../../../ml/results_robustness_trim.json?raw'
import { CAPTION_BEFORE_TRIM, ROBUSTNESS, ROBUSTNESS_SAMPLE } from './detectorResults'

// The Method page quotes these; they must match what ml/eval_robustness.py measured.
const results = JSON.parse(raw)

describe('ROBUSTNESS', () => {
  it('matches ml/results_robustness_trim.json', () => {
    expect(ROBUSTNESS_SAMPLE).toEqual({ ai: results.ai, real: results.real })
    expect(ROBUSTNESS.map((r) => r.key).sort()).toEqual(Object.keys(results.variants).sort())
    for (const r of ROBUSTNESS) {
      const v = results.variants[r.key]
      expect([r.aiStrong, r.realStrong, r.aiAbove50, r.auc], r.key).toEqual([v['ai_at_strong_%'], v['real_at_strong_%'], v['ai_above_0.5_%'], v.auc])
    }
  })

  it('quotes the caption result from before border trimming', () => {
    expect(CAPTION_BEFORE_TRIM).toBe(JSON.parse(before).variants.caption_band['ai_at_strong_%'])
  })

  it('lists the unedited baseline first, then edits from least to most harmful', () => {
    expect(ROBUSTNESS[0].key).toBe('original')
    const rest = ROBUSTNESS.slice(1).map((r) => r.aiStrong)
    expect(rest).toEqual([...rest].sort((a, b) => b - a))
  })
})
