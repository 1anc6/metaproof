import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export interface WheelItem {
  key: string
  label: string
  icon: LucideIcon
}

const R = 160 // outer radius of a segment
const r = 86 // inner radius
const LIFT = 14 // how far the chosen segment moves out
const GROW = 12 // and how much longer it gets
const GAP = 3.2 // degrees between segments
const ROUND = 12 // stroke width that rounds the corners
const AUTOPLAY_MS = 3200
const IDLE_MS = 7000 // after a person touches the wheel, wait this long before it moves on its own again

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The wheel angle closest to `current` that puts the segment at `at` degrees at the bottom. */
function nearestAngle(current: number, at: number) {
  const target = 180 - at
  return current + (((((target - current) % 360) + 540) % 360) - 180)
}

/** An annular sector, pulled in by half the stroke so the round stroke lands on the true edge. */
function sector(a0: number, a1: number, outer: number, inner: number) {
  const inset = ROUND / 2
  const ro = outer - inset
  const ri = inner + inset
  const da = (inset / ((ro + ri) / 2)) * (180 / Math.PI) // the same inset at the sides, in degrees
  const p = (deg: number, rad: number) => {
    const a = ((deg - 90) * Math.PI) / 180
    return `${(180 + rad * Math.cos(a)).toFixed(2)} ${(180 + rad * Math.sin(a)).toFixed(2)}`
  }
  const s = a0 + da
  const e = a1 - da
  return `M${p(s, ro)} A${ro} ${ro} 0 0 1 ${p(e, ro)} L${p(e, ri)} A${ri} ${ri} 0 0 0 ${p(s, ri)} Z`
}

/**
 * The reference's radial menu, set in motion: the checks as soft-cornered ring segments around a
 * lens. The chosen one turns to the front (the bottom), lifts out and brightens. It turns on its
 * own until someone touches it; then it follows taps, drags and arrow keys, and snaps to the
 * nearest check. Labels stay upright while it turns. Drawn for a dark photo backdrop.
 */
export function CheckWheel({
  items,
  active,
  onSelect,
  center,
  className = '',
}: {
  items: WheelItem[]
  active: string
  onSelect: (key: string) => void
  center?: ReactNode
  className?: string
}) {
  const n = items.length
  const step = 360 / n
  const index = Math.max(0, items.findIndex((i) => i.key === active))

  // The wheel's angle: the chosen segment sits at 180° (the bottom, facing the reader). It is kept
  // cumulative so a turn always takes the short way round.
  const [angle, setAngle] = useState(() => 180 - index * step)
  const [dragging, setDragging] = useState(false)
  const lastTouch = useRef(-Infinity) // never touched: it may start turning straight away
  const svg = useRef<SVGSVGElement>(null)
  // The live angle while dragging, kept in a ref so the release sees it even before a re-render.
  const drag = useRef<{ start: number; base: number; moved: boolean; now: number } | null>(null)
  const justDragged = useRef(false) // the click that ends a drag must not pick a segment

  // When the chosen segment changes, turn to it the short way (state adjusted during render).
  const [shownIndex, setShownIndex] = useState(index)
  if (index !== shownIndex && !dragging) {
    setShownIndex(index)
    setAngle(nearestAngle(angle, index * step))
  }

  // Move on to the next check on its own, unless someone touched it recently or prefers less motion.
  useEffect(() => {
    if (reducedMotion()) return
    const t = setInterval(() => {
      if (document.hidden || drag.current || performance.now() - lastTouch.current < IDLE_MS) return
      onSelect(items[(index + 1) % n].key)
    }, AUTOPLAY_MS)
    return () => clearInterval(t)
  }, [index, items, n, onSelect])

  // Event timestamps share performance.now()'s clock.
  const touch = (e: { timeStamp: number }) => {
    lastTouch.current = e.timeStamp
  }

  const pointerAngle = (e: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect()
    const x = e.clientX - (box.left + box.width / 2)
    const y = e.clientY - (box.top + box.height / 2)
    return (Math.atan2(y, x) * 180) / Math.PI
  }

  const onPointerDown = (e: React.PointerEvent) => {
    touch(e)
    drag.current = { start: pointerAngle(e), base: angle, moved: false, now: angle }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    let delta = pointerAngle(e) - d.start
    delta = ((delta + 540) % 360) - 180
    if (!d.moved && Math.abs(delta) < 4) return // a tap, not a drag
    d.moved = true
    d.now = d.base + delta
    setDragging(true)
    setAngle(d.now)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    touch(e)
    if (!d?.moved) return
    justDragged.current = true
    setTimeout(() => (justDragged.current = false), 0)
    // Snap: whichever segment is now nearest the bottom becomes the chosen one.
    const nearest = (((Math.round((180 - d.now) / step) % n) + n) % n) as number
    setDragging(false)
    setAngle(nearestAngle(d.now, nearest * step)) // snaps even when it lands on the same check
    onSelect(items[nearest].key)
  }

  const turn = dragging ? 'none' : 'transform 900ms cubic-bezier(0.23, 1, 0.32, 1)'

  return (
    <div className={`relative aspect-square w-full touch-pan-y select-none ${className}`}>
      <svg
        ref={svg}
        viewBox="-10 -10 380 380"
        className={`absolute inset-0 size-full overflow-visible ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="group"
        aria-label="The six checks. Choose one to read about it."
      >
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '180px 180px', transition: turn }}>
          {items.map((item, i) => {
            const a0 = i * step - step / 2 + GAP / 2
            const a1 = a0 + step - GAP
            const on = i === index
            const mid = (((i * step - 90) * Math.PI) / 180)
            const lift = on ? LIFT : 0
            const Icon = item.icon
            const labelR = (R + r) / 2 + (on ? LIFT + GROW / 2 : 0)
            const lx = 180 + labelR * Math.cos(mid)
            const ly = 180 + labelR * Math.sin(mid)
            return (
              <g key={item.key}>
                <path
                  d={sector(a0, a1, R + (on ? GROW : 0), r)}
                  role="button"
                  tabIndex={0}
                  aria-label={item.label}
                  aria-pressed={on}
                  onClick={(e) => {
                    touch(e)
                    if (!justDragged.current) onSelect(item.key)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      touch(e)
                      onSelect(item.key)
                    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                      e.preventDefault()
                      touch(e)
                      onSelect(items[(index + 1) % n].key)
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                      e.preventDefault()
                      touch(e)
                      onSelect(items[(index - 1 + n) % n].key)
                    }
                  }}
                  // Solid white, made translucent as a whole, so the rounding stroke and the fill never double up.
                  className={`outline-none focus-visible:opacity-50 ${on ? 'opacity-[0.34]' : 'opacity-[0.12] hover:opacity-[0.2]'}`}
                  style={{
                    transform: `translate(${(Math.cos(mid) * lift).toFixed(2)}px, ${(Math.sin(mid) * lift).toFixed(2)}px)`,
                    transition: 'transform 700ms cubic-bezier(0.34, 1.4, 0.64, 1), opacity 500ms',
                  }}
                  fill="white"
                  stroke="white"
                  strokeWidth={ROUND}
                  strokeLinejoin="round"
                />
                {/* the label stays upright: it turns back by the wheel's angle as the wheel turns */}
                <g
                  className="pointer-events-none"
                  style={{
                    transform: `translate(${lx.toFixed(2)}px, ${ly.toFixed(2)}px) rotate(${-angle}deg)`,
                    transition: dragging ? 'none' : `transform 900ms cubic-bezier(0.23, 1, 0.32, 1)`,
                    opacity: on ? 1 : 0.8,
                  }}
                >
                  <Icon x={-11} y={-26} width={22} height={22} color="white" strokeWidth={1.25} aria-hidden />
                  <text y={14} textAnchor="middle" fill="white" fontSize={on ? 15 : 13} style={{ transition: 'font-size 400ms' }}>
                    {item.label}
                  </text>
                </g>
              </g>
            )
          })}
        </g>
      </svg>
      {center && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 grid aspect-square w-[41%] -translate-x-1/2 -translate-y-1/2 place-items-center">
          {center}
        </div>
      )}
    </div>
  )
}

/** The lens at the wheel's centre: a dark ring and a lemon disc that slowly breathes. */
export function Lens() {
  return (
    <span className="grid size-full place-items-center rounded-full bg-[#1d1b17] p-[14%] shadow-[0_10px_30px_-10px_rgb(0_0_0/0.8)]">
      <span className="animate-breathe grid size-full place-items-center rounded-full bg-[#e6ec8f] shadow-[0_0_40px_-6px_rgb(230_236_143/0.6)]">
        <span className="size-[9%] rounded-full bg-[#1d1b17]" />
      </span>
    </span>
  )
}
