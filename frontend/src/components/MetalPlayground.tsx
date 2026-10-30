import { Pause, Play, Plus, Upload } from 'lucide-react'
import { useRef } from 'react'
import { useMetalTextReflection, type MetalFxPreset } from 'metal-fx'
import { setMetalPrefs, usePrefs } from '../lib/prefs'
import { Row, Segmented, Slider, SwitchRow } from './Controls'
import { LiveBadge, MetalRing } from './Metal'

const PRESETS: { value: MetalFxPreset; name: string }[] = [
  { value: 'chromatic', name: 'Chromatic' },
  { value: 'silver', name: 'Silver' },
  { value: 'gold', name: 'Gold' },
]
const percent = (v: number) => `${Math.round(v * 100)}%`

/**
 * The liquid metal's playground, after the one on libraries.dev/metal: a stage with each kind of
 * metal MetaProof uses (the LIVE badge with a word catching its light, the round + and the pill
 * button), and the controls, saved in this browser and applied to all the metal at once.
 */
export function MetalPlayground() {
  const m = usePrefs().metal
  const word = useRef<HTMLSpanElement>(null)
  useMetalTextReflection(word)

  return (
    <div className="flex flex-col gap-5">
      <div>
        {/* a picture of the metal, not controls: the pieces only look like the app's buttons; their
            halos are clipped sideways so they never widen a phone's page */}
        <div className="well flex min-h-[150px] flex-wrap items-center justify-center gap-x-8 gap-y-5 overflow-x-clip rounded-[22px] px-4 py-6" aria-hidden>
          <span className="flex items-center gap-2.5">
            <span ref={word} className="text-[17px] font-medium text-ink">
              Server
            </span>
            <LiveBadge label={null} reflect={[{ ref: word, strength: 0.8 }]} />
          </span>
          <MetalRing variant="circle" bezel={4}>
            <span className="fab grid size-12 place-items-center">
              <Plus className="size-6" strokeWidth={1.9} />
            </span>
          </MetalRing>
          <MetalRing bezel={3}>
            <span className="btn-primary h-10 px-4 text-[14px]">
              <Upload className="size-4" strokeWidth={2} /> Choose image
            </span>
          </MetalRing>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          {/* pauses all the metal in the app, not just these pieces */}
          <button
            type="button"
            onClick={() => setMetalPrefs({ animate: !m.animate })}
            aria-label={m.animate ? 'Pause the metal' : 'Play the metal'}
            title={m.animate ? 'Hold all the metal still' : 'Set the metal moving again'}
            className="btn-ghost btn-sm"
          >
            {m.animate ? <Pause className="size-4" strokeWidth={1.8} /> : <Play className="size-4" strokeWidth={1.8} />}
            {m.animate ? 'Pause' : 'Play'}
          </button>
          <Segmented label="Metal colour" options={PRESETS} value={m.preset} onChange={(preset) => setMetalPrefs({ preset })} />
        </div>
      </div>

      <Slider label="Strength" value={m.strength} min={0.2} max={1} step={0.05} show={percent} onChange={(strength) => setMetalPrefs({ strength })} />

      <Row label="Glow">
        <div className="flex flex-col gap-4">
          <SwitchRow
            label="Halo"
            note="A light that wanders round the ring and spills onto the glass."
            checked={m.glow}
            onChange={(glow) => setMetalPrefs({ glow })}
          />
          {m.glow && (
            <Slider label="Glow strength" value={m.glowStrength} min={0.1} max={1} step={0.05} show={percent} onChange={(glowStrength) => setMetalPrefs({ glowStrength })} />
          )}
        </div>
      </Row>

      <Slider
        label="Shader scale"
        note="Zooms into the metal: larger shows bigger, slower bands."
        value={m.shaderScale}
        min={0.8}
        max={3}
        step={0.1}
        show={(v) => `${Number(v.toFixed(1))}×`}
        onChange={(shaderScale) => setMetalPrefs({ shaderScale })}
      />

      <SwitchRow
        label="Reflection"
        note="Buttons and words beside the metal catch its light, as the tab bar does beside the +."
        checked={m.reflection}
        onChange={(reflection) => setMetalPrefs({ reflection })}
      />
      <SwitchRow label="Bend" note="Your pointer dents a ring as it passes over it." checked={m.bend} onChange={(bend) => setMetalPrefs({ bend })} />
      <SwitchRow
        label="Cursor reflection"
        note="A ring lights a copy of your pointer as it nears. Needs a mouse or a trackpad; off when motion is reduced."
        checked={m.cursorLight}
        onChange={(cursorLight) => setMetalPrefs({ cursorLight })}
      />
    </div>
  )
}
