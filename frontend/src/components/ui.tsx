import { useState, type ReactNode } from 'react'
import { ImageOff } from 'lucide-react'
import { api, type JobStatus, type Signal, type VerdictLabel } from '../lib/api'
import { PENDING, SIGNALS, VERDICTS } from '../lib/verdicts'

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="orb relative block size-7 shrink-0" aria-hidden />
      {!compact && (
        <span className="font-display text-[17px] font-semibold tracking-tight">MetaProof</span>
      )}
    </span>
  )
}

/** The glass orb with a light beam above it, as in the mobile reference. */
export function Orb({ size = 180, className = 'relative' }: { size?: number; className?: string }) {
  // className must include a position (relative by default, or absolute when placed).
  return (
    <div className={`pointer-events-none ${className}`} style={{ width: size, height: size * 1.25 }} aria-hidden>
      <div className="beam absolute inset-x-[-40%] top-0 h-[70%]" />
      <div className="orb animate-float absolute bottom-0 left-0" style={{ width: size, height: size }} />
      <div
        className="absolute bottom-[-6%] left-1/2 h-[10%] w-[70%] -translate-x-1/2 rounded-full bg-black/80 blur-xl"
        style={{ zIndex: -1 }}
      />
    </div>
  )
}

export function VerdictBadge({ label, status = 'done' }: { label: VerdictLabel | null; status?: JobStatus }) {
  if (status !== 'done' || !label) {
    const p = PENDING[status === 'done' ? 'queued' : status]
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${p.text}`}>
        {status === 'running' || status === 'queued' ? (
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
        ) : (
          <span className="size-1.5 rounded-full bg-current" />
        )}
        {p.title}
      </span>
    )
  }
  const v = VERDICTS[label]
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${v.text}`}>
      <span className="size-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
      {v.short}
    </span>
  )
}

export function SignalDot({ signal }: { signal: Signal }) {
  const color = SIGNALS[signal].color
  return (
    <span
      className="mt-1.5 size-2 shrink-0 rounded-full"
      style={{ background: color, boxShadow: `0 0 12px ${color}` }}
      aria-hidden
    />
  )
}

export function Thumb({ sha, className = '' }: { sha: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`relative overflow-hidden bg-white/5 ${className}`}>
      {failed ? (
        <div className="grid size-full place-items-center text-faint">
          <ImageOff className="size-4" />
        </div>
      ) : (
        <img
          src={api.thumbnailUrl(sha)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  dim,
  subtitle,
  action,
}: {
  eyebrow: string
  title: string
  dim?: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <header className="animate-rise mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="eyebrow mb-3">{eyebrow}</p>
        <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-tight sm:text-5xl">
          {title}
          {dim && (
            <>
              <br />
              <span className="text-faint">{dim}</span>
            </>
          )}
        </h1>
        {subtitle && <p className="mt-3 max-w-xl text-[15px] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="no-print shrink-0">{action}</div>}
    </header>
  )
}

export function ErrorPanel({ message, children }: { message: string; children?: ReactNode }) {
  return (
    <div className="glass rounded-3xl p-8 text-center">
      <p className="font-display text-lg font-semibold">Something went wrong</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">{message}</p>
      {children && <div className="mt-6 flex justify-center gap-3">{children}</div>}
    </div>
  )
}

export function GithubMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}
