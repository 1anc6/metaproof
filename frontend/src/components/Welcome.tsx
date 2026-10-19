import { ArrowRight, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { useHistory } from '../lib/history'
import { Orb } from './ui'

const KEY = 'metaproof.welcome.v1'
let seenThisSession = false // fallback when storage is blocked (private mode)

function alreadySeen(): boolean {
  if (seenThisSession) return true
  try {
    return localStorage.getItem(KEY) !== null
  } catch {
    return false
  }
}

function markSeen() {
  seenThisSession = true
  try {
    localStorage.setItem(KEY, new Date().toISOString())
  } catch {
    /* storage unavailable: the session flag still hides it until reload */
  }
}

/**
 * Full-screen intro for first-time visitors on phones, after the mobile reference. No sign-up:
 * it only explains the app and points at the two ways in. People arriving on a shared report
 * link, returning users and desktop visitors never see it.
 */
export function Welcome() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const history = useHistory()
  const primary = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(
    () =>
      pathname === '/' &&
      history.length === 0 &&
      !alreadySeen() &&
      !window.matchMedia('(min-width: 64rem)').matches,
  )

  function close(to?: string) {
    markSeen()
    setOpen(false)
    if (to) navigate(to)
  }

  useEffect(() => {
    if (!open) return
    primary.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      markSeen()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      className="welcome fixed inset-0 z-50 flex flex-col overflow-y-auto px-6 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),24px)] lg:hidden"
    >
      <div className="flex justify-end">
        <button type="button" onClick={() => close()} className="px-2 py-2 text-sm text-faint transition hover:text-ink">
          Skip
        </button>
      </div>

      <div className="flex flex-1 items-center justify-center py-6 [@media(max-height:720px)]:py-2">
        {/* A smaller orb on short phones keeps both buttons above the fold. */}
        <Orb size={window.innerHeight < 720 ? 104 : 168} />
      </div>

      <div className="stagger text-center [&>*]:animate-rise">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-muted">
          <Lock className="size-3" strokeWidth={2} /> No account needed
        </span>
        <h1
          id="welcome-title"
          className="mt-5 font-display text-[40px] leading-[1.02] font-semibold tracking-tight [@media(max-height:720px)]:mt-4 [@media(max-height:720px)]:text-[34px]"
        >
          See what's behind
          <br />
          <span className="bg-gradient-to-b from-zinc-300 to-zinc-600 bg-clip-text text-transparent">
            the image.
          </span>
        </h1>
        <p className="mx-auto mt-4 max-w-xs text-[15px] leading-relaxed text-muted">
          Check a photo's metadata, Content Credentials and pixels, and get a verdict that shows
          its evidence.
        </p>
      </div>

      <div className="mt-8 flex flex-col gap-3 [@media(max-height:720px)]:mt-6">
        <button
          ref={primary}
          type="button"
          onClick={() => close('/new')}
          className="btn-primary h-13 w-full justify-center text-[15px]"
        >
          Analyze an image <ArrowRight className="size-4" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          onClick={() => close(DEMO_REPORT_PATH)}
          className="glass btn-ghost h-13 w-full justify-center text-[15px]"
        >
          See an example report
        </button>
        <p className="mt-2 text-center text-[11px] leading-relaxed text-faint">
          Files are deleted after analysis. Your history stays on this device.
        </p>
      </div>
    </div>
  )
}
