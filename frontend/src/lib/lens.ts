import { useLayoutEffect, useState, type RefObject } from 'react'

type Axis = 'x' | 'y'
type Span = { at: number; size: number }

const TRAVEL_MS = 420
const LIFT = 1.12 // how much larger the lens is than the pill while it is lifted
const STRETCH = 0.18 // how much longer it grows along its path at full speed

const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const easeOut = (t: number) => 1 - (1 - t) ** 3

/** Where an element sits inside the box along the axis: its start and its length. */
function measure(el: Element, box: Element, axis: Axis): Span {
  const a = el.getBoundingClientRect()
  const b = box.getBoundingClientRect()
  return axis === 'x' ? { at: a.left - b.left, size: a.width } : { at: a.top - b.top, size: a.height }
}

/**
 * The liquid-glass selection of a tab bar or rail, after iOS: one lens under the chosen item.
 * When the choice changes it lifts into clear glass, slides to the new item stretching with its
 * speed, and settles back into the pill with a small bounce. While lifted, a finger can carry it
 * along the bar (`follow`), and `drop` says which item it was let go over.
 */
class Lens {
  private readonly axis: Axis
  private box: HTMLElement | null = null
  private el: HTMLElement | null = null
  private at: Span | null = null
  private raf = 0
  private moving = false
  private lifted = false
  private shown = -1
  private pointer: number | null = null // where the finger carrying the lens is, within the box
  private observer: ResizeObserver | null = null

  constructor(axis: Axis) {
    this.axis = axis
  }

  attach(box: HTMLElement | null, el: HTMLElement | null) {
    this.box = box
    this.el = el
    if (!box) return
    // keep it under its item when the bar or an item changes size (a tab opening out to its name,
    // a font arriving), unless it is on its way somewhere or being carried
    this.observer = new ResizeObserver(() => {
      if (!this.moving && !this.lifted && this.shown >= 0) this.place(this.shown)
    })
    this.observer.observe(box)
    for (const el of this.items()) this.observer.observe(el)
  }

  detach() {
    this.observer?.disconnect()
    cancelAnimationFrame(this.raf)
    this.moving = false
  }

  /** The chosen item changed: travel there. From nothing (or to nothing) it appears or fades in place. */
  show(active: number) {
    const before = this.shown
    this.shown = active
    if (!this.el) return
    this.el.dataset.hidden = String(active < 0)
    if (active < 0) return
    if (before < 0) this.place(active)
    else this.travel(active)
  }

  /** A press on the bar: the pill lifts into the lens where it is. */
  lift() {
    if (!this.el || !this.at || this.shown < 0 || still()) return
    cancelAnimationFrame(this.raf)
    this.moving = false
    this.pointer = null
    this.setLifted(true)
    this.draw(this.at, LIFT, LIFT)
  }

  /** Carries the lifted lens so its middle sits under the pointer, within the bar. */
  follow(client: number) {
    if (!this.box || !this.at) return
    const b = this.box.getBoundingClientRect()
    const [start, length] = this.axis === 'x' ? [b.left, b.width] : [b.top, b.height]
    const size = this.at.size
    const inset = 6
    this.pointer = client - start
    this.draw({ at: Math.max(inset, Math.min(length - inset - size, client - start - size / 2)), size }, LIFT, LIFT)
  }

  /** Which item the finger let go of the lens over (or the lens's middle, if it was not carried); -1 for none. */
  drop() {
    const box = this.box
    const at = this.at
    if (!box || !at) return -1
    const point = this.pointer ?? at.at + at.size / 2
    this.pointer = null
    return this.items().findIndex((el) => {
      const s = measure(el, box, this.axis)
      return point >= s.at && point <= s.at + s.size
    })
  }

  /** Back down onto the chosen item, after a press that chose nothing new. */
  home() {
    if (this.shown >= 0) this.travel(this.shown)
  }

  private items() {
    return Array.from(this.box?.querySelectorAll('[data-lens-item]') ?? [])
  }

  private setLifted(on: boolean) {
    this.lifted = on
    this.el?.classList.toggle('is-lifted', on)
    // while the pill is lifted into clear glass, the chosen item's type is no longer on white
    this.box?.classList.toggle('lens-lifted', on)
  }

  private draw(span: Span, sx = 1, sy = 1) {
    if (!this.el) return
    this.at = span
    this.el.style.setProperty('--at', `${span.at}px`)
    this.el.style.setProperty('--size', `${span.size}px`)
    this.el.style.setProperty('--sx', sx.toFixed(4))
    this.el.style.setProperty('--sy', sy.toFixed(4))
  }

  private place(i: number) {
    const target = this.items()[i]
    if (target && this.box) this.draw(measure(target, this.box, this.axis))
  }

  /** Slides the lens from where it is to item `to`, reading the target every frame so it can land
   *  on an item that is still growing. */
  private travel(to: number) {
    cancelAnimationFrame(this.raf)
    const box = this.box
    const target = this.items()[to]
    const from = this.at
    if (!box || !target) return
    if (!from || still()) {
      this.setLifted(false)
      this.draw(measure(target, box, this.axis))
      return
    }
    const wasLifted = this.lifted
    this.setLifted(true)
    this.moving = true
    const begin = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - begin) / TRAVEL_MS)
      const p = easeOut(t) // off at once, as a finger flicks it, and easing in to land
      const end = measure(target, box, this.axis)
      // up at once (or already up from the press), level while it travels, down as it lands
      const rise = wasLifted ? 1 : Math.min(1, t / 0.15)
      const fall = t < 0.6 ? 1 : 1 - easeOut((t - 0.6) / 0.4)
      const lift = 1 + (LIFT - 1) * rise * fall
      const speed = Math.sin(Math.PI * p) * Math.min(1, Math.abs(end.at - from.at) / 120)
      const along = lift * (1 + STRETCH * speed)
      const across = lift * (1 - STRETCH * 0.35 * speed)
      this.draw(
        { at: from.at + (end.at - from.at) * p, size: from.size + (end.size - from.size) * p },
        this.axis === 'x' ? along : across,
        this.axis === 'x' ? across : along,
      )
      // the clear glass clouds back into the pill as it comes down
      if (t > 0.68 && this.lifted) this.setLifted(false)
      if (t < 1) this.raf = requestAnimationFrame(tick)
      else {
        this.moving = false
        this.bounce()
      }
    }
    this.raf = requestAnimationFrame(tick)
  }

  /** A quick squash and recover as the glass lands. */
  private bounce() {
    const glass = this.el?.firstElementChild
    if (!glass || still()) return
    const [a, b] = this.axis === 'x' ? ['1.05, 0.93', '0.985, 1.02'] : ['0.94, 1.06', '1.02, 0.985']
    glass.animate([{ transform: 'scale(1, 1)' }, { transform: `scale(${a})` }, { transform: `scale(${b})` }, { transform: 'scale(1, 1)' }], {
      duration: 320,
      easing: 'ease-out',
    })
  }
}

/**
 * One lens for a bar of items. `box` holds the items, marked `data-lens-item`, in order; `lens` is
 * a `.lens` element inside it with one child, the glass. `active` is the chosen item, or -1.
 */
export function useLens(box: RefObject<HTMLElement | null>, lens: RefObject<HTMLElement | null>, active: number, axis: Axis = 'x') {
  const [glass] = useState(() => new Lens(axis))
  useLayoutEffect(() => {
    glass.attach(box.current, lens.current)
    return () => glass.detach()
  }, [glass, box, lens])
  useLayoutEffect(() => {
    glass.show(active)
  }, [glass, active])
  return glass
}
