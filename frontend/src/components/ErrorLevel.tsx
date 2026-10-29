import { FileSearch, ScanEye } from 'lucide-react'
import { ThinkingPill } from './ThinkingOrb'
import { useRef, useState } from 'react'
import type { Job } from '../lib/api'
import { previewFor } from '../lib/preview'

const QUALITY = 0.9 // re-save quality: the usual ELA setting
const MAX_SIDE = 4096 // larger images are scaled down, which blurs the traces a little

type State =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'ready'; original: string; ela: string; scaled: boolean }
  | { kind: 'error'; message: string }

/**
 * Error level analysis, computed in the browser: the image is re-saved as JPEG and the
 * difference is amplified. The server deletes uploads, so this needs the file on this device:
 * the preview from this session's upload, or the same file chosen again (checked by hash).
 */
export function ErrorLevel({ job }: { job: Job }) {
  const input = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [amplify, setAmplify] = useState(20)
  const [view, setView] = useState<'ela' | 'original'>('ela')
  const preview = previewFor(job.job_id)
  const isJpeg = job.media.mime_type === 'image/jpeg'

  // The difference is computed once; Amplify is a CSS brightness() on it, which multiplies
  // and clamps each channel exactly as recomputing would, but instantly.
  function compute(blob: Blob) {
    setState({ kind: 'working' })
    errorLevels(blob)
      .then((r) => setState({ kind: 'ready', ...r }))
      .catch(() => setState({ kind: 'error', message: 'This image could not be decoded in the browser.' }))
  }

  async function takeLocalFile(file: File) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (hex !== job.media.sha256) {
      setState({ kind: 'error', message: 'That is a different file from the one in this report. Choose the same file.' })
      return
    }
    compute(file)
  }

  async function takePreview() {
    if (!preview) return
    compute(await (await fetch(preview)).blob())
  }

  return (
    <section className="panel no-print rounded-[28px] p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <ScanEye className="mt-0.5 size-[18px] shrink-0 text-faint" strokeWidth={1.6} />
        <div>
          <h2 className="card-title">Error level view</h2>
          <p className="mt-1 text-[13px] text-faint">A way to look closer. It does not affect the verdict.</p>
          <details className="group mt-1.5 text-[13px] text-faint">
            <summary className="cursor-pointer list-none font-medium text-accent hover:underline">
              How to read it
            </summary>
            <p className="mt-2 max-w-2xl leading-relaxed">
              The image is re-saved as JPEG and the difference is amplified. Edges and fine texture are
              always bright; look for one area that glows differently from similar surroundings. It is
              not an AI detector.
              {!isJpeg && ' This file is not a JPEG, so differences mostly reflect texture.'}
            </p>
          </details>
        </div>
      </div>

      {state.kind === 'ready' ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="track inline-flex gap-0.5 rounded-full p-1" role="group" aria-label="Image shown">
              {(['ela', 'original'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={`h-8 rounded-full px-3.5 text-[13px] transition ${view === v ? 'selected font-medium' : 'text-muted hover:text-ink'}`}
                >
                  {v === 'ela' ? 'Error levels' : 'Original'}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Amplify
              <input
                type="range"
                min={5}
                max={60}
                step={5}
                value={amplify}
                onChange={(e) => setAmplify(Number(e.target.value))}
                className="w-28 accent-primary"
              />
              <span className="w-8 text-faint tabular-nums">{amplify}×</span>
            </label>
          </div>
          <img
            src={view === 'ela' ? state.ela : state.original}
            alt={view === 'ela' ? 'Error levels of the image' : 'The analyzed image'}
            width={job.media.width}
            height={job.media.height}
            style={view === 'ela' ? { filter: `brightness(${amplify})` } : undefined}
            className="mt-4 h-auto max-h-[70vh] w-full rounded-[18px] bg-black object-contain"
          />
          {state.scaled && (
            <p className="mt-2 text-[12px] text-faint">Scaled down to {MAX_SIDE} px on the long side for the browser.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {state.kind === 'working' ? (
            <ThinkingPill state="composing" label="Computing error levels…" />
          ) : preview ? (
            <button type="button" onClick={takePreview} className="btn-ghost btn-sm">
              <ScanEye className="size-4" strokeWidth={1.7} /> Show error levels
            </button>
          ) : (
            <>
              <button type="button" onClick={() => input.current?.click()} className="btn-ghost btn-sm">
                <FileSearch className="size-4" strokeWidth={1.7} /> Choose the file on this device
              </button>
              <span className="text-[13px] text-faint">It stays on your device; nothing is uploaded.</span>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) takeLocalFile(file)
              e.target.value = ''
            }}
          />
        </div>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="mt-3 text-sm text-ai">
          {state.message}
        </p>
      )}
    </section>
  )
}

async function errorLevels(source: Blob) {
  const bitmap = await createImageBitmap(source)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const before = ctx.getImageData(0, 0, w, h)
  const original = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))

  const resaved = await createImageBitmap(await canvas.convertToBlob({ type: 'image/jpeg', quality: QUALITY }))
  ctx.drawImage(resaved, 0, 0)
  resaved.close()
  const after = ctx.getImageData(0, 0, w, h)

  const out = ctx.createImageData(w, h)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = Math.abs(before.data[i] - after.data[i])
    out.data[i + 1] = Math.abs(before.data[i + 1] - after.data[i + 1])
    out.data[i + 2] = Math.abs(before.data[i + 2] - after.data[i + 2])
    out.data[i + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  const ela = URL.createObjectURL(await canvas.convertToBlob({ type: 'image/png' }))
  return { original, ela, scaled: scale < 1 }
}
