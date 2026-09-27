// A month shown as a grid of days with their states — attendance and leave
// calendars (prototype EmpHome "September attendance", EmpTime month view,
// EmpLeave planner).
//
// Built on the shared calendar (src/shared/components/calendar): the same
// month model (dateMath.monthCells, Monday first), day formatting and IST
// "today". It only SHOWS a month. To pick a date in a form use DateField; to
// switch the month put the shared MonthField in the card header and pass its
// value here.
//
//   variant "compact"  34px tinted day chips, one-letter weekdays, legend below (Home)
//   variant "detail"   76px day cards with a status dot and a short line (Time → This month)
//   variant "planner"  52px days with a range, hatched holidays and team-off dots (Leave → Apply)
//   variant "tags"     68px day boxes listing small tags (UtSection calendar: who is off, filings due)
//
// Keyboard: the grid is one tab stop; arrows move by day / week, Home / End go
// to the start / end of the week, Page Up / Down change month when the page
// allows it (onMonthChange), Enter or Space picks the day (onSelect).
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import * as D from '@/shared/components/calendar/dateMath'
import { cx } from './displayUtil'
import type { StatusTone } from './StatusPill'
import './display.css'

/**
 * present · late · half (half day) · home (work from home) · leave · holiday · absent ·
 * fix (a day to fix, red outline) · off (weekly off) · none (no state, e.g. future days).
 */
export type CalendarTone = 'present' | 'late' | 'half' | 'home' | 'leave' | 'holiday' | 'absent' | 'fix' | 'off' | 'none'

export interface CalendarDay {
  /** yyyy-MM-dd */
  date: string
  tone?: CalendarTone
  /** Detail variant: the short line under the number ("09:24 – 18:40", "Late 12 min"). */
  label?: string
  /** Tooltip and screen-reader detail ("In 09:24 · out 18:40 · Face"). */
  tip?: string
  /** Planner: the small gold dot (e.g. someone in your team is off). */
  marker?: boolean
  /** Can't be picked (planner: past days, weekly offs). */
  disabled?: boolean
  /** Tags variant: short labels in the day box ("Priya · EL"). */
  tags?: readonly CalendarTag[]
}

export interface CalendarTag {
  label: string
  /** brand (done), warning (due), info, muted (the default), or any status tone. */
  tone?: StatusTone
}

export type CalendarVariant = 'compact' | 'detail' | 'planner' | 'tags'

export interface CalendarLegendItem {
  /** A day state, or today / range / marker (the planner's own marks). */
  tone: CalendarTone | 'today' | 'range' | 'marker'
  label: string
}

export interface MonthCalendarProps {
  /** The month to show: yyyy-MM (or any yyyy-MM-dd in it). */
  month: string
  /** The days you have data for; other days show as plain numbers. */
  days?: readonly CalendarDay[]
  variant?: CalendarVariant
  /** Today (yyyy-MM-dd). Default: the IST business day (istToday), like the shared calendar. Null = don't mark it. */
  today?: string | null
  /** The picked day (detail variant: the day whose details are open). */
  selected?: string | null
  /** Planner: the requested range (end may be empty while picking). */
  range?: { start: string; end?: string | null } | null
  /** Makes days pickable. */
  onSelect?: (date: string) => void
  /** Page Up / Page Down move a month; give this to allow it. */
  onMonthChange?: (delta: -1 | 1) => void
  /** Swatches under the grid, in your words ("Present", "Late"…). */
  legend?: readonly CalendarLegendItem[]
  /** Accessible name of the grid, e.g. "September 2026 attendance". Default: the month. */
  label?: string
  /** Tags variant: tags shown per day before "+n more" (default 2). */
  maxTags?: number
  className?: string
}

/** Default words for a day's state, for screen readers when the day has no tip. */
const TONE_WORD: Record<CalendarTone, string> = {
  present: 'Present', late: 'Late', half: 'Half day', home: 'Work from home', leave: 'On leave', holiday: 'Holiday',
  absent: 'Absent', fix: 'Needs a fix', off: 'Weekly off', none: '',
}

/**
 * The month's weeks (Monday first) from the shared calendar's 6-week grid,
 * with days of other months blanked ('') and all-blank trailing weeks dropped.
 */
export function monthWeeks(month: string): string[][] {
  const ym = D.normMonth(month)
  if (!ym) return []
  const cells = D.monthCells(ym).map((d) => (d.slice(0, 7) === ym ? d : ''))
  const weeks: string[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    const w = cells.slice(i, i + 7)
    if (w.some(Boolean)) weeks.push(w)
  }
  return weeks
}

/** Where focus goes for a key inside the month: a day, a month change, or null (not handled). */
export function calendarKeyTarget(key: string, date: string, month: string): string | 'prev-month' | 'next-month' | null {
  const ym = D.normMonth(month)
  const day = D.normDay(date)
  if (!ym || !day) return null
  const first = ym + '-01'
  const last = `${ym}-${String(D.daysInMonth(D.yearOf(ym), D.monthOf(ym))).padStart(2, '0')}`
  const col = D.weekdayMon0(day)
  const clamp = (d: string) => (d < first ? first : d > last ? last : d)
  switch (key) {
    case 'ArrowLeft': return clamp(D.addDays(day, -1))
    case 'ArrowRight': return clamp(D.addDays(day, 1))
    case 'ArrowUp': return clamp(D.addDays(day, -7))
    case 'ArrowDown': return clamp(D.addDays(day, 7))
    case 'Home': return clamp(D.addDays(day, -col))
    case 'End': return clamp(D.addDays(day, 6 - col))
    case 'PageUp': return 'prev-month'
    case 'PageDown': return 'next-month'
    default: return null
  }
}

const inMonth = (date: string | null | undefined, ym: string) => !!date && date.slice(0, 7) === ym

export function MonthCalendar({
  month, days = [], variant = 'compact', today, selected, range, onSelect, onMonthChange, legend, label, maxTags = 2, className,
}: MonthCalendarProps) {
  const ym = D.normMonth(month)
  const weeks = useMemo(() => monthWeeks(ym), [ym])
  const byDate = useMemo(() => {
    const m = new Map<string, CalendarDay>()
    for (const d of days) {
      const k = D.normDay(d.date)
      if (k) m.set(k, d)
    }
    return m
  }, [days])
  const [focus, setFocus] = useState<string | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  if (!ym) return null
  const first = ym + '-01'
  const todayIso = today === null ? '' : D.normDay(today ?? D.istToday())
  const sel = D.normDay(selected ?? '')
  const rStart = D.normDay(range?.start ?? '')
  const rEnd = D.normDay(range?.end ?? '') || rStart
  const [lo, hi] = rStart && rEnd < rStart ? [rEnd, rStart] : [rStart, rEnd]
  const interactive = !!onSelect

  // The one cell that takes Tab: the focused one, else the picked day, today, or the 1st.
  const tabStop = inMonth(focus, ym) ? focus! : inMonth(sel, ym) ? sel : inMonth(todayIso, ym) ? todayIso : first

  const moveTo = (d: string) => {
    setFocus(d)
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${d}"]`)?.focus())
  }

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, d: string) => {
    if ((e.key === 'Enter' || e.key === ' ') && interactive) {
      e.preventDefault()
      if (!byDate.get(d)?.disabled) onSelect!(d)
      return
    }
    const t = calendarKeyTarget(e.key, d, ym)
    if (!t) return
    e.preventDefault()
    if (t === 'prev-month' || t === 'next-month') {
      onMonthChange?.(t === 'prev-month' ? -1 : 1)
      return
    }
    if (t !== d) moveTo(t)
  }

  const word = (tone: CalendarTone) => legend?.find((l) => l.tone === tone)?.label ?? TONE_WORD[tone]
  const describe = (d: string, info: CalendarDay | undefined): string => {
    const parts = [D.fmtDayFull(d)]
    if (d === todayIso) parts.push('today')
    if (info?.tone && word(info.tone)) parts.push(word(info.tone))
    if (info?.label) parts.push(info.label)
    if (info?.tip) parts.push(info.tip)
    if (variant === 'planner' && info?.marker) parts.push(legend?.find((l) => l.tone === 'marker')?.label ?? 'marked')
    if (variant === 'tags' && info?.tags?.length) parts.push(info.tags.map((g) => g.label).join('; '))
    return parts.join(', ')
  }

  const cell = (d: string, key: number) => {
    if (!d) return <span key={`b${key}`} role="gridcell" aria-hidden="true" className="uk-cal__blank" />
    const info = byDate.get(d)
    const tone: CalendarTone = info?.tone ?? 'none'
    const isToday = d === todayIso
    const isSel = d === sel
    const inR = variant === 'planner' && !!lo && d >= lo && d <= hi
    const edge = inR && (d === lo || d === hi)
    const disabled = !!info?.disabled
    const n = D.parseDay(d).getDate()
    const common = {
      role: 'gridcell' as const,
      'data-date': d,
      tabIndex: d === tabStop ? 0 : -1,
      'aria-label': describe(d, info),
      'aria-selected': interactive ? isSel || edge : undefined,
      'aria-current': isToday ? ('date' as const) : undefined,
      'aria-disabled': interactive && disabled ? true : undefined,
      title: info?.tip,
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, d),
      onFocus: () => setFocus(d),
      onClick: interactive && !disabled ? () => { setFocus(d); onSelect!(d) } : undefined,
    }
    const pick = interactive && !disabled && 'is-pickable'
    if (variant === 'detail') {
      // As the design's Time view: holidays and weekly offs carry a line, not a dot.
      const dot = !isToday && tone !== 'none' && tone !== 'off' && tone !== 'holiday'
      return (
        <div key={d} {...common} className={cx('uk-cal__day', 'uk-cal__day--detail', `uk-cal--${tone}`, isSel && 'is-selected', pick, disabled && 'is-disabled')}>
          <span className="uk-cal__top" aria-hidden="true">
            <span className="uk-cal__n">{n}</span>
            {isToday ? <span className="uk-cal__todaytag">Today</span> : dot ? <span className="uk-cal__dot" /> : null}
          </span>
          {info?.label && <span className={cx('uk-cal__label', isToday && 'is-today')} aria-hidden="true">{info.label}</span>}
        </div>
      )
    }
    if (variant === 'tags') {
      const tags = info?.tags ?? []
      const over = tags.length > maxTags
      const shown = over ? tags.slice(0, Math.max(0, maxTags - 1)) : tags
      return (
        <div key={d} {...common} className={cx('uk-cal__day', 'uk-cal__day--tags', isToday && 'is-today', isSel && 'is-selected', pick)}>
          <span className="uk-cal__n" aria-hidden="true">{n}</span>
          {shown.map((g, gi) => (
            <span key={gi} className={cx('uk-cal__tag', `uk-tone--${g.tone ?? 'muted'}`)} aria-hidden="true">{g.label}</span>
          ))}
          {over && <span className="uk-cal__tag uk-tone--muted" aria-hidden="true">+{tags.length - shown.length} more</span>}
        </div>
      )
    }
    if (variant === 'planner') {
      return (
        <div key={d} {...common} className={cx('uk-cal__day', 'uk-cal__day--planner', inR && 'is-inrange', edge && 'is-edge', tone === 'holiday' && 'is-holiday', (disabled || tone === 'off') && 'is-muted', pick)}>
          <span className="uk-cal__n" aria-hidden="true">{n}</span>
          {info?.marker && <span className="uk-cal__marker" aria-hidden="true" />}
        </div>
      )
    }
    return (
      <div key={d} {...common} className={cx('uk-cal__day', 'uk-cal__day--compact', `uk-cal--${tone}`, isToday && 'is-today', isSel && 'is-selected', pick)}>
        <span aria-hidden="true">{n}</span>
      </div>
    )
  }

  return (
    <div className={cx('uk-cal', `uk-cal--v-${variant}`, className)}>
      <div ref={gridRef} role="grid" aria-label={label ?? D.fmtMonth(ym)} aria-readonly={interactive ? undefined : true} className="uk-cal__grid">
        <div role="row" className="uk-cal__row uk-cal__row--head">
          {D.WEEK_HEAD.map(([short, long]) => (
            <span key={short} role="columnheader" aria-label={long} className="uk-cal__head">
              {variant === 'compact' ? long[0] : long.slice(0, 3)}
            </span>
          ))}
        </div>
        {weeks.map((w, wi) => (
          <div role="row" key={wi} className="uk-cal__row">
            {w.map((d, ci) => cell(d, wi * 7 + ci))}
          </div>
        ))}
      </div>
      {legend && legend.length > 0 && <CalendarLegend items={legend} variant={variant} />}
    </div>
  )
}

/** The calendar's swatch row (also usable on its own, e.g. in a card header). */
export function CalendarLegend({ items, variant = 'compact', className }: { items: readonly CalendarLegendItem[]; variant?: CalendarVariant; className?: string }) {
  return (
    <div className={cx('uk-legend', 'uk-cal__legend', `uk-cal__legend--${variant}`, className)}>
      {items.map((it) => (
        <span key={it.tone + it.label} className="uk-legend__item">
          <span aria-hidden="true" className={cx('uk-cal__sw', `uk-cal__sw--${it.tone}`)} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
