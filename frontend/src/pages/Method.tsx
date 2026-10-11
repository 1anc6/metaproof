import { Fingerprint, Layers, Scale, ShieldCheck, Sparkles } from 'lucide-react'
import { PageHeader } from '../components/ui'

const LAYERS = [
  {
    icon: Fingerprint,
    name: 'Metadata',
    status: 'Live',
    text: 'Reads EXIF, XMP and PNG text chunks. Generator settings left by Stable Diffusion tools, the IPTC "AI-generated" source type, editor software tags and camera capture data all become findings. Camera data is weak evidence because it is easy to forge.',
  },
  {
    icon: ShieldCheck,
    name: 'Content Credentials (C2PA)',
    status: 'Live',
    text: 'Validates signed provenance manifests with the official C2PA SDK. A valid manifest that declares AI generation settles the verdict; a broken signature means the file changed after signing. A valid signature proves who signed and that nothing changed since, not that the scene is real.',
  },
  {
    icon: Layers,
    name: 'Invisible watermark',
    status: 'In progress',
    text: 'Detects TrustMark watermarks, which survive re-saving and some edits, so provenance can be recovered after metadata is stripped.',
  },
  {
    icon: Sparkles,
    name: 'AI detector',
    status: 'In progress',
    text: 'A small classifier on top of frozen CLIP image features. Foundation-model features generalize better to new generators than a network trained from scratch, and the score is calibrated so 80% means roughly 80%.',
  },
]

const RULES = [
  'Hard evidence first: a signed AI-generation claim decides the verdict on its own.',
  'Absence is neutral: no metadata or no credentials never counts against a file.',
  'Every finding has a weight. A verdict needs enough weight and a clear lead over the alternatives.',
  'Otherwise the answer is inconclusive. Saying "we don\'t know" is better than guessing.',
]

export function Method() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow="Method"
        title="Evidence, not guesses."
        subtitle="MetaProof combines independent checks and shows its working. It never claims absolute truth."
      />

      <section className="flex flex-col gap-3">
        {LAYERS.map(({ icon: Icon, name, status, text }) => (
          <article key={name} className="glass animate-rise flex gap-4 rounded-3xl p-5">
            <span className="glass grid size-11 shrink-0 place-items-center rounded-2xl">
              <Icon className="size-5" strokeWidth={1.5} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display font-semibold">{name}</h2>
                <span
                  className={`rounded-full px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
                    status === 'Live' ? 'bg-authentic/10 text-authentic' : 'bg-white/5 text-faint'
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="glass animate-rise mt-6 rounded-3xl p-6">
        <div className="flex items-center gap-3">
          <Scale className="size-5" strokeWidth={1.5} />
          <h2 className="font-display text-lg font-semibold">How the verdict is decided</h2>
        </div>
        <ol className="mt-4 flex flex-col gap-3">
          {RULES.map((rule, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted">
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
              {rule}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6 px-1 text-sm leading-relaxed text-faint">
        <h2 className="mb-2 font-display font-semibold text-ink">Privacy</h2>
        Uploaded files are deleted right after analysis. MetaProof stores the file's SHA-256 hash, a
        small thumbnail and the findings so a report can be shared by link. GPS coordinates are never
        stored, and your history list stays in your browser.
      </section>
    </div>
  )
}
