import { Clock3, Fingerprint, Lock, MapPinOff, ScanSearch, Trash2 } from 'lucide-react'
import { KeyRow, PanelTitle } from './ui'

/** What happens to an uploaded file, in five facts. */
export function FileFacts({ className = '' }: { className?: string }) {
  return (
    <section className={`panel flex flex-col rounded-[28px] p-5 ${className}`} aria-labelledby="happens-title">
      <PanelTitle
        id="happens-title"
        title="What happens to the file"
        status={
          <span className="tag">
            <Lock className="size-3" strokeWidth={2} aria-hidden /> Private
          </span>
        }
      />
      <dl className="mt-2 flex flex-1 flex-col justify-around">
        <KeyRow icon={Fingerprint} label="Fingerprint" value="SHA-256" />
        <KeyRow icon={ScanSearch} label="Checks" value="Six, in seconds" />
        <KeyRow icon={Trash2} label="Your file" value="Deleted after" />
        <KeyRow icon={Clock3} label="Findings kept" value="1 day" />
        <KeyRow icon={MapPinOff} label="GPS" value="Never stored" />
      </dl>
      <p className="mt-3 text-[13px] leading-relaxed text-faint">
        Only the hash, a thumbnail and the findings stay, so the report can be shared by link.
      </p>
    </section>
  )
}
