// Segmented control: a grey track with the chosen option on a white chip
// (UtSection header switch, the dashboard's All / Late / Not marked filter,
// Home's team filter, Companies' Cards / Table). One option is always chosen.
//
// Semantics (same look):
//   "tabs"   role="tablist" / role="tab" / aria-selected (default — the design's own markup)
//   "toggle" role="group" + buttons with aria-pressed
//   "radio"  role="radiogroup" / role="radio" / aria-checked
// In tabs and radio mode the group is one tab stop and the arrows move and
// choose; Home / End jump to the ends.
import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './displayUtil'
import './display.css'

export interface SegmentOption<V extends string = string> {
  value: V
  label: ReactNode
  /** A small count after the label ("Late 8"). */
  count?: number | string | null
  disabled?: boolean
  /** Accessible name when the label isn't plain text. */
  ariaLabel?: string
  /** Tabs mode: the id of the panel this option shows. */
  controls?: string
}

export interface SegmentedControlProps<V extends string = string> {
  options: readonly SegmentOption<V>[]
  value: V
  onChange: (value: V) => void
  /** Accessible name of the group ("Filter check-ins", "View"). */
  label: string
  semantics?: 'tabs' | 'toggle' | 'radio'
  /** sm 26px (section headers), md 28px (dashboard filters, default), lg 30px (Home), xl 32px (Companies). */
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function SegmentedControl<V extends string = string>({ options, value, onChange, label, semantics = 'tabs', size = 'md', className }: SegmentedControlProps<V>) {
  const ref = useRef<HTMLDivElement>(null)
  const enabled = options.filter((o) => !o.disabled)
  const current = enabled.some((o) => o.value === value) ? value : enabled[0]?.value
  const roving = semantics !== 'toggle'

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!roving || !enabled.length) return
    const i = enabled.findIndex((o) => o.value === current)
    let n = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % enabled.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = enabled.length - 1
    if (n < 0) return
    e.preventDefault()
    const v = enabled[n].value
    if (v !== value) onChange(v)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(v)}"]`)?.focus())
  }

  const groupRole = semantics === 'tabs' ? 'tablist' : semantics === 'radio' ? 'radiogroup' : 'group'
  return (
    <div ref={ref} role={groupRole} aria-label={label} className={cx('uk-seg', `uk-seg--${size}`, className)} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === current
        const a11y =
          semantics === 'tabs'
            ? { role: 'tab' as const, 'aria-selected': on, 'aria-controls': o.controls, tabIndex: on ? 0 : -1 }
            : semantics === 'radio'
              ? { role: 'radio' as const, 'aria-checked': on, tabIndex: on ? 0 : -1 }
              : { 'aria-pressed': on }
        return (
          <button key={o.value} type="button" data-value={o.value} aria-label={o.ariaLabel} disabled={o.disabled} {...a11y}
            className={cx('uk-seg__opt', on && 'is-on')} onClick={() => { if (!on) onChange(o.value) }}>
            {o.label}
            {o.count != null && o.count !== '' && <span className="uk-seg__n">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
