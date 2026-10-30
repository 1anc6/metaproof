import { Copy, Droplets, Fingerprint, Layers, ShieldCheck, Sparkles } from 'lucide-react'
import { BANDS, GENERATORS, NEWEST, SUMMARY } from '../data/detectorResults'
import { PageHeader, PanelTitle } from '../components/ui'

const LAYERS = [
  {
    name: 'Metadata',
    icon: Fingerprint,
    text: 'Reads EXIF, XMP and PNG text chunks. Generator settings left by Stable Diffusion tools, the IPTC "AI-generated" source type, editor software tags and camera capture data all become findings. Camera data is weak evidence because it is easy to forge. A file that also keeps its maker data, recorded size and a matching preview has the structure of a camera original, which editors and copied EXIF tend to break; it is still only weak evidence, because a phone\'s own editor keeps it too.',
  },
  {
    name: 'File structure',
    icon: Layers,
    text: 'Walks the file container: JPEG segments and PNG, WebP or HEIC chunks, the JPEG quantization tables and the quality they imply, the ICC colour profile, and any data appended after the image. Standard IJG tables mean common software last saved the file; private chunks and appended data hint at the tools involved. All of it explains the file, and none of it moves the verdict.',
  },
  {
    name: 'Content Credentials (C2PA)',
    icon: ShieldCheck,
    text: 'Validates signed provenance manifests with the official C2PA SDK. A valid manifest that declares AI generation settles the verdict; a broken signature means the file changed after signing. A valid signature proves who signed and that nothing changed since, not that the scene is real.',
  },
  {
    name: 'Invisible watermark',
    icon: Droplets,
    text: "Stable Diffusion's reference scripts and the SDXL pipelines hide a fixed message in the pixels of every image they generate. MetaProof reads it with the same method as the open-source decoder. A match is strong AI evidence; finding none means nothing, because most images have no watermark and resizing or recompressing removes it.",
  },
  {
    name: 'AI detector',
    icon: Sparkles,
    text: 'A small classifier on top of frozen CLIP image features. Foundation-model features generalize better to new generators than a network trained from scratch, and the score is calibrated so 80% means roughly 80%. Every image is resized and re-saved as JPEG first, so file format cannot give the answer away.',
  },
  {
    name: 'Seen-before search',
    icon: Copy,
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
    <div>
      <PageHeader title="How it works" subtitle="Six independent checks, a verdict that shows its working, and never a claim of absolute truth." />

      <nav aria-label="On this page" className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div className="track inline-flex gap-0.5 rounded-full p-1">
          {[
            ['#checks', 'The six checks'],
            ['#verdict', 'The verdict'],
            ['#accuracy', 'Detector accuracy'],
            ['#privacy', 'Privacy'],
          ].map(([href, label]) => (
            <a key={href} href={href} className="flex h-9 shrink-0 items-center rounded-full px-4 text-[13.5px] whitespace-nowrap text-muted transition hover:bg-[var(--raise-bg)] hover:text-ink">
              {label}
            </a>
          ))}
        </div>
      </nav>

      <section id="checks" className="scroll-mt-6" aria-labelledby="checks-title">
        <h2 id="checks-title" className="sr-only">
          The six checks
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {LAYERS.map(({ name, icon: Icon, text }) => (
            <article key={name} className="panel rounded-[28px] p-5 sm:p-6">
              <div className="flex items-center gap-3">
                <Icon className="size-[18px] shrink-0 text-faint" strokeWidth={1.6} aria-hidden />
                <h3 className="card-title min-w-0 flex-1">{name}</h3>
                <span className="chip">
                  <span className="size-1.5 rounded-full bg-dot-authentic" aria-hidden /> Live
                </span>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-muted">{text}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-12 lg:items-start">
        <section id="verdict" className="panel scroll-mt-6 rounded-[28px] p-5 sm:p-6 lg:col-span-5">
          <PanelTitle title="How the verdict is decided" />
          <ol className="mt-4 flex flex-col gap-3.5">
            {RULES.map((rule) => (
              <li key={rule} className="flex gap-3 text-[14.5px] leading-relaxed text-ink">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                {rule}
              </li>
            ))}
          </ol>
        </section>

        <section id="privacy" className="panel scroll-mt-6 rounded-[28px] p-5 sm:p-6 lg:col-span-7">
          <PanelTitle title="Privacy" />
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted">
            Uploaded files are deleted right after analysis. MetaProof stores the file's SHA-256 hash, a small thumbnail and the
            findings so a report can be shared by link; these are deleted 1 day after the image was last analyzed. GPS
            coordinates are never stored, and your history list stays in your browser.
          </p>
        </section>
      </div>

      <DetectorResults />
    </div>
  )
}

/** One row of the per-generator chart: the name, a thin blue line for each condition, the rate. */
function RateRow({ name, rates }: { name: string; rates: number[] }) {
  return (
    <li className="grid grid-cols-[minmax(0,118px)_1fr_44px] items-center gap-3 sm:grid-cols-[150px_1fr_52px]">
      <span className="truncate text-[13.5px] text-muted">{name}</span>
      <span className="flex flex-col gap-1">
        {rates.map((r, i) => (
          <span key={i} className="bar-track h-1.5 overflow-hidden rounded-full">
            <span className={`block h-full rounded-full ${i === 0 ? 'bg-primary' : 'bg-primary/35'}`} style={{ width: `${r * 100}%` }} />
          </span>
        ))}
      </span>
      <span className="text-right text-[13.5px] font-semibold text-ink tabular-nums">{Math.round(rates[0] * 100)}%</span>
    </li>
  )
}

function DetectorResults() {
  return (
    <section id="accuracy" className="panel mt-4 scroll-mt-6 rounded-[28px] p-5 sm:p-6">
      <PanelTitle title="How well the detector works" />
      {/* Held-out benchmark figures, measured on generators the model never saw in training. */}
      <dl className="well mt-4 grid grid-cols-3 rounded-[18px] py-3.5">
        {[
          ['AUC, as uploaded', SUMMARY.auc.toFixed(2)],
          ['AUC, recompressed', SUMMARY.aucRecompressed.toFixed(2)],
          ['Calibration error', `${Math.round(SUMMARY.calibrationError * 100)}%`],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 border-l border-line px-4 first:border-l-0">
            <dt className="truncate text-[12.5px] leading-tight text-faint">{label}</dt>
            <dd className="num mt-1.5 text-[30px] leading-none">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 grid gap-x-10 gap-y-4 lg:grid-cols-2">
        <p className="text-[14.5px] leading-relaxed text-muted">
          AUC is how reliably the detector ranks an AI image above a real one: 0.5 is a coin toss, 1.0 is never wrong.
          Calibration error is how far its scores stray from what actually happened on the test set. Both describe the
          detector across thousands of images; they do not say how sure any single verdict is.
        </p>
        <p className="text-[14.5px] leading-relaxed text-muted">
          Tested on {SUMMARY.testImages.toLocaleString()} images from nine generators that were{' '}
          <span className="font-medium text-ink">never shown to the model during training</span>. AUC {SUMMARY.auc} as
          uploaded and {SUMMARY.aucRecompressed} after social-media-style recompression; calibration error{' '}
          {Math.round(SUMMARY.calibrationError * 100)}%.
        </p>
      </div>

      <div className="mt-6 grid gap-x-10 gap-y-8 lg:grid-cols-2">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12.5px] text-faint">
            <span className="font-medium text-ink">AI images detected, per unseen generator</span>
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" /> as uploaded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary/35" /> recompressed
              </span>
            </span>
          </div>
          <ul className="mt-4 flex flex-col gap-3">
            {GENERATORS.map((g) => (
              <RateRow key={g.name} name={g.name} rates={[g.clean, g.recompressed]} />
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[12.5px] font-medium text-ink">Newest generators (2026), as uploaded: still mostly missed</p>
          <ul className="mt-4 flex flex-col gap-3">
            {NEWEST.map((g) => (
              <RateRow key={g.name} name={g.name} rates={[g.clean]} />
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-relaxed text-faint">
            These models came out after the training data. Their images often keep signed Content Credentials, which
            MetaProof checks first; when those are stripped, the detector usually can't tell, and the verdict stays
            inconclusive rather than "authentic".
          </p>
        </div>
      </div>

      <div className="mt-7">
        <p className="text-[12.5px] font-medium text-ink">How the score is used (as uploaded / recompressed)</p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-[13.5px]">
            <thead className="text-faint">
              <tr className="border-b border-line-strong">
                <th className="py-2.5 pr-3 font-normal">Score</th>
                <th className="py-2.5 pr-3 font-normal">Effect on the verdict</th>
                <th className="py-2.5 pr-3 text-right font-normal">AI caught</th>
                <th className="py-2.5 text-right font-normal">Real photos flagged</th>
              </tr>
            </thead>
            <tbody>
              {BANDS.map((b) => (
                <tr key={b.range} className="border-b border-line align-top last:border-0">
                  <td className="py-3 pr-3 font-semibold whitespace-nowrap text-ink tabular-nums">{b.range}</td>
                  <td className="py-3 pr-3 text-muted">{b.effect}</td>
                  <td className="py-3 pr-3 text-right whitespace-nowrap text-muted tabular-nums">{b.caught}</td>
                  <td className="py-3 text-right whitespace-nowrap text-muted tabular-nums">{b.falseAlarm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-5 text-[13px] leading-relaxed text-faint">
        Wrongly calling a real photo AI-generated is the costlier mistake, so only very high scores decide on their own. About
        one in ten real photos scores above 50% (one in five after recompression), which is why the detector is one signal
        among several and MetaProof answers "inconclusive" when evidence is weak. Data: Community Forensics (CVPR 2025), CC
        BY-NC-SA 4.0, and Rapidata's human-preference sets for 2025 generators, CDLA-Permissive-2.0.
      </p>
    </section>
  )
}
