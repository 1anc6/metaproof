import { ArrowRight, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { useHistory } from '../lib/history'
import { Logo } from './ui'
import { CheckDial } from './CheckDial'

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
 * Full-screen intro for first-time visitors on phones, on the graphite reference. No sign-up:
 * it only explains the app and points at the two ways in. People arriving on a shared report
 * link, returning users and desktop visitors never see it.
 */
export function Welcome() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const history = useHistory()
  const primary = useRef<HTMLButtonElement>(null)
  const [active, setActive] = useState('c2pa')
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
      className="theme-dark fixed inset-0 z-50 isolate flex flex-col overflow-y-auto bg-[linear-gradient(180deg,#767676_0%,#5e5e5e_32%,#444_66%,#2e2e2e_100%)] px-5 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),20px)] text-white sm:px-[max(1.25rem,calc((100vw-28rem)/2))] lg:hidden"
    >
      <div className="flex items-center justify-between">
        <Logo />
        <button type="button" onClick={() => close()} className="btn-ghost h-11 px-5 text-[15px]">
          Skip
        </button>
      </div>

      <div className="stagger mt-8 [&>*]:animate-rise [@media(max-height:720px)]:mt-5">
        <h1
          id="welcome-title"
          className="display text-[52px] leading-[0.92] [@media(max-height:720px)]:text-[42px]"
        >
          See what's behind the <span className="mark-word">image</span>
        </h1>
        <p className="mt-3 flex items-center gap-1.5 text-[14px] text-white/80">
          <Lock className="size-3.5" strokeWidth={1.75} /> No account needed
        </p>
      </div>

      {/* The six checks on the dial; it gives way on short phones so both buttons stay above the fold. */}
      <div className="flex flex-1 items-center py-5 [@media(max-height:720px)]:hidden">
        <CheckDial active={active} onSelect={setActive} className="max-w-[360px]" />
      </div>

      <div className="flex flex-col gap-3 [@media(max-height:720px)]:mt-auto">
        <button
          ref={primary}
          type="button"
          onClick={() => close('/new')}
          className="btn-primary h-14 w-full text-[16px]"
        >
          Analyze an image <ArrowRight className="size-4" strokeWidth={2} />
        </button>
        <button type="button" onClick={() => close(DEMO_REPORT_PATH)} className="btn-ghost h-14 w-full text-[16px]">
          See an example report
        </button>
        <p className="mt-1 text-center text-[12px] leading-relaxed text-white/70">
          Files are deleted after analysis. Your history stays on this device.
        </p>
      </div>
    </div>
  )
}
