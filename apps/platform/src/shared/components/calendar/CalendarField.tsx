// The one calendar behind DateField, MonthField and DateRangeField (see index.ts
// for how to use them). A field is a box holding a trigger button, a hidden
// input that carries name / value / required for forms, and — when open — a
// popover portalled to <body> (a bottom sheet on phones).
//
// Focus stays on the trigger the whole time; the popover's cursor cell is
// announced through aria-activedescendant. That is deliberate: moving focus
// into a portal breaks the focus traps of HrDrawer and the Radix modals.
import {
  forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState,
  type CSSProperties, type ForwardedRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, CalendarRange, Check, ChevronDown, X } from 'lucide-react'
import * as D from './dateMath'
import { CalArrow, CalChip, DayGrid, MonthGrid, YearGrid, monthStep, yearStep } from './parts'
import './calendar.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export interface DateRange { from: string; to: string }

/** What onChange / onBlur / onFocus receive first: shaped like a DOM event, so `e.target.value` works. */
export interface CalendarEvent<V> {
  type: 'change' | 'blur' | 'focus'
  target: { value: V; name: string; id: string }
  currentTarget: { value: V; name: string; id: string }
  preventDefault: () => void
  stopPropagation: () => void
  persist: () => void
}

export interface CalendarFieldCommonProps {
  id?: string
  /** Form field name: carried by the hidden input (native forms, FormData) and echoed in event.target.name. */
  name?: string
  placeholder?: string
  /** Classes for the visible box — e.g. "ut-input", "ut-input ut-input-sm", "w-44 mt-2". */
  className?: string
  style?: CSSProperties
  disabled?: boolean
  /** Native validation: submitting a form while this is empty is blocked, like a native input. */
  required?: boolean
  readOnly?: boolean
  autoFocus?: boolean
  title?: string
  /** Earliest / latest allowed day, 'yyyy-MM-dd' (MonthField also takes 'yyyy-MM'). Numbers are ignored
   *  (the type is widened only so react-hook-form's `{...register('x')}` spreads cleanly). */
  min?: string | number
  max?: string | number
  /** Accepted for `{...register('x')}` spreads; they mean nothing for a date. */
  minLength?: number
  maxLength?: number
  pattern?: string
  /** Year view bounds when min / max aren't given (default 1940 … this year + 10). */
  fromYear?: number
  toYear?: number
  /** Override "today" ('yyyy-MM-dd'); defaults to the IST business day. */
  today?: string
  /** Shows an × in the field and a Clear button in the popover. */
  clearable?: boolean
  /** 'sm' = 34px toolbar height. Passing className="ut-input-sm" works too. */
  size?: 'md' | 'sm'
  /** Calendar icon at the start of the field (default true). */
  icon?: boolean
  /** Popover alignment under the field (default 'start'). */
  align?: 'start' | 'end'
  /** Red error state (also accepts `error`, and aria-invalid). */
  invalid?: boolean
  error?: boolean
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  /** data-* attributes land on the trigger button. */
  [data: `data-${string}`]: string | number | boolean | undefined
}

type Mode = 'day' | 'month' | 'range'
type View = 'days' | 'months' | 'years'
type Val = string | DateRange

interface ImplProps extends CalendarFieldCommonProps {
  mode: Mode
  value?: unknown
  defaultValue?: unknown
  onChange?: (evt: CalendarEvent<any>, value: any) => void
  onBlur?: (evt: CalendarEvent<any>) => void
  onFocus?: (evt: CalendarEvent<any>) => void
  format?: 'long' | 'short'
  presets?: unknown[] | false
  months?: 1 | 2
}

const EMPTY_RANGE: DateRange = { from: '', to: '' }
function normRange(v: unknown): DateRange {
  if (!v || typeof v !== 'object') return EMPTY_RANGE
  const r = v as Partial<DateRange>
  return { from: D.normDay(r.from), to: D.normDay(r.to) }
}
function normVal(mode: Mode, v: unknown): Val {
  if (mode === 'range') return normRange(v)
  return mode === 'month' ? D.normMonth(v) : D.normDay(v)
}
function sameVal(a: Val, b: Val): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b
  return a.from === b.from && a.to === b.to
}
/** min / max as days; a month bound covers its whole month. */
function bound(v: string | number | undefined, end: 'min' | 'max'): string | undefined {
  if (!v || typeof v !== 'string') return undefined
  const day = D.normDay(v)
  if (day) return day
  const ym = D.normMonth(v)
  if (!ym) return undefined
  return end === 'min' ? ym + '-01' : `${ym}-${String(D.daysInMonth(D.yearOf(ym), D.monthOf(ym))).padStart(2, '0')}`
}
/** The hidden input's string: the value itself, or "from/to" for a complete range. */
function hiddenString(v: Val): string {
  if (typeof v === 'string') return v
  return v.from && v.to ? `${v.from}/${v.to}` : ''
}
function fromHidden(mode: Mode, s: string): Val {
  if (mode !== 'range') return normVal(mode, s)
  const [from, to] = s.split('/')
  return normRange({ from, to })
}

function CalendarFieldImpl(props: ImplProps, ref: ForwardedRef<HTMLInputElement>) {
  const { mode, disabled, readOnly, clearable } = props
  const uid = 'utc' + useId().replace(/[^a-zA-Z0-9]/g, '')
  const today = D.normDay(props.today) || D.istToday()
  const min = bound(props.min, 'min'), max = bound(props.max, 'max')
  const controlled = props.value !== undefined
  const [inner, setInner] = useState<Val>(() => normVal(mode, props.defaultValue))
  const value: Val = controlled ? normVal(mode, props.value) : inner
  const range = mode === 'range' ? (value as DateRange) : EMPTY_RANGE
  const primary = mode === 'range' ? range.from || range.to : mode === 'month' ? (value ? value + '-01' : '') : (value as string)
  const hasValue = mode === 'range' ? !!(range.from || range.to) : !!value
  const [yLo, yHi] = D.yearSpan({ min, max, fromYear: props.fromYear, toYear: props.toYear, today, value: primary || undefined })
  const lo = min ?? `${yLo}-01-01`, hi = max ?? `${yHi}-12-31`

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('days')
  const [viewYm, setViewYm] = useState(today.slice(0, 7))
  const [curDay, setCurDay] = useState(today)
  const [curMonth, setCurMonth] = useState(today.slice(0, 7))
  const [curYear, setCurYear] = useState(D.yearOf(today))
  const [kbd, setKbd] = useState(false)
  const [anchor, setAnchor] = useState('')
  const [hover, setHover] = useState('')
  const [sheet, setSheet] = useState(false)
  const [twoUp, setTwoUp] = useState(false)
  const [nativeInvalid, setNativeInvalid] = useState(false)

  const wrapRef = useRef<HTMLSpanElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const hiddenRef = useRef<HTMLInputElement | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const spaceUp = useRef(false)
  const validating = useRef(false)
  const live = useRef(props)
  live.current = props
  const liveMode = useRef({ controlled, mode })
  liveMode.current = { controlled, mode }

  const makeEvt = (type: CalendarEvent<unknown>['type'], v: Val): CalendarEvent<any> => {
    const target = { value: v, name: props.name ?? '', id: props.id ?? '' }
    return { type, target, currentTarget: target, preventDefault() {}, stopPropagation() {}, persist() {} }
  }

  // ── forms: the hidden input is the ref target (react-hook-form's register() / Controller) ──
  // register() writes a default or reset() value straight into input.value; hear it and show it.
  const setHidden = useCallback((el: HTMLInputElement | null) => {
    hiddenRef.current = el
    if (!el || (el as unknown as { __utc?: boolean }).__utc) return
    const base = Object.getOwnPropertyDescriptor(el, 'value') ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (!base?.get || !base.set) return
    const get = base.get, set = base.set
    Object.defineProperty(el, 'value', {
      configurable: true,
      enumerable: base.enumerable,
      get() { return get.call(this) },
      set(v: unknown) {
        set.call(this, v)
        const m = liveMode.current
        if (!m.controlled) {
          const next = fromHidden(m.mode, v == null ? '' : String(v))
          setInner((cur) => (sameVal(cur, next) ? cur : next))
        }
      },
    })
    ;(el as unknown as { __utc?: boolean }).__utc = true
  }, [])
  useImperativeHandle(ref, () => hiddenRef.current as HTMLInputElement, [])

  const commit = (next: Val) => {
    setNativeInvalid(false)
    if (!controlled) setInner(next)
    if (!sameVal(value, next)) live.current.onChange?.(makeEvt('change', next), next)
  }

  // ── open / close ──────────────────────────────────────────────────────────
  const openIt = () => {
    if (disabled || readOnly) return
    const b = D.clampDay(primary || today, lo, hi), bYm = b.slice(0, 7)
    const w = typeof window !== 'undefined' ? window.innerWidth : 1024
    const two = mode === 'range' && props.months !== 1 && w >= 880
    // Two months side by side: the start month first, unless it is the last usable month.
    const first = two && !(range.to && range.to.slice(0, 7) > bYm) && D.addMonthsYm(bYm, 1) > hi.slice(0, 7) ? D.addMonthsYm(bYm, -1) : bYm
    setView(mode === 'month' ? 'months' : 'days')
    setViewYm(first); setCurDay(b); setCurMonth(bYm); setCurYear(D.yearOf(b))
    setKbd(false); setAnchor(''); setHover('')
    setSheet(w <= 480); setTwoUp(two)
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false); setAnchor(''); setHover('')
    if (refocus) triggerRef.current?.focus({ preventScroll: true })
  }
  const closeRef = useRef(close)
  closeRef.current = close
  const toggle = () => { if (open) close(true); else openIt() }

  // ── positioning ───────────────────────────────────────────────────────────
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const place = useCallback((fromScroll = false) => {
    const box = wrapRef.current, el = popRef.current
    if (!box || !el) return
    if (sheetRef.current) { el.style.top = ''; el.style.left = ''; return }
    const r = box.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight, gap = 6, m = 8
    // The user scrolled the field out of sight (a scrolling table or page): close rather than float.
    if (fromScroll && (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw)) { closeRef.current(false); return }
    el.style.maxHeight = `${vh - 2 * m}px`
    const W = el.offsetWidth, H = Math.min(el.offsetHeight, vh - 2 * m)
    const below = vh - r.bottom - gap - m, above = r.top - gap - m
    let top: number, side: 'bottom' | 'top'
    if (H <= below) { top = r.bottom + gap; side = 'bottom' } else if (H <= above) { top = r.top - gap - H; side = 'top' } else {
      side = below >= above ? 'bottom' : 'top'
      top = side === 'bottom' ? Math.max(m, vh - m - H) : m
    }
    let left = live.current.align === 'end' ? r.right - W : r.left
    left = Math.min(Math.max(m, left), Math.max(m, vw - W - m))
    el.style.top = `${Math.round(top)}px`
    el.style.left = `${Math.round(left)}px`
    el.dataset.side = side
  }, [])
  const placeRef = useRef(place)
  placeRef.current = place
  const setPop = useCallback((el: HTMLDivElement | null) => { popRef.current = el; if (el) placeRef.current() }, [])

  useEffect(() => {
    if (!open) return
    const inside = (t: EventTarget | null) => t instanceof Node && (!!wrapRef.current?.contains(t) || !!popRef.current?.contains(t))
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null
      if (inside(t) || t?.classList?.contains('utc-backdrop')) return
      closeRef.current(false)
    }
    // Window capture runs before a Radix modal's or HrDrawer's own Escape handler, so Escape closes only the calendar.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault(); e.stopPropagation()
      closeRef.current(true)
    }
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && popRef.current?.contains(e.target))) placeRef.current(true) }
    const onResize = () => { setSheet(window.innerWidth <= 480); placeRef.current() }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => placeRef.current()) : null
    if (ro && popRef.current) ro.observe(popRef.current)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
      ro?.disconnect()
    }
  }, [open])
  useEffect(() => { if (open) place() }, [open, sheet, view, twoUp, place])

  // ── navigation ────────────────────────────────────────────────────────────
  const loYm = lo.slice(0, 7), hiYm = hi.slice(0, 7)
  const lastShown = twoUp ? D.addMonthsYm(viewYm, 1) : viewYm
  /** Keep a keyboard cursor day on screen. */
  const follow = (d: string) => {
    const ym = d.slice(0, 7)
    if (ym < viewYm) setViewYm(ym)
    else if (ym > lastShown) setViewYm(twoUp ? D.addMonthsYm(ym, -1) : ym)
  }
  const shiftMonths = (n: number) => {
    const next = D.addMonthsYm(viewYm, n)
    setViewYm(next)
    setCurDay(D.dayInMonth(next, Number(curDay.slice(8, 10)) || 1, lo, hi))
  }
  const pickDay = (day: string) => {
    if (!D.inRange(day, min, max)) return
    if (mode === 'range') {
      if (!anchor) { setAnchor(day); setHover(day); setCurDay(day); return }
      const [a, b] = anchor <= day ? [anchor, day] : [day, anchor]
      commit({ from: a, to: b }); close(true); return
    }
    commit(day); close(true)
  }
  const pickMonth = (ym: string) => {
    if (!D.monthUsable(ym, min, max)) return
    if (mode === 'month') { commit(ym); close(true); return }
    const d = D.dayInMonth(ym, Number(curDay.slice(8, 10)) || 1, lo, hi)
    setView('days'); setCurDay(d)
    setViewYm(twoUp && D.addMonthsYm(ym, 1) > hiYm ? D.addMonthsYm(ym, -1) : ym)
  }
  const pickYear = (y: number) => {
    if (y < yLo || y > yHi || !D.yearUsable(y, min, max)) return
    setCurMonth(D.clampMonth(`${y}-${curMonth.slice(5, 7)}`, lo, hi))
    setView('months')
  }
  const showMonths = () => {
    if (view === 'months' && mode !== 'month') { setView('days'); return }
    setCurMonth(view === 'years' ? D.clampMonth(`${curYear}-${viewYm.slice(5, 7)}`, lo, hi) : viewYm)
    setView('months')
  }
  const showYears = () => {
    if (view === 'years') { setView(mode === 'month' ? 'months' : 'days'); return }
    setCurYear(view === 'months' || mode === 'month' ? D.yearOf(curMonth) : D.yearOf(viewYm))
    setView('years')
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const k = e.key
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); openIt() }
      else if ((k === 'Backspace' || k === 'Delete') && clearable && hasValue && !disabled && !readOnly) { e.preventDefault(); commit(mode === 'range' ? EMPTY_RANGE : '') }
      return
    }
    if (k === 'Tab') { close(false); return }
    const pick = k === 'Enter' || k === ' '
    if (pick) { e.preventDefault(); if (k === ' ') spaceUp.current = true }
    if (view === 'years') {
      if (pick) { pickYear(curYear); return }
      const n = yearStep(k, curYear, yLo, yHi)
      if (n === null) return
      e.preventDefault(); setKbd(true)
      setCurYear(Math.min(Math.max(n, yLo), yHi))
      return
    }
    if (view === 'months') {
      if (pick) { pickMonth(curMonth); return }
      const n = monthStep(k, curMonth)
      if (n === null) return
      e.preventDefault(); setKbd(true)
      setCurMonth(n < loYm ? loYm : n > hiYm ? hiYm : n)
      return
    }
    if (pick) { pickDay(curDay); return }
    const c = curDay, wd = D.weekdayMon0(c)
    const to = ({
      ArrowLeft: D.addDays(c, -1), ArrowRight: D.addDays(c, 1), ArrowUp: D.addDays(c, -7), ArrowDown: D.addDays(c, 7),
      PageUp: D.addMonths(c, e.shiftKey ? -12 : -1), PageDown: D.addMonths(c, e.shiftKey ? 12 : 1),
      Home: D.addDays(c, -wd), End: D.addDays(c, 6 - wd), t: today, T: today,
    } as Record<string, string>)[k]
    if (!to) return
    e.preventDefault(); setKbd(true)
    const n = D.clampDay(to, lo, hi)
    setCurDay(n); follow(n)
    if (mode === 'range' && anchor) setHover(n)
  }
  const onKeyUp = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    // Space activates a button on key-up; after Space picked a day, don't let that click reopen the popover.
    if (e.key === ' ' && spaceUp.current) { spaceUp.current = false; e.preventDefault() }
  }

  // ── presets ───────────────────────────────────────────────────────────────
  const custom = Array.isArray(props.presets) ? props.presets : null
  const dayPresets: D.DatePreset[] = mode !== 'day' || props.presets === false ? []
    : custom ? (custom as D.DatePreset[]).filter((p) => D.inRange(D.normDay(p.value), min, max)) : D.defaultDayPresets(today, min, max)
  const monthPresets: D.MonthPreset[] = mode !== 'month' || props.presets === false ? []
    : custom ? (custom as D.MonthPreset[]).filter((p) => D.monthUsable(D.normMonth(p.value), min, max)) : D.defaultMonthPresets(today, min, max)
  const rangePresets: D.RangePreset[] = mode !== 'range' || props.presets === false ? []
    : custom ? D.clampRangePresets((custom as D.RangePreset[]).map((p) => ({ ...p, from: D.normDay(p.from), to: D.normDay(p.to) })).filter((p) => p.from && p.to), min, max)
      : D.defaultRangePresets(today, min, max)

  // ── display ───────────────────────────────────────────────────────────────
  const fmt = props.format ?? 'long'
  const display = mode === 'range' ? D.fmtRange(range.from, range.to)
    : mode === 'month' ? (value ? D.fmtMonth(value as string, fmt) : '') : (value ? D.fmtDay(value as string, fmt) : '')
  const placeholder = props.placeholder ?? (mode === 'range' ? 'Select dates' : mode === 'month' ? 'Select month' : 'Select date')
  const invalid = !!(props.invalid || props.error || props['aria-invalid'] === true || props['aria-invalid'] === 'true' || nativeInvalid)
  const showClear = !!clearable && hasValue && !disabled && !readOnly
  const popId = `${uid}-pop`
  const activeId = !open ? undefined
    : view === 'years' ? `${uid}-y-${curYear}` : view === 'months' ? `${uid}-m-${curMonth}` : `${uid}-d-${curDay}`
  const dataAttrs: Record<string, unknown> = {}
  for (const k of Object.keys(props)) if (k.startsWith('data-')) dataAttrs[k] = (props as unknown as Record<string, unknown>)[k]

  // The box's own padding (outside the button) still opens the calendar, like a native input.
  const onWrapMouseDown = (e: ReactMouseEvent) => {
    if (e.target !== e.currentTarget || disabled) return
    e.preventDefault()
    triggerRef.current?.focus()
  }
  const onWrapClick = (e: ReactMouseEvent) => {
    if (e.target !== e.currentTarget || disabled) return
    e.preventDefault() // inside a <label>, don't let the label click the trigger a second time
    toggle()
  }

  // ── popover content ───────────────────────────────────────────────────────
  const band = mode !== 'range' ? null
    : anchor ? { from: hover && hover < anchor ? hover : anchor, to: hover && hover > anchor ? hover : anchor, preview: true }
      : range.from && range.to ? { from: range.from, to: range.to } : null
  const activeRangePreset = mode === 'range' && !anchor ? rangePresets.find((p) => p.from === range.from && p.to === range.to) : undefined
  const yearLabel = view === 'years' ? curYear : view === 'months' || mode === 'month' ? D.yearOf(curMonth) : D.yearOf(viewYm)
  // Arrows step a month (days), a year (months) or a decade (years).
  const prev = view === 'days' ? { off: D.addMonthsYm(viewYm, -1) < loYm, go: () => shiftMonths(-1), label: 'Previous month' }
    : view === 'months' ? { off: D.yearOf(curMonth) <= D.yearOf(lo), go: () => setCurMonth(D.clampMonth(D.addMonthsYm(curMonth, -12), lo, hi)), label: 'Previous year' }
      : { off: curYear <= yLo, go: () => setCurYear(Math.max(yLo, curYear - 10)), label: 'Previous decade' }
  const next = view === 'days' ? { off: D.addMonthsYm(lastShown, 1) > hiYm, go: () => shiftMonths(1), label: 'Next month' }
    : view === 'months' ? { off: D.yearOf(curMonth) >= D.yearOf(hi), go: () => setCurMonth(D.clampMonth(D.addMonthsYm(curMonth, 12), lo, hi)), label: 'Next year' }
      : { off: curYear >= yHi, go: () => setCurYear(Math.min(yHi, curYear + 10)), label: 'Next decade' }
  const nextArrow = <CalArrow dir="next" onClick={next.go} disabled={next.off} ariaLabel={next.label} />
  /** Chips + arrows; in the two-month range view the next arrow sits over the second month. */
  const header = (withNext = true) => (
    <div className="utc-head">
      {mode !== 'month' && (
        <CalChip label={D.MONTHS[D.monthOf(view === 'months' ? curMonth : viewYm) - 1]} active={view === 'months'} onClick={showMonths}
          ariaLabel={view === 'months' ? 'Back to days' : 'Choose month'} />
      )}
      <CalChip label={yearLabel} active={view === 'years'} onClick={showYears} ariaLabel={view === 'years' ? 'Close year list' : 'Choose year'} />
      <div className="utc-head-r">
        <CalArrow dir="prev" onClick={prev.go} disabled={prev.off} ariaLabel={prev.label} />
        {withNext && nextArrow}
      </div>
    </div>
  )
  const onHover = mode === 'range' && anchor ? (d: string) => setHover(d || anchor) : undefined
  const dayGrid = (ym: string, hideOutside: boolean) => (
    <DayGrid uid={uid} ym={ym} today={today} min={min} max={max} selected={mode === 'day' ? (value as string) : undefined}
      band={band} cursor={curDay} showCursor={kbd} hideOutside={hideOutside} onPick={pickDay} onHover={onHover} />
  )
  const body = (
    <div className="utc-body">
      {view === 'years' ? (
        <YearGrid uid={uid} lo={yLo} hi={yHi} today={today} min={min} max={max} cursor={curYear} showCursor={kbd} onPick={pickYear}
          selected={primary ? D.yearOf(primary) : undefined} />
      ) : view === 'months' || mode === 'month' ? (
        <MonthGrid uid={uid} year={D.yearOf(curMonth)} today={today} min={min} max={max} cursor={curMonth} showCursor={kbd} onPick={pickMonth}
          selected={mode === 'month' ? (value as string) : primary ? primary.slice(0, 7) : undefined} />
      ) : dayGrid(viewYm, mode === 'range' && twoUp)}
    </div>
  )
  const clearBtn = showClear && (
    <button type="button" tabIndex={-1} className="utc-clearbtn" onClick={() => { commit(mode === 'range' ? EMPTY_RANGE : ''); close(true) }}>Clear</button>
  )

  let content
  if (mode === 'range') {
    const n = band && !band.preview ? D.spanDays(band.from, band.to) : 0
    const side = !sheet && rangePresets.length > 0 && (
      <div className="utc-side" role="group" aria-label="Quick ranges">
        <div className="utc-side-t">Quick ranges</div>
        {rangePresets.map((p) => (
          <button key={p.label} type="button" tabIndex={-1} className={cx('utc-side-b', activeRangePreset === p && 'is-active')}
            onClick={() => { commit({ from: p.from, to: p.to }); close(true) }}>
            {p.label}{activeRangePreset === p && <Check size={14} strokeWidth={2.6} aria-hidden="true" />}
          </button>
        ))}
      </div>
    )
    content = (
      <>
        <div className="utc-rl">
          {side}
          {twoUp && view === 'days' ? (
            <div className="utc-two">
              <div>{header(false)}<div className="utc-body">{dayGrid(viewYm, true)}</div></div>
              <div>
                <div className="utc-head"><span className="utc-mcap">{D.fmtMonth(lastShown)}</span><div className="utc-head-r">{nextArrow}</div></div>
                <div className="utc-body">{dayGrid(lastShown, true)}</div>
              </div>
            </div>
          ) : (
            <div className="utc-main">{header()}{body}</div>
          )}
        </div>
        <div className="utc-foot">
          {(sheet || !side) && rangePresets.map((p) => (
            <button key={p.label} type="button" tabIndex={-1} className={cx('utc-preset', activeRangePreset === p && 'is-active')}
              onClick={() => { commit({ from: p.from, to: p.to }); close(true) }}>{p.label}</button>
          ))}
          {anchor ? <span className="utc-hint" role="status">Now pick the end date</span>
            : band ? <span className="utc-summary"><strong>{D.fmtRange(band.from, band.to)}</strong> · {n} {n === 1 ? 'day' : 'days'}</span>
              : <span className="utc-summary">Pick a start date, then an end date</span>}
          {clearBtn}
        </div>
      </>
    )
  } else {
    const chips = mode === 'day'
      ? dayPresets.map((p) => ({ label: p.label, v: D.normDay(p.value), on: D.normDay(p.value) === value }))
      : monthPresets.map((p) => ({ label: p.label, v: D.normMonth(p.value), on: D.normMonth(p.value) === value }))
    content = (
      <>
        {header()}
        {body}
        {(chips.length > 0 || clearBtn) && (
          <div className="utc-foot">
            {chips.map((c) => (
              <button key={c.label} type="button" tabIndex={-1} className={cx('utc-preset', c.on && 'is-active')}
                onClick={() => { commit(c.v); close(true) }}>{c.label}</button>
            ))}
            {clearBtn}
          </div>
        )}
      </>
    )
  }

  const popover = open && typeof document !== 'undefined' && createPortal(
    <>
      {sheet && <div className="utc-backdrop" aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); close(true) }} />}
      <div
        ref={setPop}
        id={popId}
        role="dialog"
        aria-label={mode === 'range' ? 'Choose date range' : mode === 'month' ? 'Choose month' : 'Choose date'}
        className={cx('utc-pop', mode === 'range' && 'is-range', sheet && 'is-sheet')}
        onMouseDown={(e) => e.preventDefault()}
        // React bubbles portal events through the field's ancestors: keep a pick from also clicking a table row.
        onClick={(e) => e.stopPropagation()}
      >
        {sheet && <div className="utc-grab" aria-hidden="true" />}
        {content}
      </div>
    </>,
    document.body,
  )

  const Icon = mode === 'range' ? CalendarRange : CalendarDays
  const small = props.size === 'sm' || /(^|\s)ut-input-sm(\s|$)/.test(props.className ?? '')
  return (
    <span
      ref={wrapRef}
      className={cx('utc-field', small && 'utc-sm', props.className)}
      style={props.style}
      title={props.title}
      data-open={open ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      data-readonly={readOnly ? '' : undefined}
      data-invalid={invalid ? '' : undefined}
      onMouseDown={onWrapMouseDown}
      onClick={onWrapClick}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        id={props.id}
        className="utc-trigger"
        disabled={disabled}
        autoFocus={props.autoFocus}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-activedescendant={activeId}
        aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']}
        aria-describedby={props['aria-describedby']}
        aria-invalid={invalid || undefined}
        aria-required={props.required || undefined}
        aria-readonly={readOnly || undefined}
        onClick={readOnly ? undefined : toggle}
        onKeyDown={readOnly ? undefined : onKeyDown}
        onKeyUp={onKeyUp}
        onFocus={() => live.current.onFocus?.(makeEvt('focus', value))}
        onBlur={(e) => {
          const to = e.relatedTarget as Node | null
          if (to && (wrapRef.current?.contains(to) || popRef.current?.contains(to))) return
          if (open) close(false)
          live.current.onBlur?.(makeEvt('blur', value))
        }}
        {...dataAttrs}
      >
        {props.icon !== false && <Icon size={small ? 15 : 16} strokeWidth={2} className="utc-ic" aria-hidden="true" />}
        <span className={cx('utc-text', !display && 'is-ph')}>{display || placeholder}</span>
        {!showClear && !readOnly && <ChevronDown size={small ? 14 : 15} strokeWidth={2.2} className="utc-chev" aria-hidden="true" />}
      </button>
      {showClear && (
        <button type="button" tabIndex={-1} className="utc-clear" aria-label="Clear" title="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { commit(mode === 'range' ? EMPTY_RANGE : ''); if (open) close(true); else triggerRef.current?.focus({ preventScroll: true }) }}>
          <X size={14} strokeWidth={2.4} aria-hidden="true" />
        </button>
      )}
      <input
        ref={setHidden}
        className="utc-native"
        tabIndex={-1}
        aria-hidden="true"
        name={props.name}
        value={hiddenString(value)}
        required={props.required}
        disabled={disabled}
        onChange={() => {}}
        onInvalid={() => { validating.current = true; setNativeInvalid(true); setTimeout(() => { validating.current = false }, 0) }}
        onFocus={() => {
          // Native validation focuses this input to show its message: leave it there. Anything else
          // (react-hook-form's setFocus, a label) belongs on the trigger.
          if (validating.current) { validating.current = false; return }
          triggerRef.current?.focus({ preventScroll: true })
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); openIt() }
        }}
      />
      {popover}
    </span>
  )
}

export const CalendarField = forwardRef(CalendarFieldImpl)
