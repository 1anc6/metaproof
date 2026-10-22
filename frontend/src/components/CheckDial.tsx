import { ChevronDown, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api, type JobStatus, type VerdictLabel } from '../lib/api'
import { CHECKS } from '../lib/checks'
import { usePrefs } from '../lib/prefs'
import { FileName, Mark, VerdictBadge } from './ui'

/** An analyzed image for the canvas: its thumbnail, name and verdict. */
export interface CanvasPhoto {
  sha: string
  name: string
  label: VerdictLabel | null
  status: JobStatus
}

const AUTOPLAY_MS = 3600
const IDLE_MS = 7000 // after a person touches the dial, wait this long before it moves on its own again
const STEP = 360 / CHECKS.length

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The ring angle closest to `current` that brings check `i` to the top, so it turns the short way. */
function nearest(current: number, i: number) {
  const target = -i * STEP
  return current + (((((target - current) % 360) + 540) % 360) - 180)
}

/**
 * The reference's tool dial, holding MetaProof's six checks: a dark glossy lens under an arc, the
 * chosen check in a chip above it and its neighbours on the arc's ends, over a black-and-white photo
 * card whose serif headline follows the chosen check. Below, a toolbar picks a check, shows its
 * weight, and steps or pauses the tour. It moves on by itself until someone touches it, and holds
 * still for reduced motion. With a `photo`, the card shows that analyzed image whole (never cropped
 * or stretched) over a blurred copy of itself, with its name and verdict; without one, or if its
 * thumbnail won't load, a drawn horizon.
 */
export function CheckDial({
  active,
  onSelect,
  photo,
  className = '',
}: {
  active: string
  onSelect: (key: string) => void
  photo?: CanvasPhoto
  className?: string
}) {
  const { blurPreviews } = usePrefs()
  const [failed, setFailed] = useState<string | null>(null) // the sha whose thumbnail would not load
  const pic = photo && failed !== photo.sha ? photo : null
  const n = CHECKS.length
  const index = Math.max(0, CHECKS.findIndex((c) => c.key === active))
  const check = CHECKS[index]
  const prev = CHECKS[(index - 1 + n) % n]
  const next = CHECKS[(index + 1) % n]

  const [playing, setPlaying] = useState(() => !reducedMotion())
  const lastTouch = useRef(-Infinity)
  const touch = () => {
    lastTouch.current = performance.now()
  }
  const choose = (key: string) => {
    touch()
    onSelect(key)
  }

  // The tick ring turns so the chosen check sits under the knob, the short way round.
  const [ring, setRing] = useState(() => -index * STEP)
  const [shown, setShown] = useState(index)
  if (shown !== index) {
    setShown(index)
    setRing(nearest(ring, index))
  }

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      if (document.hidden || performance.now() - lastTouch.current < IDLE_MS) return
      onSelect(CHECKS[(index + 1) % n].key)
    }, AUTOPLAY_MS)
    return () => clearInterval(t)
  }, [playing, index, n, onSelect])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      choose(next.key)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      choose(prev.key)
    }
  }

  const Icon = check.icon
  const PrevIcon = prev.icon
  const NextIcon = next.icon
  const turn = 'transform 900ms cubic-bezier(0.23, 1, 0.32, 1)'

  return (
    <div className={`mx-auto w-full max-w-[460px] select-none ${className}`}>
      {/* The dial: drawn on a 400 × 170 grid, the lens centred at (200, 150). */}
      <div className="relative z-10 aspect-[400/170] w-full">
        <svg viewBox="0 0 400 170" className="absolute inset-0 size-full overflow-hidden text-ink" aria-hidden>
          <path d="M100 150 A100 100 0 0 1 300 150" fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
          <circle cx="100" cy="150" r="3" fill="currentColor" fillOpacity="0.7" />
          <circle cx="300" cy="150" r="3" fill="currentColor" fillOpacity="0.7" />
          {/* one tick per check, turning under the knob */}
          <g style={{ transform: `rotate(${ring}deg)`, transformOrigin: '200px 150px', transition: turn }}>
            {CHECKS.map((c, i) => {
              const a = ((-90 + i * STEP) * Math.PI) / 180
              return (
                <circle
                  key={c.key}
                  cx={200 + 100 * Math.cos(a)}
                  cy={150 + 100 * Math.sin(a)}
                  r={i === index ? 0 : 2.2}
                  fill="currentColor"
                  fillOpacity="0.55"
                  style={{ transition: 'r 400ms' }}
                />
              )
            })}
          </g>
          <line x1="200" y1="37" x2="200" y2="44" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.4" />
          {/* the knob at the top of the arc */}
          <circle cx="200" cy="50" r="9" fill="currentColor" fillOpacity="0.18" />
          <circle cx="200" cy="50" r="6.5" fill="currentColor" fillOpacity="0.55" />
          <circle cx="200" cy="50" r="3" fill="currentColor" />
        </svg>

        {/* the chosen check, above the knob */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2">
          <span key={check.key} className="chip animate-pop h-10 px-4 text-[14px]" aria-live="polite">
            <Icon className="size-4" strokeWidth={1.5} aria-hidden />
            {check.label}
          </span>
        </div>

        {/* its neighbours, on the ends of the arc */}
        <button
          type="button"
          onClick={() => choose(prev.key)}
          aria-label={`Previous check: ${prev.label}`}
          className="chip absolute top-[88.2%] right-[75%] h-9 -translate-y-1/2 px-3 transition hover:brightness-110 max-[400px]:[&>span]:sr-only"
        >
          <PrevIcon className="size-4" strokeWidth={1.5} aria-hidden />
          <span>{prev.label}</span>
        </button>
        <button
          type="button"
          onClick={() => choose(next.key)}
          aria-label={`Next check: ${next.label}`}
          className="chip absolute top-[88.2%] left-[75%] h-9 -translate-y-1/2 px-3 transition hover:brightness-110 max-[400px]:[&>span]:sr-only"
        >
          <NextIcon className="size-4" strokeWidth={1.5} aria-hidden />
          <span>{next.label}</span>
        </button>

        {/* the lens: a dark glossy disc that turns to show the chosen check */}
        <button
          type="button"
          onClick={() => choose(next.key)}
          onKeyDown={onKeyDown}
          aria-label={`${check.label}. Arrow keys choose another check.`}
          className="absolute top-[88.2%] left-1/2 grid aspect-square w-[23%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[radial-gradient(circle_at_50%_32%,#4a4a4a_0%,#232323_55%,#121212_100%)] text-white shadow-[0_0_0_1px_rgb(255_255_255/0.14),0_16px_30px_-10px_rgb(0_0_0/0.7),inset_0_2px_3px_rgb(255_255_255/0.22),inset_0_-6px_12px_rgb(0_0_0/0.5)] transition active:scale-95"
        >
          <span className="absolute inset-[9%] rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]" aria-hidden />
          <Icon key={check.key} className="animate-pop size-[34%]" strokeWidth={1.25} aria-hidden />
        </button>
      </div>

      {/* The canvas: the latest analyzed image, or a black-and-white horizon, under the check's
          headline in the reference's serif. */}
      <div className="relative -mt-[5%] aspect-[4/3] w-full overflow-hidden sm:aspect-[5/4] lg:aspect-[4/3] rounded-[22px] bg-[#1a1a1a] text-white shadow-[0_24px_44px_-24px_rgb(0_0_0/0.7),inset_0_0_0_1px_rgb(255_255_255/0.1)]">
        {pic ? (
          <>
            <img src={api.thumbnailUrl(pic.sha)} alt="" aria-hidden className="absolute inset-0 size-full scale-125 object-cover opacity-60 blur-2xl" />
            <img
              src={api.thumbnailUrl(pic.sha)}
              alt={`Latest analyzed image: ${pic.name}`}
              onError={() => setFailed(pic.sha)}
              className={`absolute inset-0 size-full object-contain transition-[filter] duration-300 ${blurPreviews ? 'blur-xl' : ''}`}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/20 to-black/10" aria-hidden />
          </>
        ) : (
          <Horizon turn={index} />
        )}
        <div className="absolute inset-x-0 top-[9%] flex items-start justify-between gap-3 px-4">
          {pic ? (
            <div className="min-w-0 text-[11px] leading-tight">
              <FileName name={pic.name} />
              <span className="block text-white/70">Latest analysis</span>
            </div>
          ) : (
            <p className="text-[11px] leading-tight">
              metaproof.app
              <span className="block text-white/70">Six checks</span>
            </p>
          )}
          {pic ? (
            <span className="glass rounded-full px-2.5 py-1 [&>span]:!text-white">
              <VerdictBadge label={pic.label} status={pic.status} />
            </span>
          ) : (
            <Mark className="size-5" />
          )}
        </div>
        <div className="relative flex flex-col items-center px-6 pt-[19%] text-center">
          <p key={check.key} className="animate-rise display text-[clamp(28px,7.6vw,38px)] leading-[0.95]">
            {check.headline[0]}
            <br />
            {check.headline[1].split(' ').slice(0, -1).join(' ')}{' '}
            <span className="mark-word [--color-highlight:rgb(255_255_255/0.28)]">{check.headline[1].split(' ').pop()}</span>
          </p>
        </div>
      </div>

      {/* The toolbar: pick a check · its weight · step and pause. */}
      <div className="mt-3 flex items-center gap-2">
        <div className="chip h-11 min-w-0 flex-1 gap-0 px-1.5 text-[14px]">
          <label className="relative flex h-full min-w-0 flex-1 items-center">
            <span className="sr-only">Check</span>
            <select
              value={check.key}
              onChange={(e) => choose(e.target.value)}
              className="h-full w-full min-w-0 cursor-pointer appearance-none truncate rounded-full bg-transparent pr-6 pl-2.5 outline-none focus-visible:outline-2 focus-visible:outline-ink [&>option]:text-black"
            >
              {CHECKS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-1.5 size-4 text-faint" aria-hidden />
          </label>
          <span className="mx-1.5 h-5 w-px bg-line-strong" aria-hidden />
          <span className="truncate px-1.5 text-faint max-sm:hidden lg:max-xl:hidden">{check.weight}</span>
          <span className="mx-1.5 h-5 w-px bg-line-strong max-sm:hidden lg:max-xl:hidden" aria-hidden />
          <span className="flex shrink-0 items-center gap-1.5 pr-2.5">
            <span className={`size-2.5 rounded-full bg-accent ${playing ? 'animate-pulse' : 'opacity-50'}`} aria-hidden />
            {playing ? 'Touring' : 'Paused'}
          </span>
        </div>
        <div className="track flex h-11 shrink-0 items-center gap-0.5 rounded-full p-1" role="group" aria-label="Tour of the checks">
          <button type="button" onClick={() => choose(prev.key)} aria-label="Previous check" className="grid size-9 place-items-center rounded-full text-faint transition hover:text-ink">
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? 'Pause the tour' : 'Play the tour'}
            aria-pressed={playing}
            className={`grid size-9 place-items-center rounded-full transition ${playing ? 'selected' : 'text-faint hover:text-ink'}`}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button type="button" onClick={() => choose(next.key)} aria-label="Next check" className="grid size-9 place-items-center rounded-full text-faint transition hover:text-ink">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The reference's photograph, drawn: a dark sky opening onto a bright horizon, a low sun, and a
 * jetty running out from the corner with one small figure at its end, under a film grain. The
 * clouds drift and the sun breathes; each check nudges the light along the horizon.
 */
function Horizon({ turn }: { turn: number }) {
  return (
    <svg viewBox="0 0 400 320" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 size-full" aria-hidden>
      <defs>
        <linearGradient id="hz-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1b1b" />
          <stop offset="0.38" stopColor="#5d5d5d" />
          <stop offset="0.6" stopColor="#d9d9d9" />
          <stop offset="0.655" stopColor="#f4f4f4" />
          <stop offset="0.67" stopColor="#c9c9c9" />
          <stop offset="0.82" stopColor="#7a7a7a" />
          <stop offset="1" stopColor="#3b3b3b" />
        </linearGradient>
        <radialGradient id="hz-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="hz-jetty" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#0d0d0d" />
          <stop offset="1" stopColor="#3a3a3a" />
        </linearGradient>
        <filter id="hz-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="hz-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0" />
        </filter>
      </defs>
      <rect width="400" height="320" fill="url(#hz-sky)" />
      {/* light pooling on the horizon, moving a little with each check */}
      <ellipse
        cx="200"
        cy="208"
        rx="190"
        ry="26"
        fill="url(#hz-glow)"
        style={{ transform: `translateX(${(turn - 2.5) * 14}px)`, transition: 'transform 1400ms cubic-bezier(0.23, 1, 0.32, 1)' }}
      />
      {/* clouds */}
      <g className="animate-[drift_38s_linear_infinite]" filter="url(#hz-soft)" fill="#fff">
        <ellipse cx="80" cy="150" rx="90" ry="10" opacity="0.18" />
        <ellipse cx="300" cy="170" rx="120" ry="9" opacity="0.22" />
        <ellipse cx="520" cy="150" rx="90" ry="10" opacity="0.18" />
        <ellipse cx="180" cy="120" rx="70" ry="6" opacity="0.1" />
      </g>
      {/* the low sun, breathing */}
      <circle cx="300" cy="236" r="30" fill="url(#hz-glow)" className="animate-[sunglow_5s_ease-in-out_infinite] [transform-box:fill-box] [transform-origin:center]" />
      <circle cx="300" cy="236" r="15" fill="#f5f5f5" />
      {/* the jetty and its figure */}
      <path d="M-10 290 L246 232 L258 234 L70 330 L-10 330 Z" fill="url(#hz-jetty)" />
      <path d="M-10 290 L246 232" stroke="#fff" strokeOpacity="0.35" strokeWidth="0.8" />
      <rect x="241" y="223" width="2.2" height="9" rx="1" fill="#111" />
      <circle cx="242.1" cy="222" r="1.7" fill="#111" />
      <rect width="400" height="320" filter="url(#hz-grain)" opacity="0.22" />
    </svg>
  )
}
