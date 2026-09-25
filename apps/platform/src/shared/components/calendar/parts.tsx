// Building blocks of the shared calendar: the header chips and arrows, and the
// day, month and year grids. DateField / MonthField / DateRangeField compose
// them; the dashboard's DashCalendar reuses the month and year grids.
//
// Keyboard focus never moves into these grids: the field's trigger keeps focus
// and points at the cursor cell with aria-activedescendant, so every cell id is
// `${uid}-d-yyyy-MM-dd`, `${uid}-m-yyyy-MM` or `${uid}-y-yyyy`.
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import * as D from './dateMath'
import './calendar.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** A header button that opens the month or year view ("September ▾", "2026 ▾"). */
export function CalChip({ label, active, onClick, ariaLabel, disabled }: { label: ReactNode; active?: boolean; onClick: () => void; ariaLabel: string; disabled?: boolean }) {
  return (
    <button type="button" tabIndex={-1} className={cx('utc-chip', active && 'is-active')} aria-label={ariaLabel} aria-pressed={!!active} disabled={disabled} onClick={onClick}>
      <span>{label}</span>
      <ChevronDown size={14} strokeWidth={2.4} className="utc-chip-caret" aria-hidden="true" />
    </button>
  )
}

export function CalArrow({ dir, onClick, disabled, ariaLabel }: { dir: 'prev' | 'next'; onClick: () => void; disabled?: boolean; ariaLabel: string }) {
  return (
    <button type="button" tabIndex={-1} className="utc-arrow" aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {dir === 'prev' ? <ChevronLeft size={16} strokeWidth={2.2} aria-hidden="true" /> : <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  )
}

// ── day grid ─────────────────────────────────────────────────────────────────
export interface DayGridProps {
  uid: string
  /** The month shown, 'yyyy-MM'. */
  ym: string
  today: string
  min?: string
  max?: string
  selected?: string
  /** Range band (both ends set); `preview` draws it as the not-yet-picked hover range. */
  band?: { from: string; to: string; preview?: boolean } | null
  cursor?: string
  showCursor?: boolean
  /** Leave the neighbouring months' days blank (two-month range view). */
  hideOutside?: boolean
  onPick: (day: string) => void
  onHover?: (day: string) => void
}

export function DayGrid({ uid, ym, today, min, max, selected, band, cursor, showCursor, hideOutside, onPick, onHover }: DayGridProps) {
  const cells = D.monthCells(ym)
  const rows: string[][] = []
  for (let i = 0; i < 6; i++) rows.push(cells.slice(i * 7, i * 7 + 7))
  const last = `${ym}-${String(D.daysInMonth(D.yearOf(ym), D.monthOf(ym))).padStart(2, '0')}`
  return (
    <div role="grid" aria-label={D.fmtMonth(ym)} className="utc-dgrid" onMouseLeave={onHover ? () => onHover('') : undefined}>
      <div role="row" className="utc-row utc-whead">
        {D.WEEK_HEAD.map(([s, l], i) => <span key={s} role="columnheader" aria-label={l} className={cx('utc-wd', i > 4 && 'is-we')}>{s}</span>)}
      </div>
      {rows.map((row, r) => (
        <div role="row" className="utc-row" key={r}>
          {row.map((day) => {
            const outside = day.slice(0, 7) !== ym
            if (outside && hideOutside) return <span key={day} role="gridcell" className="utc-day is-blank" />
            const ok = D.inRange(day, min, max)
            const isToday = day === today
            const inBand = !!band && day >= band.from && day <= band.to
            const isStart = !!band && day === band.from, isEnd = !!band && day === band.to
            const isSel = selected === day || (!!band && !band.preview && (isStart || isEnd))
            const isEdge = !!band && (isStart || isEnd)
            return (
              <div
                key={day}
                id={`${uid}-d-${day}`}
                role="gridcell"
                aria-selected={isSel || inBand}
                aria-disabled={ok ? undefined : true}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${D.fmtDayFull(day)}${isToday ? ', today' : ''}${ok ? '' : ', not available'}`}
                className={cx('utc-day', outside && 'is-out', !ok && 'is-dis', isToday && 'is-today', isSel && 'is-sel',
                  inBand && band && band.from !== band.to && 'is-in', band?.preview && 'is-pv', isStart && 'is-start', isEnd && 'is-end', isEdge && 'is-edge',
                  day.endsWith('-01') && 'is-mfirst', day === last && 'is-mlast', showCursor && cursor === day && 'is-cursor')}
                onClick={ok ? () => onPick(day) : undefined}
                onMouseEnter={onHover && ok ? () => onHover(day) : undefined}
              >
                <span className="utc-dn">{Number(day.slice(8, 10))}</span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── month grid ───────────────────────────────────────────────────────────────
export interface MonthGridProps {
  uid: string
  year: number
  today: string
  min?: string
  max?: string
  /** 'yyyy-MM' */
  selected?: string
  cursor?: string
  showCursor?: boolean
  onPick: (ym: string) => void
}

export function MonthGrid({ uid, year, today, min, max, selected, cursor, showCursor, onPick }: MonthGridProps) {
  const rows = [0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => D.toMonth(year, r * 3 + c + 1)))
  return (
    <div role="grid" aria-label={`Months of ${year}`} className="utc-mgrid">
      {rows.map((row, r) => (
        <div role="row" className="utc-mrow" key={r}>
          {row.map((ym) => {
            const ok = D.monthUsable(ym, min, max), isNow = ym === today.slice(0, 7)
            return (
              <div key={ym} id={`${uid}-m-${ym}`} role="gridcell" aria-selected={selected === ym} aria-disabled={ok ? undefined : true}
                aria-current={isNow ? 'date' : undefined} aria-label={D.fmtMonth(ym)}
                className={cx('utc-mcell', !ok && 'is-dis', isNow && 'is-today', selected === ym && 'is-sel', showCursor && cursor === ym && 'is-cursor')}
                onClick={ok ? () => onPick(ym) : undefined}>
                {D.MON[D.monthOf(ym) - 1]}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── year grid: every year lo…hi in decade blocks, scrolled to the cursor ─────
export interface YearGridProps {
  uid: string
  lo: number
  hi: number
  today: string
  min?: string
  max?: string
  selected?: number
  cursor: number
  showCursor?: boolean
  onPick: (year: number) => void
}

export function YearGrid({ uid, lo, hi, today, min, max, selected, cursor, showCursor, onPick }: YearGridProps) {
  const box = useRef<HTMLDivElement>(null)
  const prev = useRef<number | null>(null)
  // Centre the cursor year when the view opens; afterwards follow it (a whole decade block when paging by ten).
  useLayoutEffect(() => {
    const b = box.current
    if (!b) return
    const cell = b.querySelector<HTMLElement>(`[data-y="${cursor}"]`)
    if (!cell) return
    const top = cell.offsetTop, bottom = top + cell.offsetHeight
    if (prev.current === null) {
      b.scrollTop = Math.max(0, top - (b.clientHeight - cell.offsetHeight) / 2)
    } else if (Math.abs(cursor - prev.current) >= 10) {
      const block = b.querySelector<HTMLElement>(`[data-dec="${Math.floor(cursor / 10)}"]`)
      smooth(b, Math.max(0, (block ?? cell).offsetTop - 2))
    } else if (top - 30 < b.scrollTop) {
      smooth(b, Math.max(0, top - 30))
    } else if (bottom + 8 > b.scrollTop + b.clientHeight) {
      smooth(b, bottom + 8 - b.clientHeight)
    }
    prev.current = cursor
  }, [cursor])
  const thisYear = D.yearOf(today)
  const decades: number[] = []
  for (let d = Math.floor(lo / 10); d <= Math.floor(hi / 10); d++) decades.push(d)
  return (
    <div ref={box} role="grid" aria-label="Years" className="utc-ygrid">
      {decades.map((dec) => (
        <div key={dec} className="utc-dec" data-dec={dec} role="rowgroup" aria-label={`${dec * 10}s`}>
          <div className="utc-dec-l" aria-hidden="true">{dec * 10}s</div>
          {[0, 1].map((r) => (
            <div role="row" className="utc-yrow" key={r}>
              {[0, 1, 2, 3, 4].map((c) => {
                const y = dec * 10 + r * 5 + c
                if (y < lo || y > hi) return <span key={y} className="utc-ycell is-void" aria-hidden="true" />
                const ok = D.yearUsable(y, min, max)
                return (
                  <div key={y} id={`${uid}-y-${y}`} data-y={y} role="gridcell" aria-selected={selected === y} aria-disabled={ok ? undefined : true}
                    aria-current={y === thisYear ? 'date' : undefined} aria-label={String(y)}
                    className={cx('utc-ycell', !ok && 'is-dis', y === thisYear && 'is-today', selected === y && 'is-sel', showCursor && cursor === y && 'is-cursor')}
                    onClick={ok ? () => onPick(y) : undefined}>
                    {y}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function smooth(el: HTMLElement, top: number) {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof el.scrollTo === 'function') el.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' })
  else el.scrollTop = top
}

// ── keyboard steps shared by every calendar ──────────────────────────────────
/** Month-view cursor step for a key, or null when the key doesn't move it. */
export function monthStep(key: string, cursor: string): string | null {
  const y = D.yearOf(cursor)
  switch (key) {
    case 'ArrowLeft': return D.addMonthsYm(cursor, -1)
    case 'ArrowRight': return D.addMonthsYm(cursor, 1)
    case 'ArrowUp': return D.addMonthsYm(cursor, -3)
    case 'ArrowDown': return D.addMonthsYm(cursor, 3)
    case 'PageUp': return D.addMonthsYm(cursor, -12)
    case 'PageDown': return D.addMonthsYm(cursor, 12)
    case 'Home': return D.toMonth(y, 1)
    case 'End': return D.toMonth(y, 12)
    default: return null
  }
}
/** Year-view cursor step (rows of five), or null. */
export function yearStep(key: string, cursor: number, lo: number, hi: number): number | null {
  switch (key) {
    case 'ArrowLeft': return cursor - 1
    case 'ArrowRight': return cursor + 1
    case 'ArrowUp': return cursor - 5
    case 'ArrowDown': return cursor + 5
    case 'PageUp': return cursor - 10
    case 'PageDown': return cursor + 10
    case 'Home': return lo
    case 'End': return hi
    default: return null
  }
}
