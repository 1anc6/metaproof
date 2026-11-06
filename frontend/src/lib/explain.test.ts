import { describe, expect, it } from 'vitest'
import type { Finding, InconclusiveReason, Job } from './api'
import { evidenceChecklist, joinAnd, whyInconclusive } from './explain'

const finding = (code: string, signal: Finding['signal'], strength: Finding['strength'] = 'weak'): Finding => ({
  code, signal, strength, message: `${code} message.`,
})

function job(
  analyzers: Record<string, { findings?: Finding[]; raw?: Record<string, unknown>; ok?: boolean }>,
  scores = { authentic: 0, edited: 0, ai: 0 },
  reason: InconclusiveReason | null = 'insufficient',
): Job {
  return {
    verdict: { label: 'inconclusive', confidence: null, inconclusive_reason: reason, engine_version: 't', scores, top_reasons: [] },
    analyzers: Object.entries(analyzers).map(([analyzer, a]) => ({
      analyzer, version: '1', ok: a.ok ?? true, duration_ms: 1, error: null, findings: a.findings ?? [], raw: a.raw ?? {},
    })),
  } as unknown as Job
}

describe('joinAnd', () => {
  it('lists like a sentence', () => {
    expect(joinAnd(['a'])).toBe('a')
    expect(joinAnd(['a', 'b'])).toBe('a and b')
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

describe('whyInconclusive', () => {
  it('says plainly when nothing was found', () => {
    const [line] = whyInconclusive(job({ metadata: { findings: [finding('meta.stripped', 'neutral')] } }))
    expect(line).toMatch(/None of the checks found anything/)
  })

  it('names the weak evidence for one side, and why camera data is not enough', () => {
    const lines = whyInconclusive(
      job({ metadata: { findings: [finding('meta.camera_capture', 'authentic')] } }, { authentic: 0.5, edited: 0, ai: 0 }),
    )
    expect(lines[0]).toBe('The only evidence is camera details in the metadata, which points to a real photo but is too weak to decide on.')
    expect(lines[1]).toMatch(/signed Content Credentials/)
  })

  it('names both sides of conflicting evidence, strongest first', () => {
    const [line, tie] = whyInconclusive(
      job(
        { metadata: { findings: [finding('meta.editor_tag', 'edited', 'moderate'), finding('meta.ai_tool_tag', 'ai', 'moderate'), finding('detector.ai_pixels', 'ai')] } },
        { authentic: 0, edited: 1, ai: 1.5 },
        'conflicting',
      ),
    )
    expect(line).toBe(
      'The evidence pulls in different directions: an AI tool named in the file and a high AI-detector score point to an AI-generated image and an editing app named in the file points to an edited image.',
    )
    expect(tie).toMatch(/Neither side has a clear lead/)
  })
})

describe('evidenceChecklist', () => {
  it('says what was found, missing, unclear or not checked', () => {
    const items = evidenceChecklist(
      job({
        metadata: { findings: [finding('meta.stripped', 'neutral')] },
        c2pa: { findings: [finding('c2pa.absent', 'neutral')] },
        watermark: { findings: [finding('watermark.too_small', 'neutral')] },
        detector: { findings: [finding('detector.uncertain', 'neutral')], raw: { available: true, p_ai: 0.42 } },
      }),
    )
    const state = Object.fromEntries(items.map((i) => [i.key, i.state]))
    expect(state).toEqual({ camera: 'missing', c2pa: 'missing', watermark: 'skipped', detector: 'unclear', edits: 'missing' })
    expect(items.find((i) => i.key === 'camera')!.note).toMatch(/Screenshots and social-media uploads/)
    expect(items.find((i) => i.key === 'detector')!.note).toBe('Score 42/100: in the range where it cannot tell.')
  })

  it('says when a flag held or fell on everyday copies', () => {
    const note = (code: string, signal: Finding['signal'], lowest: number) =>
      evidenceChecklist(job({
        detector: { findings: [finding(code, signal)], raw: { available: true, p_ai: 0.96, stability: { copies: { shared: 0.95, crop_tl_70: lowest }, lowest } } },
      })).find((i) => i.key === 'detector')!
    expect(note('detector.ai_pixels', 'ai', 0.93).note).toBe('Score 96/100: the pixels resemble AI images, 93 or more on everyday copies.')
    const fell = note('detector.unstable', 'neutral', 0.33)
    expect(fell.state).toBe('unclear')
    expect(fell.note).toBe('Score 96/100, but 33 on an everyday copy, so the flag does not hold.')
  })

  it('marks checks that failed or never ran as not checked', () => {
    const items = evidenceChecklist(job({ metadata: { ok: false } }))
    expect(items.filter((i) => i.state === 'skipped').map((i) => i.key)).toEqual(['camera', 'c2pa', 'watermark', 'detector'])
  })
})
