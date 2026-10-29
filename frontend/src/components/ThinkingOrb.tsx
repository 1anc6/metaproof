import { useEffect, useRef } from 'react'

// A small rotating sphere drawn on canvas, for "the server is working on it" moments.
// 'dots' is a sphere of points; 'lines' is a globe of meridians. Both take currentColor,
// fade the far side so the rotation reads as depth, and hold still for reduced motion.
type Variant = 'dots' | 'lines'

const TILT = 0.38 // radians the sphere leans towards the viewer, so the poles show

/** Evenly spread points on a unit sphere (Fibonacci lattice). */
function lattice(n: number): [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5))
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    return [Math.cos(golden * i) * r, y, Math.sin(golden * i) * r]
  })
}

function project([x, y, z]: [number, number, number], spin: number): [number, number, number] {
  const cx = x * Math.cos(spin) + z * Math.sin(spin)
  const cz = -x * Math.sin(spin) + z * Math.cos(spin)
  return [cx, y * Math.cos(TILT) - cz * Math.sin(TILT), y * Math.sin(TILT) + cz * Math.cos(TILT)]
}

export function ThinkingOrb({ size = 36, variant = 'dots', className = '' }: { size?: number; variant?: Variant; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = canvas.height = Math.round(size * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const color = getComputedStyle(canvas).color
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const c = size / 2
    const r = c - 1.5
    const points = lattice(Math.round(size * 2.4))
    const meridians = 18

    const draw = (t: number) => {
      const spin = still ? 0.6 : t / 1400
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = ctx.strokeStyle = color
      if (variant === 'dots') {
        for (const p of points) {
          const [x, y, z] = project(p, spin)
          const near = (z + 1) / 2
          ctx.globalAlpha = 0.12 + 0.88 * near * near
          ctx.beginPath()
          ctx.arc(c + x * r, c - y * r, 0.45 + 0.75 * near, 0, Math.PI * 2)
          ctx.fill()
        }
      } else {
        ctx.lineWidth = 0.9
        for (let m = 0; m < meridians; m++) {
          const phi = (m / meridians) * Math.PI * 2
          // Depth of the meridian's equator point decides how bright the whole line is.
          const [, , zMid] = project([Math.sin(phi), 0, Math.cos(phi)], spin)
          ctx.globalAlpha = 0.08 + 0.8 * ((zMid + 1) / 2) ** 2
          ctx.beginPath()
          for (let s = 0; s <= 16; s++) {
            const psi = -Math.PI / 2 + (s / 16) * Math.PI
            const [x, y] = project([Math.cos(psi) * Math.sin(phi), Math.sin(psi), Math.cos(psi) * Math.cos(phi)], spin)
            if (s === 0) ctx.moveTo(c + x * r, c - y * r)
            else ctx.lineTo(c + x * r, c - y * r)
          }
          ctx.stroke()
        }
      }
      ctx.globalAlpha = 1
    }

    if (still) {
      draw(0)
      return
    }
    let raf = requestAnimationFrame(function loop(t) {
      draw(t)
      raf = requestAnimationFrame(loop)
    })
    return () => cancelAnimationFrame(raf)
  }, [size, variant])

  return <canvas ref={ref} aria-hidden className={className} style={{ width: size, height: size }} />
}

/** The orb on a white tile beside what is happening, like "Reading metadata…". Announced politely. */
export function ThinkingPill({ label, variant = 'dots', className = '' }: { label: string; variant?: Variant; className?: string }) {
  return (
    <span role="status" className={`well inline-flex items-center gap-3 rounded-[18px] py-1.5 pr-4 pl-1.5 ${className}`}>
      <span className="raise grid size-10 shrink-0 place-items-center rounded-[13px] text-primary">
        <ThinkingOrb size={28} variant={variant} />
      </span>
      <span className="min-w-0 text-[14.5px] font-medium text-ink">{label}</span>
    </span>
  )
}
