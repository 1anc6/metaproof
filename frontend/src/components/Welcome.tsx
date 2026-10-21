import { ArrowRight, Lock } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { useHistory } from '../lib/history'
import { Mark, Thumb } from './ui'
import { CheckWheel, Lens } from './CheckWheel'
import { CHECKS, DEMO_SHA } from '../lib/checks'

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
      className="fixed inset-0 z-50 isolate flex flex-col overflow-y-auto bg-[#2a2620] px-5 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),20px)] text-white sm:px-[max(1.25rem,calc((100vw-28rem)/2))] lg:hidden"
    >
      {/* The example image, blurred into a warm dark backdrop, like the reference's photo screen. */}
      <Thumb sha={DEMO_SHA} eager className="!fixed inset-0 -z-10 scale-125 !bg-transparent opacity-80 blur-2xl brightness-[0.5]" />
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-full bg-white text-[#1d1b17]">
            <Mark className="size-5" />
          </span>
          <span className="text-[16px] font-bold tracking-[0.01em] uppercase">MetaProof</span>
        </span>
        <button type="button" onClick={() => close()} className="glass h-10 rounded-full px-4 text-sm">
          Skip
        </button>
      </div>

      <div className="stagger mt-8 [&>*]:animate-rise [@media(max-height:720px)]:mt-5">
        <h1
          id="welcome-title"
          className="text-[44px] leading-[0.98] font-normal tracking-[-0.04em] [@media(max-height:720px)]:text-[36px]"
        >
          See what's behind the image
        </h1>
        <p className="mt-3 flex items-center gap-1.5 text-[14px] text-white/80">
          <Lock className="size-3.5" strokeWidth={1.75} /> No account needed
        </p>
      </div>

      {/* The six checks around the lens; it gives way on short phones so both buttons stay above the fold. */}
      <div className="flex flex-1 items-center py-4 [@media(max-height:720px)]:hidden">
        <CheckWheel items={CHECKS} active={active} onSelect={setActive} className="mx-auto max-w-[340px]" center={<Lens />} />
      </div>

      <div className="flex flex-col gap-3 [@media(max-height:720px)]:mt-auto">
        <button
          ref={primary}
          type="button"
          onClick={() => close('/new')}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-white text-[16px] font-medium text-[#1d1b17]"
        >
          Analyze an image <ArrowRight className="size-4" strokeWidth={2} />
        </button>
        <button type="button" onClick={() => close(DEMO_REPORT_PATH)} className="glass h-14 w-full rounded-full text-[16px]">
          See an example report
        </button>
        <p className="mt-1 text-center text-[12px] leading-relaxed text-white/70">
          Files are deleted after analysis. Your history stays on this device.
        </p>
      </div>
    </div>
  )
}
