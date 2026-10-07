// "Select dates": one picker for the dates a request form asks for (leave, leave on someone's
// behalf, work from home). A live "Start date · N days · End date" row, quick presets, an
// optional half-day switch, a month grid (arrows, or the keyboard; click the start, then the
// end, or the same day twice for one day) with weekly offs greyed, holidays dotted and named on
// hover, today outlined, days outside the form's limits disabled, and a footer with the working
// days the request is for — counted as the server counts a leave request (dateRangeModel.ts),
// or the server's own count when the form passes it — and Done.
// The month title opens a month grid (and its year, a year grid) to jump far quickly. A page with a
// longest range (maxSpan) says so in plain words when a range is longer, instead of blocking days.
// A list's start / end filter uses the same body in a popover: RangeFilter.tsx.
//
//   <DateRangeButton from={f.startDate} to={end} startLabel="From *" endLabel="To *" onOpen={() => setPicking(true)} />
//   <DateRangeDialog open={picking} onClose={() => setPicking(false)} from={f.startDate} to={end}
//     min={today} calendar={cal} onDone={(r) => …} />
//
// Mobile app twin: components/ui/DateRangeSheet.tsx.
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { Dialog } from './Dialog'
import { PanelButton } from './PanelButton'
import { istToday } from '@/design/dc/dates'
import {
  WEEK_HEADS, allowed, countWorkingDays, datePresets, ddmmyyyy, isWeeklyOff, monthTitle, monthWeeks,
  settled, shiftMonth, spanDays, tapDay, weekdayDdmmyyyy, workingDaysLabel,
  type DraftRange, type ViewPreset, type WorkCalendar,
} from './dateRangeModel'
import { dayKeyStep, monthCells, monthKeyStep, rangeProblem, yearCells, yearKeyStep, yearPageStart } from './rangeFilterModel'
import './dateRange.css'

export type { WorkCalendar } from './dateRangeModel'

export interface PickedDates { from: string; to: string; halfDay: boolean }

export interface DateRangeDialogProps {
  open: boolean
  onClose: () => void
  /** 'range' (start + end) or 'single' (one day). */
  mode?: 'range' | 'single'
  title?: string
  /** The form's current dates, yyyy-MM-dd ('' when none). */
  from: string
  to?: string
  /** The form's own earliest / latest day: days outside are disabled and presets are clamped. */
  min?: string | null
  max?: string | null
  /** Weekly offs (getDay() numbers) and holidays (day → name). */
  calendar: WorkCalendar
  /** Leave out when the form has no half days; otherwise the form's current choice. */
  halfDay?: boolean
  onDone: (picked: PickedDates) => void
  /** Every change of the draft, so the form can ask the server to count it. */
  onDraftChange?: (draft: PickedDates | null) => void
  /** The server's count for the current draft, once it has answered (wins over the local count). */
  serverDays?: number | null
  /** What the footer calls it: "Your request is for …". */
  noun?: string
  /** Override "today"; India's business day by default. */
  today?: string
  /** A calendar that only shows dates: its own quick picks (viewPresets) instead of the leave-form ones. */
  presets?: readonly ViewPreset[]
  /** A calendar that only shows dates: the footer line instead of "Your request is for N working days". */
  footerText?: (range: { from: string; to: string } | null) => string
  /** The holiday / weekly off / today key under the month (on by default). */
  legend?: boolean
  /** The longest range, in calendar days: a longer one is said in plain words and can't be applied. */
  maxSpan?: number
  /** A Cancel button beside Done (a picker that isn't a dialog with its own close). */
  onCancel?: () => void
  /** Done's label ("Apply"). */
  doneLabel?: string
  /** A Clear button: empties the picked days; with onClear, Clear does that instead (a filter goes back to all dates). */
  clearable?: boolean
  onClear?: () => void
  /** Open on the month or year grid (tests; the month title opens them). */
  initialView?: CalView
  /** The quick picks as a list beside the calendar (a wide popover); chips above it on a phone. */
  presetsSide?: boolean
}

/** What the calendar shows: a month's days, a year's months (the month title), or 12 years (the year title). */
export type CalView = 'days' | 'months' | 'years'

export function DateRangeDialog(props: DateRangeDialogProps) {
  const single = props.mode === 'single'
  return (
    <Dialog open={props.open} onClose={props.onClose} width={440} title={props.title ?? (single ? 'Select date' : 'Select dates')} closeLabel="Close">
      {props.open && <DateRangeBody {...props} />}
    </Dialog>
  )
}

/** The dialog's content (exported for tests: it renders without a document). */
export function DateRangeBody({
  mode = 'range', from, to, min, max, calendar, halfDay, onDone, onDraftChange, serverDays, noun = 'request', today: todayProp,
  presets: ownPresets, footerText, legend = true, maxSpan, onCancel, doneLabel = 'Done', clearable = false, onClear, initialView = 'days', presetsSide = false,
}: Omit<DateRangeDialogProps, 'open' | 'onClose' | 'title'>) {
  const uid = useId()
  const today = todayProp ?? istToday()
  const single = mode === 'single'
  const halfSupported = !single && halfDay !== undefined
  const first = from || null
  const [draft, setDraft] = useState<DraftRange>({ from: first, to: first ? (single ? first : to || first) : null })
  const [half, setHalf] = useState(!!halfDay)
  const startMonth = (first ?? (min && min > today ? min : max && max < today ? max : today)).slice(0, 7)
  const [month, setMonth] = useState(startMonth)
  const [cursor, setCursor] = useState(first ?? (allowed(today, min, max) ? today : `${startMonth}-01`))
  const [note, setNote] = useState<string | null>(null)
  const [view, setView] = useState<CalView>(initialView)
  // The month / year grids' cursor: a month 'yyyy-MM' and a year.
  const [mCursor, setMCursor] = useState(startMonth)
  const [yCursor, setYCursor] = useState(Number(startMonth.slice(0, 4)))
  const focusCursor = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  const can = (day: string) => allowed(day, min, max)
  const range = settled(draft)
  const effective = range && half ? { from: range.from, to: range.from } : range
  const localDays = effective ? countWorkingDays(effective.from, effective.to, calendar, half) : 0
  const days = serverDays ?? localDays

  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (!onDraftChange) return
    const key = effective ? `${effective.from}|${effective.to}|${half}` : ''
    if (key === sent.current) return
    sent.current = key
    onDraftChange(effective ? { ...effective, halfDay: half } : null)
  }, [effective?.from, effective?.to, half, onDraftChange]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusCursor.current) return
    focusCursor.current = false
    const sel = view === 'months' ? `[data-month="${mCursor}"]` : view === 'years' ? `[data-year="${yCursor}"]` : `[data-day="${cursor}"]`
    gridRef.current?.querySelector<HTMLElement>(sel)?.focus()
  }, [cursor, month, view, mCursor, yCursor])

  const presets = useMemo(() => ownPresets ?? datePresets(today, calendar, { min, max, single }), [ownPresets, today, calendar, min, max, single])
  const weeks = useMemo(() => monthWeeks(month), [month])
  const canPrev = !min || shiftMonth(month, -1) >= min.slice(0, 7)
  const canNext = !max || shiftMonth(month, 1) <= max.slice(0, 7)

  const describe = (day: string): string | null => {
    const hol = calendar.holidays.get(day)
    if (hol) return `${hol} · ${weekdayDdmmyyyy(day)}`
    if (isWeeklyOff(day, calendar)) return `Weekly off · ${weekdayDdmmyyyy(day)}`
    return null
  }
  const go = (n: -1 | 1) => {
    if ((n < 0 && !canPrev) || (n > 0 && !canNext)) return
    const m = shiftMonth(month, n)
    setMonth(m)
    setCursor(`${m}-01`)
    setNote(null)
  }
  // ── the month grid (a year's 12 months) and the year grid (12 years) ──
  const mYear = Number(mCursor.slice(0, 4))
  const months = useMemo(() => monthCells(mYear, min, max), [mYear, min, max])
  const years = useMemo(() => yearCells(yCursor, min, max), [yCursor, min, max])
  const yStart = yearPageStart(yCursor)
  const minYear = min ? Number(min.slice(0, 4)) : -Infinity, maxYear = max ? Number(max.slice(0, 4)) : Infinity
  const openMonths = () => { setMCursor(month); setView('months'); setNote(null); focusCursor.current = true }
  const openYears = () => { setYCursor(mYear); setView('years'); focusCursor.current = true }
  const pickMonth = (ym: string) => {
    if (monthCells(Number(ym.slice(0, 4)), min, max).find((c) => c.ym === ym)?.disabled) return
    setMonth(ym)
    setCursor(min && min.slice(0, 7) === ym ? min : `${ym}-01`)
    setView('days')
    focusCursor.current = true
  }
  const pickYear = (y: number) => {
    if (y < minYear || y > maxYear) return
    setMCursor(`${y}-${mCursor.slice(5, 7)}`)
    setView('months')
    focusCursor.current = true
  }
  const goYear = (n: -1 | 1) => { const y = mYear + n; if (y >= minYear && y <= maxYear) setMCursor(`${y}-${mCursor.slice(5, 7)}`) }
  const goYears = (n: -1 | 1) => { if (n < 0 ? yStart - 1 >= minYear : yStart + 12 <= maxYear) setYCursor(yCursor + n * 12) }
  const onMonthKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickMonth(mCursor); return }
    const n = monthKeyStep(e.key, mCursor)
    if (!n) return
    e.preventDefault()
    const y = Number(n.slice(0, 4))
    if (y < minYear || y > maxYear) return
    focusCursor.current = true
    setMCursor(n)
  }
  const onYearKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickYear(yCursor); return }
    const n = yearKeyStep(e.key, yCursor)
    if (n === null) return
    e.preventDefault()
    if (n < minYear || n > maxYear) return
    focusCursor.current = true
    setYCursor(n)
  }
  const pick = (day: string) => {
    if (!can(day)) return
    setDraft(tapDay(draft, day, single || half))
    setCursor(day)
    setNote(describe(day))
  }
  const applyPreset = (p: { from: string; to: string }) => {
    if (half && p.from !== p.to) setHalf(false)
    setDraft({ from: p.from, to: p.to })
    setMonth(p.from.slice(0, 7))
    setCursor(p.from)
    setNote(null)
  }
  const toggleHalf = (on: boolean) => {
    setHalf(on)
    if (on && draft.from) setDraft({ from: draft.from, to: draft.from })
  }
  const problem = single ? null : rangeProblem(effective, maxSpan)
  const done = () => { if (effective && !problem) onDone({ from: effective.from, to: effective.to, halfDay: half }) }
  const clear = () => {
    if (onClear) { onClear(); return }
    setDraft({ from: null, to: null })
    setHalf(false)
    setNote(null)
  }

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(cursor); return }
    const next = dayKeyStep(e.key, cursor)
    if (!next) return
    e.preventDefault()
    if (!allowed(next, min, max)) return
    focusCursor.current = true
    setCursor(next)
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7))
    setNote(describe(next))
  }

  const span = effective ? spanDays(effective.from, effective.to) : 0
  const allOff = !!effective && !single && days === 0
  const footer = problem ?? (footerText ? footerText(effective) : !effective
    ? (single ? 'Pick a day' : 'Pick the first day, then the last')
    : single ? `Selected date: ${weekdayDdmmyyyy(effective.from)}`
      : allOff ? 'These days are all weekly offs or holidays'
        : `Your ${noun} is for ${workingDaysLabel(days)}`)
  // The cursor must be a day of the month on screen, or nothing in the grid is focusable.
  const cursorShown = cursor.slice(0, 7) === month ? cursor : `${month}-01`

  return (
    <div className={presetsSide ? 'udr udr--side' : 'udr'}>
      <div className="udr-sum" aria-live="polite">
        {single ? (
          <div><span className="udr-sum-k">Date</span><span className="udr-sum-v">{effective ? weekdayDdmmyyyy(effective.from) : 'DD/MM/YYYY'}</span></div>
        ) : (
          <>
            <div><span className="udr-sum-k">Start date</span><span className="udr-sum-v">{ddmmyyyy(effective?.from)}</span></div>
            <span className="udr-sum-mid">{effective ? (half ? 'Half day' : `${span} ${span === 1 ? 'day' : 'days'}`) : '—'}</span>
            <div className="udr-sum-end"><span className="udr-sum-k">End date</span><span className="udr-sum-v">{draft.from && !draft.to && !half ? 'Pick end' : ddmmyyyy(effective?.to)}</span></div>
          </>
        )}
      </div>

      <div className="udr-presets" role="group" aria-label="Quick picks">
        {presets.map((p) => {
          const on = !p.disabled && !!effective && effective.from === p.from && effective.to === p.to
          return (
            <button key={p.key} type="button" className="udr-chip" aria-pressed={on} disabled={p.disabled} onClick={() => applyPreset(p)}>{p.label}</button>
          )
        })}
      </div>

      {halfSupported && (
        <label className="udr-half">
          <span><strong>Half day</strong><small>One day only</small></span>
          <input type="checkbox" role="switch" checked={half} onChange={(e) => toggleHalf(e.target.checked)} aria-label="Half day" />
        </label>
      )}

      {view === 'days' && (
        <div className="udr-month">
          <button type="button" className="udr-arrow" aria-label="Previous month" disabled={!canPrev} onClick={() => go(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="udr-month-t udr-title" id={`${uid}-m`} aria-label={`${monthTitle(month)}, choose a month`} onClick={openMonths}>
            {monthTitle(month)}<ChevronDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="udr-arrow" aria-label="Next month" disabled={!canNext} onClick={() => go(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      )}
      {view === 'months' && (
        <div className="udr-month">
          <button type="button" className="udr-arrow" aria-label="Previous year" disabled={mYear - 1 < minYear} onClick={() => goYear(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="udr-month-t udr-title" id={`${uid}-m`} aria-label={`${mYear}, choose a year`} onClick={openYears}>
            {mYear}<ChevronDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="udr-arrow" aria-label="Next year" disabled={mYear + 1 > maxYear} onClick={() => goYear(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      )}
      {view === 'years' && (
        <div className="udr-month">
          <button type="button" className="udr-arrow" aria-label="Earlier years" disabled={yStart - 1 < minYear} onClick={() => goYears(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <span className="udr-month-t" id={`${uid}-m`}>{yStart} – {yStart + 11}</span>
          <button type="button" className="udr-arrow" aria-label="Later years" disabled={yStart + 12 > maxYear} onClick={() => goYears(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      )}

      {view === 'months' && (
        <div ref={gridRef} role="grid" aria-labelledby={`${uid}-m`} className="udr-mgrid" onKeyDown={onMonthKey}>
          {[0, 3, 6, 9].map((r) => (
            <div role="row" className="udr-mrow" key={r}>
              {months.slice(r, r + 3).map((c) => {
                const on = !!effective && effective.from.slice(0, 7) <= c.ym && effective.to.slice(0, 7) >= c.ym
                return (
                  <span role="gridcell" key={c.ym} aria-selected={on}>
                    <button type="button" data-month={c.ym} className={['udr-mcell', on && 'is-on', c.ym === today.slice(0, 7) && 'is-today'].filter(Boolean).join(' ')}
                      tabIndex={c.ym === mCursor ? 0 : -1} disabled={c.disabled} aria-label={c.name} onClick={() => pickMonth(c.ym)}>{c.label}</button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}
      {view === 'years' && (
        <div ref={gridRef} role="grid" aria-labelledby={`${uid}-m`} className="udr-mgrid" onKeyDown={onYearKey}>
          {[0, 3, 6, 9].map((r) => (
            <div role="row" className="udr-mrow" key={r}>
              {years.slice(r, r + 3).map((c) => (
                <span role="gridcell" key={c.year} aria-selected={c.year === mYear}>
                  <button type="button" data-year={c.year} className={['udr-mcell', c.year === mYear && 'is-on', String(c.year) === today.slice(0, 4) && 'is-today'].filter(Boolean).join(' ')}
                    tabIndex={c.year === yCursor ? 0 : -1} disabled={c.disabled} aria-label={String(c.year)} onClick={() => pickYear(c.year)}>{c.year}</button>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

      {view === 'days' && (
        <div ref={gridRef} role="grid" aria-labelledby={`${uid}-m`} className="udr-grid" onKeyDown={onGridKey}>
          <div role="row" className="udr-row">
            {WEEK_HEADS.map((w, i) => <span key={w} role="columnheader" className={`udr-wd${calendar.off.has((i + 1) % 7) ? ' is-off' : ''}`}>{w}</span>)}
          </div>
          {weeks.map((week, wi) => (
            <div role="row" className="udr-row" key={wi}>
              {week.map((day, di) => {
                if (!day) return <span key={`b${di}`} role="gridcell" className="udr-cell is-blank" />
                const ok = can(day)
                const hol = calendar.holidays.get(day)
                const off = isWeeklyOff(day, calendar)
                const inBand = !!effective && day >= effective.from && day <= effective.to
                const edge = !!effective && (day === effective.from || day === effective.to)
                const label = [
                  weekdayDdmmyyyy(day), hol ? `holiday, ${hol}` : off ? 'weekly off' : null, day === today ? 'today' : null,
                ].filter(Boolean).join(', ')
                const cls = ['udr-cell', inBand && 'in-band', edge && 'is-edge', day === effective?.from && 'is-from', day === effective?.to && 'is-to',
                  di === 0 && 'row-start', di === 6 && 'row-end'].filter(Boolean).join(' ')
                return (
                  <span key={day} role="gridcell" className={cls} aria-selected={inBand}>
                    <button
                      type="button"
                      data-day={day}
                      tabIndex={day === cursorShown ? 0 : -1}
                      className={['udr-day', (off || hol) && 'is-off', day === today && 'is-today'].filter(Boolean).join(' ')}
                      disabled={!ok}
                      aria-label={label}
                      aria-pressed={edge}
                      title={hol ?? (off ? 'Weekly off' : undefined)}
                      onClick={() => pick(day)}
                      onMouseEnter={hol ? () => setNote(describe(day)) : undefined}
                    >
                      {Number(day.slice(8))}
                      {hol && <i className="udr-dot" aria-hidden="true" />}
                    </button>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {legend && (
        <div className="udr-legend" aria-hidden="true">
          <span><i className="udr-dot is-static" />Holiday (hover for its name)</span>
          <span><b className="udr-off-sample">15</b>Weekly off</span>
          <span><i className="udr-today-sample" />Today</span>
        </div>
      )}
      {note && <p className="udr-note">{note}</p>}
      <div className="udr-footrow">
        <span className={`udr-foot${allOff || problem ? ' is-warn' : ''}`} role={problem ? 'alert' : undefined} aria-live="polite">{footer}</span>
        <span className="udr-btns">
          {(clearable || onClear) && <button type="button" className="udr-clear" onClick={clear} disabled={!onClear && !draft.from}>Clear</button>}
          {onCancel && <PanelButton variant="secondary" onClick={onCancel}>Cancel</PanelButton>}
          <PanelButton variant="primary" onClick={done} disabled={!effective || !!problem}>{doneLabel}</PanelButton>
        </span>
      </div>
    </div>
  )
}

/**
 * The form's date box: "Start date | End date" (or one "Date"), DD/MM/YYYY, opening the dialog.
 * Each half is a button carrying its own label, so `getByRole('button', { name: /From/ })` works.
 */
export function DateRangeButton({
  from, to, onOpen, single = false, startLabel = 'Start date', endLabel = 'End date', disabled = false, endDisabled = false, invalid = false,
}: {
  from: string
  to?: string
  onOpen: () => void
  single?: boolean
  startLabel?: string
  endLabel?: string
  disabled?: boolean
  /** The end half is shown greyed (a half day has no separate end). */
  endDisabled?: boolean
  invalid?: boolean
}) {
  const half = (label: string, value: string | undefined, off: boolean) => (
    <button type="button" className="udr-field" disabled={disabled || off} aria-invalid={invalid || undefined}
      aria-haspopup="dialog" aria-label={`${label.replace(/\s*\*$/, '')}: ${value ? weekdayDdmmyyyy(value) : 'not picked'}`} onClick={onOpen}>
      <CalendarDays size={16} aria-hidden="true" />
      <span className="udr-field-t">
        <span className="udr-field-k">{label}</span>
        <span className={`udr-field-v${value ? '' : ' is-empty'}`}>{value ? ddmmyyyy(value) : 'DD/MM/YYYY'}</span>
      </span>
    </button>
  )
  return (
    <div className="udr-fields">
      {half(startLabel, from, false)}
      {!single && half(endLabel, to, endDisabled)}
    </div>
  )
}
