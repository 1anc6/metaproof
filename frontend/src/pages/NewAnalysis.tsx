import { MoonStar, WifiOff } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useServerStatus } from '../lib/hooks'
import { takeSharedImage } from '../lib/share'
import { useUpload } from '../lib/upload'
import { PageHeader } from '../components/ui'
import { FileFacts } from '../components/FileFacts'
import { UploadPanel } from '../components/UploadPanel'

/** The upload page: the upload card (a chosen file goes straight away) beside what happens to the file. */
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
    <div>
      <PageHeader title="New analysis" subtitle="Choose an image to check where it came from and whether it was edited or generated." />

      <ServerNotice state={server} />

      <div className="grid gap-4 lg:grid-cols-12">
        <UploadPanel upload={upload} autoStart className="lg:col-span-7" />

        <FileFacts className="lg:col-span-5" />
      </div>
    </div>
  )
}

function ServerNotice({ state }: { state: ReturnType<typeof useServerStatus> }) {
  if (state !== 'waking' && state !== 'offline') return null
  const waking = state === 'waking'
  const Icon = waking ? MoonStar : WifiOff
  return (
    <div role="status" className="panel animate-rise mb-4 flex items-start gap-3 rounded-[22px] px-4 py-3.5 text-[14.5px] font-medium">
      <Icon className={`mt-0.5 size-4 shrink-0 ${waking ? 'text-edited' : 'text-ai'}`} strokeWidth={1.8} aria-hidden />
      <p>
        {waking
          ? 'The server is waking up. Free hosting sleeps when idle, so this takes about a minute; you can upload now and it will continue on its own.'
          : 'Cannot reach the MetaProof server right now. Check your connection, or try again in a minute.'}
      </p>
    </div>
  )
}
