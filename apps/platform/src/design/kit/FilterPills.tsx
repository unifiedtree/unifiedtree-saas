// Filter pills: a row of round outlined buttons with the chosen one solid green
// (Companies' "All statuses / Active / Inactive"). Exactly one is on.
//
// Semantics (same look):
//   "toggle"  role="group" + buttons with aria-pressed (default; what ModuleKit Views use today)
//   "tabs"    role="tablist" / role="tab" / aria-selected, arrow keys move
// Use SegmentedControl for the compact grey switch inside card headers.
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

export interface FilterPillOption<V extends string = string> {
  value: V
  label: ReactNode
  /** A count after the label ("Active 11"). */
  count?: number | string | null
  disabled?: boolean
  /** Tabs mode: the id of the panel this option shows. */
  controls?: string
}

export interface FilterPillsProps<V extends string = string> {
  options: readonly FilterPillOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Accessible name of the group ("Status"). */
  label: string
  semantics?: 'toggle' | 'tabs'
  /** md 36px (default), sm 32px. */
  size?: 'sm' | 'md'
  className?: string
}

export function FilterPills<V extends string = string>({ options, value, onChange, label, semantics = 'toggle', size = 'md', className }: FilterPillsProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  const tabs = semantics === 'tabs'
  const enabled = options.filter((o) => !o.disabled)

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!tabs || !enabled.length) return
    const i = enabled.findIndex((o) => o.value === value)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % enabled.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = enabled.length - 1
    if (n < 0) return
    e.preventDefault()
    const v = enabled[n].value
    onChange(v)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus())
  }

  return (
    <div ref={ref} role={tabs ? 'tablist' : 'group'} aria-label={label} className={cx('uk-fpills', `uk-fpills--${size}`, className)} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === value
        const a11y = tabs
          ? { role: 'tab' as const, 'aria-selected': on, 'aria-controls': o.controls, tabIndex: on ? 0 : -1 }
          : { 'aria-pressed': on }
        return (
          <button key={o.value} type="button" data-value={o.value} disabled={o.disabled} {...a11y}
            className={cx('uk-fpill', on && 'is-on')} onClick={() => { if (!on) onChange(o.value) }}>
            {o.label}
            {o.count != null && o.count !== '' && <span className="uk-fpill__n">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
