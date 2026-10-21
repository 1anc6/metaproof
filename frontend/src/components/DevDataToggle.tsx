import { useState } from 'react'
import { DEV_DATA_MODES, devDataMode, setDevDataMode, type DevDataMode } from '../lib/devData'

/** Development only: flips the history lists between real data and worst-case fixtures. */
export function DevDataToggle() {
  const [mode, setMode] = useState<DevDataMode>(devDataMode)
  return (
    <div
      role="radiogroup"
      aria-label="Dev data"
      // Plain chrome, deliberately outside the design system; sits above the phone tab bar.
      className="fixed bottom-24 left-1/2 z-[200] flex -translate-x-1/2 gap-0.5 rounded-full bg-neutral-300 p-0.5 font-[system-ui] text-[12px] text-neutral-800 lg:bottom-4"
    >
      {DEV_DATA_MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          role="radio"
          aria-checked={mode === m.key}
          onClick={() => {
            setDevDataMode(m.key)
            setMode(m.key)
          }}
          className={`rounded-full px-2.5 py-1 whitespace-nowrap ${mode === m.key ? 'bg-white font-semibold' : ''}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
