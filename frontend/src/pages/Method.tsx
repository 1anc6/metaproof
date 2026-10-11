import { BarChart3, Copy, Fingerprint, Scale, ShieldCheck, Sparkles } from 'lucide-react'
import { BANDS, GENERATORS, SUMMARY } from '../data/detectorResults'
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
    icon: Sparkles,
    name: 'AI detector',
    status: 'Live',
    text: 'A small classifier on top of frozen CLIP image features. Foundation-model features generalize better to new generators than a network trained from scratch, and the score is calibrated so 80% means roughly 80%. Every image is resized and re-saved as JPEG first, so file format cannot give the answer away.',
  },
  {
    icon: Copy,
    name: 'Seen-before search',
    status: 'Live',
    text: "Each image's CLIP embedding is stored in Postgres with pgvector. A nearest-neighbour search finds resized, cropped or recompressed copies that a file hash would miss.",
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

      <DetectorResults />

      <section className="mt-6 px-1 text-sm leading-relaxed text-faint">
        <h2 className="mb-2 font-display font-semibold text-ink">Privacy</h2>
        Uploaded files are deleted right after analysis. MetaProof stores the file's SHA-256 hash, a
        small thumbnail and the findings so a report can be shared by link; these are deleted 90 days
        after the image was last analyzed. GPS coordinates are never stored, and your history list
        stays in your browser.
      </section>
    </div>
  )
}

function DetectorResults() {
  return (
    <section className="glass animate-rise mt-6 rounded-3xl p-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="size-5" strokeWidth={1.5} />
        <h2 className="font-display text-lg font-semibold">How well the detector works</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Tested on {SUMMARY.testImages.toLocaleString()} images from nine generators that were{' '}
        <span className="text-ink">never shown to the model during training</span>. AUC{' '}
        {SUMMARY.auc} as uploaded and {SUMMARY.aucRecompressed} after social-media-style
        recompression; calibration error {Math.round(SUMMARY.calibrationError * 100)}%.
      </p>

      <div className="mt-6">
        <div className="flex items-center justify-between text-[11px] text-faint">
          <span>AI images detected, per unseen generator</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-white" /> as uploaded</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-white/35" /> recompressed</span>
          </span>
        </div>
        <ul className="mt-3 flex flex-col gap-2.5">
          {GENERATORS.map((g) => (
            <li key={g.name} className="grid grid-cols-[110px_1fr_44px] items-center gap-3 sm:grid-cols-[130px_1fr_48px]">
              <span className="truncate text-xs text-muted">{g.name}</span>
              <div className="flex flex-col gap-1">
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-white" style={{ width: `${g.clean * 100}%` }} />
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full rounded-full bg-white/35" style={{ width: `${g.recompressed * 100}%` }} />
                </div>
              </div>
              <span className="text-right font-mono text-xs tabular-nums text-ink">{Math.round(g.clean * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-7">
        <p className="text-[11px] text-faint">How the score is used (as uploaded / recompressed)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="text-faint">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-normal">Score</th>
                <th className="py-2 pr-3 font-normal">Effect on the verdict</th>
                <th className="py-2 pr-3 font-normal">AI caught</th>
                <th className="py-2 font-normal">Real photos flagged</th>
              </tr>
            </thead>
            <tbody>
              {BANDS.map((b) => (
                <tr key={b.range} className="border-b border-white/5 last:border-0 align-top">
                  <td className="py-2.5 pr-3 font-mono text-ink">{b.range}</td>
                  <td className="py-2.5 pr-3 text-muted">{b.effect}</td>
                  <td className="py-2.5 pr-3 font-mono text-muted">{b.caught}</td>
                  <td className="py-2.5 font-mono text-muted">{b.falseAlarm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-faint">
        Wrongly calling a real photo AI-generated is the costlier mistake, so only very high scores
        decide on their own. About one in five real photos scores above 50%, which is why the
        detector is one signal among several and MetaProof answers "inconclusive" when evidence is weak.
        Data: Community Forensics (CVPR 2025), CC BY-NC-SA 4.0.
      </p>
    </section>
  )
}
