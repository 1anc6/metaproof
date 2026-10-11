import type { JobStatus, Signal, Strength, VerdictLabel } from './api'

export interface VerdictStyle {
  title: string
  short: string
  summary: string
  /** Tailwind text colour class */
  text: string
  /** CSS colour for bars and glows */
  color: string
}

export const VERDICTS: Record<VerdictLabel, VerdictStyle> = {
  likely_authentic: {
    title: 'Likely authentic',
    short: 'Authentic',
    summary: 'Strong provenance evidence points to an unedited original.',
    text: 'text-authentic',
    color: 'var(--color-authentic)',
  },
  edited: {
    title: 'Edited',
    short: 'Edited',
    summary: 'The evidence shows this file was changed after it was created.',
    text: 'text-edited',
    color: 'var(--color-edited)',
  },
  likely_ai_generated: {
    title: 'Likely AI-generated',
    short: 'AI-generated',
    summary: 'The evidence points to an image made by a generative AI tool.',
    text: 'text-ai',
    color: 'var(--color-ai)',
  },
  inconclusive: {
    title: 'Inconclusive',
    short: 'Inconclusive',
    summary:
      'There is not enough evidence to decide. That is common: most images carry no provenance data.',
    text: 'text-neutral',
    color: 'var(--color-neutral)',
  },
}

export const PENDING: Record<Exclude<JobStatus, 'done'>, { title: string; text: string }> = {
  queued: { title: 'Queued', text: 'text-muted' },
  running: { title: 'Analyzing', text: 'text-ink' },
  failed: { title: 'Failed', text: 'text-ai' },
}

export const SIGNALS: Record<Signal, { label: string; color: string }> = {
  authentic: { label: 'Supports authentic', color: 'var(--color-authentic)' },
  edited: { label: 'Suggests editing', color: 'var(--color-edited)' },
  ai: { label: 'Suggests AI', color: 'var(--color-ai)' },
  neutral: { label: 'Neutral', color: 'var(--color-neutral)' },
}

export const STRENGTH_LABEL: Record<Strength, string> = {
  weak: 'Weak',
  moderate: 'Moderate',
  strong: 'Strong',
  conclusive: 'Conclusive',
}

const LEAN_LABEL = { authentic: 'authentic', edited: 'edited', ai: 'AI-generated' } as const
const LEAN_COLOR = { authentic: 'var(--color-authentic)', edited: 'var(--color-edited)', ai: 'var(--color-ai)' } as const

/**
 * For an inconclusive verdict, which way the evidence tilts (if any). The engine still said
 * "not enough to decide"; this only tells the reader which outcome had the most support.
 */
export function leaning(scores: Record<'authentic' | 'edited' | 'ai', number>) {
  const ranked = (Object.keys(scores) as (keyof typeof scores)[]).sort((a, b) => scores[b] - scores[a])
  const [top, second] = ranked
  if (scores[top] <= 0 || scores[top] === scores[second]) return null
  return { key: top, label: LEAN_LABEL[top], color: LEAN_COLOR[top] }
}
