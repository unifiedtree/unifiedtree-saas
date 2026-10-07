// The start / end calendar that sits next to a list's other filters (owner + client, 7 Oct 2026: "click days on a
// real calendar", on every page with lots of dated records). A compact box showing "01/10/2026 – 07/10/2026" (or
// "All dates") that opens the "Select dates" calendar (DateRangeBody) in a popover: click any start day, then any
// end day; the month title jumps to a month or a year; quick picks (Today … Last month, This year); Apply, Clear
// and Cancel. A page's own limits stay: days outside min / max are disabled, and a range longer than maxSpan is
// said in plain words.
//
// The range lives in the URL (?from=&to=) through useRangeParam, so links and Back keep it:
//   const [range, setRange] = useRangeParam()                       // null = all dates
//   <RangeFilter value={range} onChange={setRange} max={today} />
//   useThings({ from: range?.from, to: range?.to })
//
// Rules: rangeFilterModel.ts (vitest covers them).
import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarRange, ChevronDown } from 'lucide-react'
import { Popover } from './Popover'
import { Dialog } from './Dialog'
import { useIsMobile } from '@/design/dc/DesignFrame'
import { DateRangeBody } from './DateRangePicker'
import type { ViewPreset, WorkCalendar } from './dateRangeModel'
import { historyPresets, rangeProblem, rangeText, rangeWords, readRange, writeRange, type DayRange, type RangeKeys } from './rangeFilterModel'
import { istToday } from '@/design/dc/dates'
import './dateRange.css'

export type { DayRange } from './rangeFilterModel'

/** A list's calendar shows dates only: no weekly offs greyed, no holidays. */
const PLAIN: WorkCalendar = { off: new Set(), holidays: new Map() }

export interface RangeFilterProps {
  /** The applied range; null = all dates (or the page's default, when it has one). */
  value: DayRange | null
  onChange: (range: DayRange | null) => void
  /** The page's own earliest / latest day (e.g. nothing after today). */
  min?: string | null
  max?: string | null
  /** The longest range in days; a longer one is said in plain words and can't be applied. */
  maxSpan?: number
  /** Quick picks; the list ones (historyPresets) by default. */
  presets?: readonly ViewPreset[]
  /** The box's text with no range ("All dates"). */
  placeholder?: string
  /** The popover's heading and the box's accessible name ("Dates"). */
  label?: string
  /** No Clear (a report always has a range): Clear goes back to `onClear` instead when given. */
  clearable?: boolean
  onClear?: () => void
  /** Popover alignment under the box (default 'start'). */
  align?: 'start' | 'end'
  /** Override "today" (tests); India's business day by default. */
  today?: string
  /** data-filter on the box (the live tests find it by this). */
  filterKey?: string
  size?: 'sm' | 'md'
}

export function RangeFilter({
  value, onChange, min, max, maxSpan, presets, placeholder = 'All dates', label = 'Dates', clearable = true, onClear,
  align = 'start', today: todayProp, filterKey = 'dates', size = 'sm',
}: RangeFilterProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const phone = useIsMobile()
  const today = todayProp ?? istToday()
  const picks = useMemo(() => presets ?? historyPresets(today, { min, max }), [presets, today, min, max])
  const close = useCallback(() => setOpen(false), [])
  const back = () => anchor.current?.focus({ preventScroll: true })
  const text = rangeText(value)
  // Wide enough for the quick picks beside the calendar.
  const width = typeof window !== 'undefined' ? Math.min(600, window.innerWidth - 32) : 600
  const body = (
    <DateRangeBody from={value?.from ?? ''} to={value?.to ?? ''} min={min} max={max} today={today} calendar={PLAIN}
      presets={picks} presetsSide={!phone} legend={false} maxSpan={maxSpan} doneLabel="Apply" onCancel={() => { close(); back() }}
      clearable={clearable} onClear={clearable ? () => { close(); if (onClear) onClear(); else onChange(null); back() } : undefined}
      footerText={(r) => (r ? '' : 'Pick a start date, then an end date')}
      onDone={(p) => { close(); onChange({ from: p.from, to: p.to }); back() }} />
  )
  return (
    <>
      <button ref={anchor} type="button" className={`urf-box urf-${size}${value ? ' is-on' : ''}`} data-filter={filterKey}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={value ? `${label}: ${rangeWords(value)}. Change the dates` : `${label}: ${placeholder}. Choose dates`}
        onClick={() => setOpen((o) => !o)}>
        <CalendarRange size={15} aria-hidden="true" />
        <span className={`urf-text${value ? '' : ' is-ph'}`}>{text || placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" className="urf-chev" />
      </button>
      {/* A phone gets the calendar as a dialog (it fits the screen, Apply in reach); wider screens a popover under the box. */}
      {phone ? (
        <Dialog open={open} onClose={close} title={label} width={440} closeLabel="Close">
          {open && body}
        </Dialog>
      ) : (
        <Popover open={open} onClose={close} anchorRef={anchor} role="dialog" aria-label={`Choose ${label.toLowerCase()}`}
          placement={align === 'end' ? 'bottom-end' : 'bottom-start'} width={width} className="urf-pop">
          <p className="urf-title">{label}</p>
          {body}
        </Popover>
      )}
    </>
  )
}

/**
 * The page's range in the URL (?from=&to=, or other keys). A missing or broken one is `fallback` (null = all dates).
 * Setting it replaces the URL entry (no extra Back step) and keeps every other parameter, minus `resetKeys`
 * (e.g. the page number, so a new range starts on page 1).
 */
export function useRangeParam(opts: {
  keys?: RangeKeys
  fallback?: DayRange | null
  min?: string | null
  max?: string | null
  maxSpan?: number
  resetKeys?: readonly string[]
} = {}): [DayRange | null, (range: DayRange | null) => void] {
  const [params, setParams] = useSearchParams()
  const { keys, min, max, maxSpan, resetKeys } = opts
  const fromUrl = readRange(params, { keys, min, max, maxSpan })
  const range = fromUrl ?? opts.fallback ?? null
  const set = useCallback((next: DayRange | null) => {
    if (next && rangeProblem(next, maxSpan)) return
    // Start from the address bar itself: a page's own tab keeper (useView) writes ?view= without the router.
    setParams(writeRange(window.location.search, next, { keys, drop: resetKeys }), { replace: true })
  }, [setParams, keys, maxSpan, resetKeys])
  return [range, set]
}
