import { describe, expect, it } from 'vitest'
import { leaning } from './verdicts'

describe('leaning', () => {
  it('names the outcome with the most support', () => {
    expect(leaning({ authentic: 1.5, edited: 0.5, ai: 0 })?.key).toBe('authentic')
    expect(leaning({ authentic: 0, edited: 0, ai: 0.5 })?.label).toBe('AI-generated')
  })

  it('says nothing when there is no evidence or a tie at the top', () => {
    expect(leaning({ authentic: 0, edited: 0, ai: 0 })).toBeNull()
    expect(leaning({ authentic: 1, edited: 1, ai: 0 })).toBeNull()
  })
})
