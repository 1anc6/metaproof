import { ArrowRight, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { useHistory } from '../lib/history'
import { Ruler, Logo } from './ui'

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
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-canvas px-5 sm:px-[max(1.25rem,calc((100vw-28rem)/2))] pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),20px)] lg:hidden"
    >
      <div className="flex items-center justify-between">
        <Logo />
        <button type="button" onClick={() => close()} className="well h-10 px-4 text-sm font-medium">
          Skip
        </button>
      </div>

      <div className="stagger mt-8 [&>*]:animate-rise [@media(max-height:720px)]:mt-5">
        <h1
          id="welcome-title"
          className="text-[44px] leading-[0.98] font-normal tracking-[-0.045em] [@media(max-height:720px)]:text-[36px]"
        >
          See what's behind the image
        </h1>
        <p className="mt-3 text-sm text-faint">
          Metadata <span aria-hidden>›</span> Credentials <span aria-hidden>›</span> Pixels
        </p>
        <p className="tag-hi mt-5 gap-1 [@media(max-height:720px)]:mt-3">
          <Lock className="size-3" strokeWidth={2.5} /> No account needed
        </p>
      </div>

      {/* A real example verdict; it gives way on short phones so both buttons stay above the fold.
          The figures mirror the stored demo report (lib/demo.ts). */}
      <div className="flex flex-1 items-center py-5 [@media(max-height:720px)]:hidden">
        <button
          type="button"
          onClick={() => close(DEMO_REPORT_PATH)}
          className="mesh mesh-garnet flex w-full flex-col rounded-xl p-5 text-left"
        >
          <span className="text-[14px] font-medium text-white/90">Example report</span>
          <span className="py-5 text-center">
            <span className="dot-num block text-[80px] text-white">99</span>
            <span className="mt-3 block text-[17px] font-semibold">Likely AI-generated</span>
            <span className="block text-[13px] text-white/85">99% AI likelihood, pixel detector</span>
          </span>
          <Ruler value={99} />
        </button>
      </div>

      <div className="flex flex-col gap-3 [@media(max-height:720px)]:mt-auto">
        <button
          ref={primary}
          type="button"
          onClick={() => close('/new')}
          className="btn-primary h-14 w-full justify-center text-[16px]"
        >
          Analyze an image <ArrowRight className="size-4" strokeWidth={2.25} />
        </button>
        <button
          type="button"
          onClick={() => close(DEMO_REPORT_PATH)}
          className="btn-ghost h-14 w-full justify-center text-[16px]"
        >
          See an example report
        </button>
        <p className="mt-1 text-center text-[12px] leading-relaxed text-faint">
          Files are deleted after analysis. Your history stays on this device.
        </p>
      </div>
    </div>
  )
}
