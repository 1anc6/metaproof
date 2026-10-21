import { CircleAlert, CircleCheck, Download, OctagonAlert, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, type ServiceStatus } from '../lib/api'
import type { ReactNode } from 'react'
import { formatWhen } from '../lib/format'
import { useHistory, type HistoryEntry } from '../lib/history'
import { clearWithUndo } from '../lib/undo'
import { promptInstall, useInstallState } from '../lib/install'
import { ServerBadge } from '../components/Shell'
import { GithubMark, PageHeader, ThemeSwitch } from '../components/ui'

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
        title="Settings"
        subtitle="There are no accounts: everything here applies to this browser only."
      />

      {/* Source order is the phone order and the reading order. On desktop CSS columns split the
          cards into two stacks of about equal height, without changing that order. */}
      <div className="flex flex-col gap-4 lg:block lg:columns-2 lg:gap-4 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">
        <Card title="Appearance">
          <p className="text-sm text-muted">
            Light, dark, or follow this device's setting. Saved in this browser.
          </p>
          <ThemeSwitch labels className="mt-5" />
        </Card>

        <Card title="This device">
          <p className="flex items-start gap-2">
            <span className="num text-[56px] leading-none">{history.length}</span>
            <span className="mt-1 text-[14px] text-faint">saved here</span>
          </p>
          <p className="mt-3 text-[15px] text-muted">
            {history.length === 0
              ? 'No analyses saved in this browser.'
              : `${history.length === 1 ? 'analysis' : 'analyses'} in this browser. Latest: ${formatWhen(history[0].uploadedAt)}.`.replace(/^./, (c) => c.toUpperCase())}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={history.length === 0}
              onClick={() => exportHistory(history)}
              className="btn-ghost disabled:opacity-40"
            >
              <Download className="size-4" /> Export list
            </button>
            <button
              type="button"
              disabled={history.length === 0}
              onClick={clearWithUndo}
              className="btn-ghost text-ai disabled:opacity-40"
            >
              <Trash2 className="size-4" /> Clear history
            </button>
          </div>
        </Card>

        <InstallCard />

        <Card title="Server" action={<ServerBadge />}>
          <ServiceFigures />
          <p className="mt-4 text-[13px] text-faint">
            The API runs on a free instance that sleeps when idle, so the first upload after a quiet
            spell can take up to a minute.
          </p>
          <a
            href="https://github.com/1anc6/metaproof"
            target="_blank"
            rel="noreferrer"
            className="btn-ghost mt-5"
          >
            <GithubMark className="size-4" /> Source code
          </a>
        </Card>

        <Card title="Privacy and data">
          <ul className="flex flex-col gap-2.5">
            {PRIVACY.map((line) => (
              <li key={line} className="flex gap-3 text-sm text-muted">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

type Level = { label: string; color: string; icon: typeof CircleCheck }
const LEVELS: Record<'ok' | 'warn' | 'full', Level> = {
  ok: { label: 'Healthy', color: 'var(--color-authentic)', icon: CircleCheck },
  warn: { label: 'Getting full', color: 'var(--color-edited)', icon: CircleAlert },
  full: { label: 'Almost full', color: 'var(--color-ai)', icon: OctagonAlert },
}

/** Live figures from GET /api/status: storage against the plan's limit and the last day's work. */
function ServiceFigures() {
  const [status, setStatus] = useState<ServiceStatus | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    api.status().then((s) => !cancelled && setStatus(s)).catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [])

  if (failed) return <p className="text-sm text-muted">Storage figures are unavailable while the server is unreachable.</p>
  if (!status) return <div className="skeleton h-24" aria-label="Loading storage figures" />

  const { database_mb: used, storage_limit_mb: limit, storage_warn_mb: warn } = status
  const share = Math.min(1, used / limit)
  const level = LEVELS[used >= limit * 0.95 ? 'full' : used >= warn ? 'warn' : 'ok']
  const Icon = level.icon
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-muted">Database storage</span>
          <span className="text-[13px] text-muted tabular-nums">
            <span className="num text-[28px] text-ink">{used.toFixed(1)}</span> MB of {limit} MB
          </span>
        </div>
        <div
          className="relative mt-2 h-1.5 rounded-full bg-line"
          role="meter"
          aria-label="Database storage used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
          aria-valuetext={`${used.toFixed(1)} of ${limit} MB, ${level.label.toLowerCase()}`}
          title={`${(share * 100).toFixed(1)}% used. A warning is logged at ${warn} MB.`}
        >
          <div className="h-full rounded-full" style={{ width: `${Math.max(share * 100, 1)}%`, background: level.color }} />
          {/* where the server starts logging warnings */}
          <div className="absolute top-[-3px] h-[12px] w-px bg-faint" style={{ left: `${(warn / limit) * 100}%` }} aria-hidden />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted">
          <Icon className="size-3.5" style={{ color: level.color }} strokeWidth={2} aria-hidden />
          {level.label} · reports are kept for {status.retention_days} days
        </p>
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Figure label="Analyses today" value={`${status.analyses_24h}`} note={`of ${status.daily_cap} a day`} />
        <Figure
          label="Failed today"
          value={`${status.failed_24h}`}
          note={status.failed_24h ? 'see the server logs' : 'none'}
        />
        <Figure label="Last analysis" value={status.last_analysis_at ? formatWhen(status.last_analysis_at) : '–'} />
      </dl>
    </div>
  )
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-raised p-3">
      <dt className="text-[12px] leading-tight text-faint">{label}</dt>
      <dd className={`mt-2 ${/^\d+$/.test(value) ? 'num text-[34px] leading-none' : 'text-base leading-tight sm:text-lg'}`}>{value}</dd>
      {note && <dd className="mt-0.5 text-[12px] leading-tight text-faint">{note}</dd>}
    </div>
  )
}

function InstallCard() {
  const state = useInstallState()
  return (
    <Card title="Install the app">
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

/** A settings card: icon disc and title on one line, an optional status on the right. */
function Card({
  title,
  action,
  className = '',
  children,
}: {
  title: string
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`panel animate-rise rounded-xl p-5 sm:p-7 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </div>
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
