import { Pause, Play } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getGravityStatus, GRAVITY_DEFAULTS, resetGravity, type OrbSize, type OrbState } from 'thinking-orbs'
import { dotCount, KNOBS, ORB_GUIDE, SHAPES, TINTS, tunedValue } from '../lib/orbs'
import { setOrbPrefs, usePrefs, type OrbPrefs } from '../lib/prefs'
import { Row, Segmented, Slider, SwitchRow } from './Controls'
import { ThinkingOrb } from './ThinkingOrb'

const SIZES: OrbSize[] = [64, 32, 20]
const times = (v: number) => `${Number(v.toFixed(2))}×`

/**
 * The orbs' playground, after the one on libraries.dev/orbs: a stage with one orb, and the controls
 * that tune every orb in MetaProof. The state, size and the stage's surface only change the stage;
 * the rest is saved in this browser and applies everywhere at once.
 */
export function OrbPlayground() {
  const o = usePrefs().orbs
  const [pick, setPick] = useState(5) // the listening orb, as in the library's own example
  const [size, setSize] = useState<OrbSize>(64)
  const [paper, setPaper] = useState(false)
  const choice = ORB_GUIDE[pick]
  const count = dotCount(choice.state, size, o.dots, choice.frame)

  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* The stage names its surface, and the orb takes its ink from it, as the library's "auto"
            theme does in a project that marks its themes with data-theme. */}
        <div
          data-theme={paper ? 'light' : 'dark'}
          className={`flex h-[200px] flex-col items-center justify-center gap-4 rounded-[22px] px-4 text-center transition-colors ${
            paper ? 'bg-[#f4f1ec] text-[#2a221b] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)]' : 'well text-ink'
          }`}
        >
          <ThinkingOrb state={choice.state} frame={choice.frame} size={size} on="auto" label={choice.label} />
          <span className="text-[14px] font-medium">{choice.label}</span>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          {/* pauses every orb in the app, not just this one */}
          <button
            type="button"
            onClick={() => setOrbPrefs({ animate: !o.animate })}
            aria-label={o.animate ? 'Pause the orbs' : 'Play the orbs'}
            title={o.animate ? 'Hold every orb still' : 'Set the orbs moving again'}
            className="btn-ghost btn-sm"
          >
            {o.animate ? <Pause className="size-4" strokeWidth={1.8} /> : <Play className="size-4" strokeWidth={1.8} />}
            {o.animate ? 'Pause' : 'Play'}
          </button>
          <Segmented
            label="Stage surface"
            options={[
              { value: false, name: 'Glass' },
              { value: true, name: 'Paper' },
            ]}
            value={paper}
            onChange={setPaper}
          />
        </div>
      </div>

      <Row label="State">
        <div role="radiogroup" aria-label="Orb shown on the stage" className="flex flex-wrap gap-1.5">
          {ORB_GUIDE.map((g, i) => (
            <button
              key={g.name}
              type="button"
              role="radio"
              aria-checked={pick === i}
              onClick={() => setPick(i)}
              className={`h-8 rounded-full px-3 text-[13px] transition ${pick === i ? 'selected font-medium' : 'track text-muted hover:text-ink'}`}
            >
              {g.name}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[13px] leading-snug text-faint">{choice.meaning}</p>
      </Row>

      <Row label="Size">
        <Segmented
          label="Orb size on the stage"
          options={SIZES.map((s) => ({ value: s, name: `${s} px` }))}
          value={size}
          onChange={setSize}
        />
      </Row>

      <Slider label="Speed" value={o.speed} min={0.25} max={2} step={0.05} show={times} onChange={(speed) => setOrbPrefs({ speed })} />

      <Row label="Colour">
        <Tints tint={o.tint} />
      </Row>

      <Slider label="Dots amount" value={o.dots} min={0.4} max={2} step={0.05} show={() => `${count}`} onChange={(dots) => setOrbPrefs({ dots })} />
      <Slider label="Dot size" value={o.dotSize} min={0.5} max={2} step={0.05} show={times} onChange={(dotSize) => setOrbPrefs({ dotSize })} />
      <Slider
        label="Orbit paths"
        note="The working orb's faint rings, and the fingerprint's ridges."
        value={o.orbitPaths}
        min={0}
        max={1}
        step={0.05}
        show={(v) => `${Math.round(v * 100)}%`}
        onChange={(orbitPaths) => setOrbPrefs({ orbitPaths })}
      />

      <Gravity o={o} />

      <Knobs state={choice.state} own={!!choice.frame} name={choice.name} size={size} o={o} />
    </div>
  )
}

/** The swatches, then any colour of your own. */
function Tints({ tint }: { tint: string }) {
  const own = !TINTS.some((t) => t.value === tint)
  const ring = (on: boolean) => (on ? 'shadow-[0_0_0_2px_var(--panel-solid),0_0_0_4px_var(--ring)]' : 'shadow-[inset_0_0_0_1px_rgb(255_255_255/0.25)]')
  return (
    <div role="radiogroup" aria-label="Ink colour" className="flex flex-wrap items-center gap-2.5">
      {TINTS.map((t) => (
        <button
          key={t.name}
          type="button"
          role="radio"
          aria-checked={tint === t.value}
          aria-label={t.name}
          title={t.name}
          onClick={() => setOrbPrefs({ tint: t.value })}
          className={`size-8 rounded-full transition-shadow ${ring(tint === t.value)}`}
          style={{ background: t.value || 'linear-gradient(135deg, #fafafa, #71717a)' }}
        />
      ))}
      <label
        title="A colour of your own"
        className={`relative size-8 cursor-pointer overflow-hidden rounded-full transition-shadow focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--ring)] ${ring(own)}`}
        style={{ background: own ? tint : 'conic-gradient(#ff6e56, #ffb43c, #b4d055, #45dc8f, #9cc4ff, #c48cff, #ff6e56)' }}
      >
        <input
          type="color"
          aria-label="A colour of your own"
          value={own ? tint : '#b4d055'}
          onChange={(e) => setOrbPrefs({ tint: e.target.value })}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

/** What the library says about gravity on this device, in a sentence; refreshed while it is on. */
function useGravityNote(on: boolean) {
  const [status, setStatus] = useState(() => getGravityStatus())
  useEffect(() => {
    if (!on) return
    const read = () => setStatus(getGravityStatus())
    read()
    const timer = setInterval(read, 800)
    return () => clearInterval(timer)
  }, [on])
  const b = status.blockedBy
  if (!b || /no orb/.test(b)) return { text: status.active ? 'Pulling your pointer now.' : 'Bring your pointer close to the orb on the stage.' }
  if (/sprite/.test(b)) return { text: 'Getting your pointer ready…' }
  if (/reduced-motion/.test(b)) return { text: 'Off while this device asks for reduced motion.' }
  if (/forced colours/.test(b)) return { text: 'Off while forced colours are on.' }
  if (/fine pointer/.test(b)) return { text: 'Needs a mouse or a trackpad.' }
  if (/display scale/.test(b)) return { text: 'The display scale changed. Reload the page to use it.' }
  if (/zoomed/.test(b)) return { text: 'Off while the page is zoomed in.' }
  return { text: 'It switched itself off to keep the page smooth.', rearm: true }
}

function Gravity({ o }: { o: OrbPrefs }) {
  const note = useGravityNote(o.gravity)
  return (
    <div className="flex flex-col gap-4">
      <SwitchRow
        label="Cursor gravity"
        note={o.gravity ? note.text : 'The orbs pull your pointer in. MetaProof draws a copy of it while it bends.'}
        checked={o.gravity}
        onChange={(gravity) => setOrbPrefs({ gravity })}
      />
      {o.gravity && note.rearm && (
        <button type="button" onClick={resetGravity} className="btn-ghost btn-sm self-start">
          Turn it back on
        </button>
      )}
      {o.gravity && (
        <>
          <Slider label="Reach" value={o.reach} min={40} max={320} step={5} show={(v) => `${v}px`} onChange={(reach) => setOrbPrefs({ reach })} />
          <Slider label="Bend" value={o.bend} min={0} max={32} step={1} show={(v) => `${v}px`} onChange={(bend) => setOrbPrefs({ bend })} />
          {(o.reach !== GRAVITY_DEFAULTS.reach || o.bend !== GRAVITY_DEFAULTS.deform) && (
            <button
              type="button"
              onClick={() => setOrbPrefs({ reach: GRAVITY_DEFAULTS.reach, bend: GRAVITY_DEFAULTS.deform })}
              className="self-start text-[13px] font-medium text-accent hover:underline"
            >
              Back to the library's pull
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** The engine's own knobs for the state on the stage. They apply to that state everywhere. */
function Knobs({ state, own, name, size, o }: { state: OrbState; own: boolean; name: string; size: OrbSize; o: OrbPrefs }) {
  const knobs = own ? [] : (KNOBS[state] ?? [])
  const set = o.opts[state] ?? {}
  const put = (key: string, value: number | undefined) => {
    const next = { ...set, [key]: value }
    if (value === undefined) delete next[key]
    setOrbPrefs({ opts: { ...o.opts, [state]: next } })
  }
  const changed = !own && Object.keys(set).length > 0
  return (
    <details className="group rounded-[18px] border border-line px-4 py-3">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13.5px] text-muted">
        <span>
          Engine knobs <span className="text-faint">· {name}</span>
        </span>
        <span className="text-[13px] font-medium text-accent group-open:hidden">Show</span>
        <span className="hidden text-[13px] font-medium text-accent group-open:inline">Hide</span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        {own ? (
          <p className="text-[13px] leading-snug text-faint">MetaProof's own orb takes the working orb's dots, dot size and orbit paths.</p>
        ) : knobs.length === 0 && state !== 'shaping' ? (
          <p className="text-[13px] leading-snug text-faint">The {name.toLowerCase()} orb has no knobs of its own; the settings above shape it.</p>
        ) : (
          knobs.map((k) => {
            const tuned = tunedValue(state, size, k.key) ?? k.min
            return (
              <Slider
                key={k.key}
                label={k.label}
                value={set[k.key] ?? tuned}
                min={k.min}
                max={k.max}
                step={k.step}
                show={(v) => `${Number(v.toFixed(2))}`}
                onChange={(v) => put(k.key, v)}
              />
            )
          })
        )}
        {state === 'shaping' && !own && (
          <Row label="Shape">
            <Segmented label="Shape the orb holds" options={SHAPES} value={set.shape} onChange={(v) => put('shape', v)} />
          </Row>
        )}
        {changed && (
          <button type="button" onClick={() => setOrbPrefs({ opts: { ...o.opts, [state]: {} } })} className="self-start text-[13px] font-medium text-accent hover:underline">
            Back to the tuned {name.toLowerCase()} orb
          </button>
        )}
      </div>
    </details>
  )
}
