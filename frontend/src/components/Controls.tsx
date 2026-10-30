import type { ReactNode } from 'react'
import { Switch } from './ui'

// The controls the Settings playgrounds share (the thinking orbs and the liquid metal).

/** A setting: its name over its control. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p className="mb-2 text-[13.5px] text-muted">{label}</p>
      {children}
    </div>
  )
}

export function Segmented<T>({ label, options, value, onChange }: { label: string; options: { value: T; name: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="track inline-flex shrink-0 gap-0.5 rounded-full p-1">
      {options.map((opt) => (
        <button
          key={opt.name}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-8 rounded-full px-3 text-[13px] whitespace-nowrap transition ${value === opt.value ? 'selected font-medium' : 'text-muted hover:text-ink'}`}
        >
          {opt.name}
        </button>
      ))}
    </div>
  )
}

/** A range with its name and value above it, full width so a thumb can work it. */
export function Slider({
  label,
  note,
  value,
  min,
  max,
  step,
  show,
  onChange,
}: {
  label: string
  note?: string
  value: number
  min: number
  max: number
  step: number
  show: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span className="text-muted">{label}</span>
        <span className="text-ink tabular-nums">{show(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={show(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 block w-full accent-primary"
      />
      {note && <span className="mt-1 block text-[12.5px] text-faint">{note}</span>}
    </label>
  )
}

/** A setting switched on or off: its name and a line on what it does, beside the switch. */
export function SwitchRow({ label, note, checked, onChange }: { label: string; note: ReactNode; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13.5px] text-muted">{label}</p>
        <p className="mt-0.5 text-[12.5px] leading-snug text-faint">{note}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}
