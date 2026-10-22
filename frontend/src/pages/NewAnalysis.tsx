import { Lock, MoonStar, WifiOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useServerStatus } from '../lib/hooks'
import { takeSharedImage } from '../lib/share'
import { useUpload } from '../lib/upload'
import { PageHeader, LeaderRow } from '../components/ui'
import { UploadPanel } from '../components/UploadPanel'

/** The upload page: the upload panel (a chosen file goes straight away) beside what happens to the file. */
export function NewAnalysis() {
  const [params, setParams] = useSearchParams()
  const upload = useUpload(
    params.get('shared') && params.get('shared') !== '1'
      ? { kind: 'error', message: 'Nothing MetaProof can analyze was shared. Share a JPEG, PNG, WebP, TIFF or HEIC image.' }
      : { kind: 'idle' },
  )
  const { start, fail } = upload

  // Opened from the phone's share menu: analyze the shared image straight away.
  const sharedHandled = useRef(false)
  useEffect(() => {
    const shared = params.get('shared')
    if (!shared || sharedHandled.current) return
    sharedHandled.current = true // React runs effects twice in development; take the file once
    setParams({}, { replace: true })
    if (shared !== '1') return // the initial state already explains it
    takeSharedImage().then((file) =>
      file ? start(file) : fail('The shared image could not be found. Share it again, or choose it here.'),
    )
  }, [params, setParams, start, fail])

  const server = useServerStatus()

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="New analysis" subtitle="Choose an image to check where it came from and whether it was edited or generated." />

      <ServerNotice state={server} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:items-start">
        <UploadPanel upload={upload} autoStart className="animate-rise" />

        {/* What happens to the file. */}
        <section className="panel animate-rise rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="eyebrow">What happens</h2>
            <span className="status text-[13px]">
              <Lock className="size-3.5" strokeWidth={1.75} aria-hidden /> Private
            </span>
          </div>
          <dl className="mt-2 [&>div]:py-2 [&>div]:text-[14px]">
            <LeaderRow label="Fingerprint" value="SHA-256" />
            <LeaderRow label="Checks" value="Six, in seconds" />
            <LeaderRow label="Your file" value="Deleted after" />
            <LeaderRow label="Findings kept" value="90 days" />
            <LeaderRow label="GPS" value="Never stored" />
          </dl>
          <p className="mt-2 text-[13px] leading-relaxed text-faint">
            Only the hash, a thumbnail and the findings stay, so the report can be shared by link.
          </p>
        </section>
      </div>
    </div>
  )
}

function ServerNotice({ state }: { state: ReturnType<typeof useServerStatus> }) {
  if (state !== 'waking' && state !== 'offline') return null
  const waking = state === 'waking'
  const Icon = waking ? MoonStar : WifiOff
  return (
    <div
      role="status"
      className={`panel animate-rise mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-[15px] font-medium ${
        waking ? 'text-edited' : 'text-ai'
      }`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p>
        {waking
          ? 'The server is waking up. Free hosting sleeps when idle, so this takes about a minute; you can upload now and it will continue on its own.'
          : 'Cannot reach the MetaProof server right now. Check your connection, or try again in a minute.'}
      </p>
    </div>
  )
}
