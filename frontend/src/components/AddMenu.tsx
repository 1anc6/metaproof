import { Camera, ClipboardPaste, Images, Plus, Sparkles, type LucideIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type ChangeEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { DEMO_REPORT_PATH } from '../lib/demo'
import { ACCEPTED, handOver, imageFromClipboard } from '../lib/upload'

// A file field opens the camera on phones and tablets; elsewhere it would only pick a file again.
const touch = typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const OPEN_MS = 480
const CLOSE_MS = 360

type Stage = 'closed' | 'open' | 'closing'
type Action = 'choose' | 'camera' | 'paste' | 'example'

const ACTIONS: { key: Action; icon: LucideIcon; label: string }[] = [
  { key: 'choose', icon: Images, label: 'Choose a photo' },
  ...(touch ? [{ key: 'camera' as const, icon: Camera, label: 'Take a photo' }] : []),
  { key: 'paste', icon: ClipboardPaste, label: 'Paste an image' },
  { key: 'example', icon: Sparkles, label: 'See an example' },
]

/** A clip of the w × h menu showing only a circle of diameter d centred at (x, y). */
const circle = (w: number, h: number, d: number, x: number, y: number) =>
  `inset(${y - d / 2}px ${w - x - d / 2}px ${h - y - d / 2}px ${x - d / 2}px round ${d / 2}px)`
const WHOLE = 'inset(0px 0px 0px 0px round 28px)'

/**
 * The phone bar's +, after iOS's liquid glass. Pressed, the button swells and rises as a round lens
 * that opens out into the menu, its contents coming into focus as it settles; closing, the menu
 * shrinks back down into the button as a drop, and the button wobbles round again. A photo picked
 * here goes straight to New analysis, which starts it.
 */
export function AddMenu() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [stage, setStage] = useState<Stage>('closed')
  const [openedOn, setOpenedOn] = useState(pathname)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const tint = useRef<HTMLSpanElement>(null)
  const items = useRef<HTMLDivElement>(null)
  const choose = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const hidden = useRef<Animation | null>(null)

  const close = (refocus = false) => {
    setStage((s) => (s === 'open' ? 'closing' : s))
    if (refocus) button.current?.focus()
  }

  // Leaving the screen (N, or the back button) closes it.
  if (stage === 'open' && openedOn !== pathname) {
    setOpenedOn(pathname)
    setStage('closing')
  }

  useLayoutEffect(() => {
    const p = panel.current
    const b = button.current
    if (!p || !b || stage === 'closed') return
    const w = p.offsetWidth
    const h = p.offsetHeight
    const d = b.offsetWidth
    const atButton = circle(w, h, d, w - d / 2, h - d / 2)

    if (stage === 'open') {
      items.current?.querySelector('button')?.focus({ preventScroll: true })
      if (still()) {
        hidden.current = b.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1, fill: 'forwards' })
        return
      }
      // the button swells and lets go, as the lens rises off it
      hidden.current = b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)', offset: 0.4 }, { transform: 'scale(1.18)', opacity: 0 }], {
        duration: 200,
        easing: 'ease-out',
        fill: 'forwards',
      })
      p.animate(
        [
          { clipPath: atButton, transform: 'scale(1)' },
          { clipPath: circle(w, h, d * 1.6, w - d * 0.95, h - d * 1.3), transform: 'scale(1)', offset: 0.32 },
          { clipPath: WHOLE, transform: 'scale(1.03)', offset: 0.72 },
          { clipPath: WHOLE, transform: 'scale(1)' },
        ],
        { duration: OPEN_MS, easing: EASE },
      )
      // the lime of the button clears into glass as it rises
      tint.current?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.12 }, { opacity: 0, offset: 0.55 }, { opacity: 0 }], { duration: OPEN_MS })
      items.current?.animate(
        [
          { opacity: 0, filter: 'blur(10px)', transform: 'scale(1.22)' },
          { opacity: 0.5, filter: 'blur(6px)', transform: 'scale(1.12)', offset: 0.35 },
          { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
        ],
        { duration: OPEN_MS, easing: EASE },
      )
      return
    }

    // closing: down into a drop on the button, then the button wobbles back
    const done = () => {
      hidden.current?.cancel()
      setStage('closed')
      if (!still())
        b.animate(
          [
            { transform: 'scale(0.86, 1.14)' },
            { transform: 'scale(1.08, 0.94)', offset: 0.45 },
            { transform: 'scale(0.97, 1.03)', offset: 0.75 },
            { transform: 'scale(1)' },
          ],
          { duration: 420, easing: 'ease-out' },
        )
    }
    if (still()) {
      done()
      return
    }
    items.current?.animate([{ opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }, { opacity: 0, filter: 'blur(8px)', transform: 'scale(0.9)', offset: 0.5 }, { opacity: 0 }], {
      duration: CLOSE_MS,
      fill: 'forwards',
    })
    tint.current?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.45 }, { opacity: 1, offset: 0.85 }, { opacity: 1 }], { duration: CLOSE_MS, fill: 'forwards' })
    const shrink = p.animate(
      [
        { clipPath: WHOLE },
        { clipPath: `inset(${h * 0.22}px ${w * 0.1}px ${d * 0.1}px ${w * 0.3}px round 40px)`, offset: 0.4 },
        { clipPath: `inset(${h - d * 1.55}px 0px 0px ${w - d}px round ${d / 2}px)`, offset: 0.78 },
        { clipPath: atButton },
      ],
      { duration: CLOSE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
    )
    shrink.onfinish = done
    return () => {
      shrink.onfinish = null
    }
  }, [stage])

  const go = (file: File) => {
    handOver(file)
    navigate('/new')
  }
  const picked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // the same photo can be picked again
    if (file) go(file)
  }
  const act = async (key: Action) => {
    close()
    if (key === 'choose') choose.current?.click()
    else if (key === 'camera') camera.current?.click()
    else if (key === 'example') navigate(DEMO_REPORT_PATH)
    else {
      try {
        const file = await imageFromClipboard()
        if (file) go(file)
        else toast('There is no image on the clipboard.')
      } catch {
        toast('This browser did not let MetaProof read the clipboard. Choose a photo instead.')
      }
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-label="New analysis"
        title="New analysis (N)"
        aria-expanded={stage === 'open'}
        aria-controls="add-menu"
        onClick={() => {
          if (stage !== 'closed') return
          setOpenedOn(pathname)
          setStage('open')
        }}
        className="fab size-[58px] outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)] min-[400px]:size-16"
      >
        <Plus className="size-7" strokeWidth={1.9} aria-hidden />
      </button>

      {stage !== 'closed' && (
        <>
          {/* a tap anywhere else closes it, without reaching what is underneath */}
          <div className="fixed inset-0" onPointerDown={() => close()} aria-hidden />
          <div
            ref={panel}
            id="add-menu"
            role="group"
            aria-label="New analysis"
            onKeyDown={(e) => e.key === 'Escape' && close(true)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && close()}
            className="add-menu glass absolute right-0 bottom-0 w-[236px] rounded-[28px] p-2"
          >
            <span ref={tint} className="add-menu-tint" aria-hidden />
            <div ref={items} className="add-menu-items relative flex flex-col">
              {ACTIONS.map(({ key, icon: Icon, label }, i) => (
                <button key={key} type="button" onClick={() => act(key)} className="add-menu-item">
                  <span className={`grid size-8 shrink-0 place-items-center rounded-full ${i === 0 ? 'bg-primary text-on-primary' : 'bg-[var(--btn-bg)]'}`}>
                    <Icon className="size-4" strokeWidth={1.9} aria-hidden />
                  </span>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <input ref={choose} type="file" accept={ACCEPTED.join(',')} onChange={picked} className="hidden" tabIndex={-1} aria-hidden />
      {touch && <input ref={camera} type="file" accept="image/*" capture="environment" onChange={picked} className="hidden" tabIndex={-1} aria-hidden />}
    </div>
  )
}
