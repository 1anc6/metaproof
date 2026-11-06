import type { Finding, Job, Signal } from './api'

// Plain-language explanations for an inconclusive verdict: why this image landed there, and what
// each check found or did not find. Built from the findings the report already has, so nothing
// here is a new judgment; it only says in words what the engine weighed.

type Side = Exclude<Signal, 'neutral'>

/** Each finding that carries weight, as a phrase that fits "the evidence is ___". */
const PHRASE: Record<string, string> = {
  'meta.camera_capture': 'camera details in the metadata',
  'meta.camera_original': 'the structure of an untouched camera file',
  'detector.camera_like': 'pixels that look like a camera photo',
  'c2pa.signed_capture': 'signed Content Credentials recording a camera capture',
  'meta.editor_tag': 'an editing app named in the file',
  'meta.modified_after_capture': 'a modification date later than the capture date',
  'c2pa.unreadable': 'Content Credentials that could not be read',
  'c2pa.invalid': 'Content Credentials that fail validation',
  'c2pa.signed_edits': 'a signed edit history',
  'meta.iptc_ai_source': 'metadata declaring the image AI-generated',
  'meta.iptc_ai_composite': 'metadata declaring AI-generated content',
  'meta.diffusion_parameters': 'image-generator settings saved in the file',
  'meta.ai_tool_tag': 'an AI tool named in the file',
  'detector.ai_pixels': 'a high AI-detector score',
  'watermark.generator': "an AI generator's invisible watermark",
  'c2pa.ai_composite': 'signed Content Credentials declaring AI elements',
}

const TOWARD: Record<Side, string> = {
  authentic: 'a real photo',
  edited: 'an edited image',
  ai: 'an AI-generated image',
}

function phrase(f: Finding) {
  return PHRASE[f.code] ?? f.message.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())
}

/** "a", "a and b", "a, b and c" */
export function joinAnd(items: string[]) {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}

function bySide(job: Job) {
  const seen = new Set<string>()
  const sides: Partial<Record<Side, Finding[]>> = {}
  for (const f of job.analyzers.flatMap((a) => a.findings)) {
    if (f.signal === 'neutral' || seen.has(f.code)) continue
    seen.add(f.code)
    ;(sides[f.signal] ??= []).push(f)
  }
  const scores = job.verdict!.scores
  return (Object.keys(sides) as Side[])
    .sort((a, b) => scores[b] - scores[a])
    .map((side) => ({ side, findings: sides[side]! }))
}

/**
 * Why this image is inconclusive, in a sentence or two that name its own evidence. Uses the
 * engine's stated reason when the API sends one; without it, says only what was found.
 */
export function whyInconclusive(job: Job): string[] {
  const reason = job.verdict?.inconclusive_reason
  const sides = bySide(job)

  if (sides.length === 0) {
    return [
      'None of the checks found anything that points to a real photo, an edit or AI. MetaProof does not guess, so with nothing to weigh it calls the image inconclusive.',
    ]
  }

  const pointing = sides.map(
    ({ side, findings }) => `${joinAnd(findings.map(phrase))} ${findings.length > 1 ? 'point' : 'points'} to ${TOWARD[side]}`,
  )

  if (reason === 'conflicting') {
    return [
      `The evidence pulls in different directions: ${joinAnd(pointing)}.`,
      'Neither side has a clear lead, so MetaProof will not choose between them.',
    ]
  }

  if (sides.length > 1) {
    return [`The evidence is thin and mixed: ${joinAnd(pointing)}. None of it is strong enough to decide.`]
  }

  const [{ side, findings }] = sides
  const lines = [
    `The only evidence is ${joinAnd(findings.map(phrase))}, which ${findings.length > 1 ? 'together point' : 'points'} to ${TOWARD[side]} but ${findings.length > 1 ? 'are' : 'is'} too weak to decide on.`,
  ]
  if (side === 'authentic') {
    lines.push('Calling a photo real takes stronger proof, such as signed Content Credentials, because camera data is easy to fake.')
  }
  return lines
}

export type CheckState = 'found' | 'missing' | 'unclear' | 'skipped'

export interface EvidenceItem {
  key: string
  label: string
  state: CheckState
  /** Which way a found item points; neutral when it only describes the file. */
  signal: Signal
  note: string
}

/**
 * What MetaProof looked for and whether it was there. An inconclusive verdict is mostly about
 * missing evidence, which the findings list cannot show; this list does.
 */
export function evidenceChecklist(job: Job): EvidenceItem[] {
  const run = (name: string) => job.analyzers.find((a) => a.analyzer === name)
  const has = (name: string, code: string) => run(name)?.findings.find((f) => f.code === code)
  const skipped = (key: string, label: string, note = 'This check did not run on this image.'): EvidenceItem => ({
    key, label, state: 'skipped', signal: 'neutral', note,
  })

  const items: EvidenceItem[] = []

  const meta = run('metadata')
  if (!meta?.ok) items.push(skipped('camera', 'Camera metadata'))
  else if (has('metadata', 'meta.camera_capture'))
    items.push({ key: 'camera', label: 'Camera metadata', state: 'found', signal: 'authentic', note: 'Camera make, model and capture time are recorded. Easy to fake, so it counts only a little.' })
  else if (has('metadata', 'meta.stripped'))
    items.push({ key: 'camera', label: 'Camera metadata', state: 'missing', signal: 'neutral', note: 'No embedded metadata at all. Screenshots and social-media uploads remove it.' })
  else items.push({ key: 'camera', label: 'Camera metadata', state: 'missing', signal: 'neutral', note: 'No camera make, model or capture time.' })

  const c2pa = run('c2pa')
  if (!c2pa?.ok) items.push(skipped('c2pa', 'Content Credentials'))
  else {
    const f = c2pa.findings.find((x) => x.code !== 'c2pa.absent')
    items.push(
      f
        ? { key: 'c2pa', label: 'Content Credentials', state: 'found', signal: f.signal, note: f.message }
        : { key: 'c2pa', label: 'Content Credentials', state: 'missing', signal: 'neutral', note: 'No signed provenance. Most images have none.' },
    )
  }

  const mark = run('watermark')
  if (!mark?.ok) items.push(skipped('watermark', 'Generator watermark'))
  else if (has('watermark', 'watermark.too_small')) items.push(skipped('watermark', 'Generator watermark', 'Too small to check.'))
  else {
    const f = has('watermark', 'watermark.generator')
    items.push(
      f
        ? { key: 'watermark', label: 'Generator watermark', state: 'found', signal: 'ai', note: f.message }
        : { key: 'watermark', label: 'Generator watermark', state: 'missing', signal: 'neutral', note: 'None found. Resizing or recompressing removes it.' },
    )
  }

  const det = run('detector')
  const p = det?.raw?.p_ai
  if (!det?.ok || !det.raw?.available || typeof p !== 'number') items.push(skipped('detector', 'AI detector', 'Not run on this server.'))
  else {
    const score = `Score ${Math.round(p * 100)}/100`
    const [f] = det.findings
    // The lowest score on everyday copies, when the stability check ran (flagged images only).
    const lowest = (det.raw.stability as { lowest?: number } | undefined)?.lowest
    const fellTo = typeof lowest === 'number' ? Math.round(lowest * 100) : null
    items.push(
      f?.code === 'detector.ai_pixels'
        ? { key: 'detector', label: 'AI detector', state: 'found', signal: 'ai', note: `${score}: the pixels resemble AI images${fellTo === null ? '' : `, ${fellTo} or more on everyday copies`}.` }
        : f?.code === 'detector.camera_like'
          ? { key: 'detector', label: 'AI detector', state: 'found', signal: 'authentic', note: `${score}: the pixels look like a camera photo.` }
          : f?.code === 'detector.unstable'
            ? { key: 'detector', label: 'AI detector', state: 'unclear', signal: 'neutral', note: `${score}, but ${fellTo} on an everyday copy, so the flag does not hold.` }
            : { key: 'detector', label: 'AI detector', state: 'unclear', signal: 'neutral', note: `${score}: in the range where it cannot tell.` },
    )
  }

  const edits = job.analyzers.flatMap((a) => a.findings).filter((f) => f.signal === 'edited')
  items.push(
    edits.length
      ? { key: 'edits', label: 'Signs of editing', state: 'found', signal: 'edited', note: `${joinAnd(edits.map(phrase)).replace(/^./, (c) => c.toUpperCase())}.` }
      : { key: 'edits', label: 'Signs of editing', state: 'missing', signal: 'neutral', note: 'No editing app, date mismatch or broken credentials.' },
  )

  return items
}
