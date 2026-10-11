import { Download, HardDrive, Server, ShieldCheck, Smartphone, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatWhen } from '../lib/format'
import { clearHistory, useHistory, type HistoryEntry } from '../lib/history'
import { promptInstall, useInstallState } from '../lib/install'
import { ServerBadge } from '../components/Shell'
import { GithubMark, PageHeader } from '../components/ui'

const PRIVACY = [
  'Uploaded files are deleted as soon as the analysis finishes.',
  "The server keeps the file's hash, a small thumbnail and the findings so a report can be shared by link.",
  'Those are deleted 90 days after the image was last analyzed. Uploading it again starts a fresh analysis.',
  'Filenames never leave this device, and GPS coordinates are never stored.',
]

export function Settings() {
  const history = useHistory()
  return (
    <div>
      <PageHeader
        eyebrow="Preferences"
        title="Settings."
        subtitle="There are no accounts: everything here applies to this browser only."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <InstallCard />

        <Card icon={HardDrive} title="This device">
          <p className="text-sm text-muted">
            {history.length === 0
              ? 'No analyses saved in this browser.'
              : `${history.length} ${history.length === 1 ? 'analysis' : 'analyses'} saved in this browser. Latest: ${formatWhen(history[0].uploadedAt)}.`}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={history.length === 0}
              onClick={() => exportHistory(history)}
              className="glass btn-ghost disabled:opacity-40"
            >
              <Download className="size-4" /> Export list
            </button>
            <button
              type="button"
              disabled={history.length === 0}
              onClick={() =>
                window.confirm('Remove all analyses from this device? Reports stay available by link.') &&
                clearHistory()
              }
              className="glass btn-ghost text-ai disabled:opacity-40"
            >
              <Trash2 className="size-4" /> Clear history
            </button>
          </div>
        </Card>

        <Card icon={Server} title="Server">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted">Status</span>
            <ServerBadge />
          </div>
          <p className="mt-3 text-sm text-muted">
            The API runs on a free instance that sleeps when idle, so the first upload after a quiet
            spell can take up to a minute.
          </p>
          <a
            href="https://github.com/1anc6/metaproof"
            target="_blank"
            rel="noreferrer"
            className="glass btn-ghost mt-5"
          >
            <GithubMark className="size-4" /> Source code
          </a>
        </Card>

        <Card icon={ShieldCheck} title="Privacy and data" className="lg:col-span-2">
          <ul className="flex flex-col gap-2.5">
            {PRIVACY.map((line) => (
              <li key={line} className="flex gap-3 text-sm text-muted">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-white/30" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function InstallCard() {
  const state = useInstallState()
  return (
    <Card icon={Smartphone} title="Install the app" className="lg:col-span-2">
      {state === 'installed' && (
        <p className="text-sm text-muted">
          MetaProof is installed on this device. On Android, share any photo to it from your gallery,
          WhatsApp or the browser, and it opens straight into the analysis.
        </p>
      )}
      {state === 'available' && (
        <>
          <p className="text-sm text-muted">
            Install MetaProof to open it like an app. On Android it also appears in the share menu, so you
            can send a suspicious photo straight from your gallery or WhatsApp.
          </p>
          <button type="button" onClick={promptInstall} className="btn-primary mt-5">
            <Download className="size-4" strokeWidth={2.25} /> Install MetaProof
          </button>
        </>
      )}
      {state === 'ios' && (
        <p className="text-sm text-muted">
          In Safari, tap <span className="text-ink">Share</span>, then{' '}
          <span className="text-ink">Add to Home Screen</span>. iPhones don't let web apps appear in the
          share menu, so open MetaProof and choose the photo there.
        </p>
      )}
      {state === 'unavailable' && (
        <p className="text-sm text-muted">
          Open this site in Chrome on Android, or in Chrome or Edge on a computer, to install it. On
          Android it then appears in the share menu for photos.
        </p>
      )}
    </Card>
  )
}

function Card({
  icon: Icon,
  title,
  className = '',
  children,
}: {
  icon: typeof Server
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`glass animate-rise rounded-3xl p-6 ${className}`}>
      <h2 className="mb-4 flex items-center gap-2.5 font-display font-semibold">
        <Icon className="size-4 text-faint" strokeWidth={1.75} /> {title}
      </h2>
      {children}
    </section>
  )
}

/** Saves the list as JSON, e.g. to move it to another browser or keep the report links. */
function exportHistory(history: HistoryEntry[]) {
  const rows = history.map((e) => ({ ...e, report: `${location.origin}/report/${e.sha256}` }))
  const url = URL.createObjectURL(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: 'metaproof-history.json' })
  a.click()
  URL.revokeObjectURL(url)
}
