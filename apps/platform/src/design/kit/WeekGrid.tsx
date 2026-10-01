// A week, one row per person (prototype TeamSchedule; the PgTime roster): each day shows what
// the person is doing in the design's tones —
//
//   shift    their usual shift (brand soft: "General · 09:30 – 18:30")
//   alt      another shift (periwinkle: "Evening · 14:00 – 23:00")
//   home     work from home (mint outline: "Home · Approved")
//   leave    approved leave (sand: "Leave · Approved")
//   pending  a request waiting for the viewer (dashed gold, a button: "Leave? · Waiting for you")
//   holiday  a holiday (hatched gold: "Gandhi Jayanti")
//   off      a weekly off (quiet "Off")
//   none     nothing known (quiet text, or empty)
//
//   variant "tiles"  44px tiles (Team schedule), with the coverage row on top: each day's
//                    "7 of 8" in the office and a bar, "thin" under half the team, or the
//                    rest day's word ("Holiday", "Weekly off").
//   variant "pills"  the roster table: status pills in the UtSection table look.
//
// A real <table role="grid">. It is one Tab stop: the arrow keys move a cell at a time (the name
// column included), Home / End go to the ends of the row, Ctrl+Home / Ctrl+End to the first and
// last cell, Page Up / Page Down change the week when the page allows it (onWeekChange), and
// Enter or Space opens a cell that has an action. Today's column is marked. On narrow screens
// the days scroll sideways inside the card while the name column stays in place.
//
// Only shows what it's given: who, which shifts, leave, holidays and offs come from the API.
import { useEffect, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import * as D from '@/shared/components/calendar/dateMath'
import { Avatar } from './Avatar'
import { StatusPill, type StatusTone } from './StatusPill'
import { SkeletonTable } from './Skeleton'
import { cx, linkClick } from './displayUtil'
import './display.css'
import './data.css'

export type WeekTone = 'shift' | 'alt' | 'home' | 'leave' | 'pending' | 'holiday' | 'off' | 'none'

export interface WeekCell {
  tone: WeekTone
  /** First line: "General", "Leave?", "Gandhi Jayanti", "Off". */
  title?: ReactNode
  /** Second line: "09:30 – 18:30", "Waiting for you", "Approved". */
  sub?: ReactNode
  /** What screen readers hear for the cell; default its words. Actionable cells also get the person and the day. */
  label?: string
  /** Tooltip. */
  tip?: string
  /** Pills variant: the pill's colour, when the tone's default doesn't fit (a shift's own colour). */
  pill?: StatusTone
  /** Makes the cell a button (decide a request waiting for you, change a shift). */
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void
  /** Keeps an actionable cell focusable but inert (with a tip saying why). */
  disabled?: boolean
}

export interface WeekRow {
  key: string
  /** The person's name (also the row's name for screen readers). */
  name: string
  /** A line under the name (the roster shows the department). */
  sub?: ReactNode
  initials?: string
  /** Photo URL. */
  src?: string | null
  /** One entry per day, in the order of `days`; null or missing = nothing that day. */
  cells: readonly (WeekCell | null | undefined)[]
  /** The person's page: the name becomes a link (only when the viewer may open it). */
  href?: string
  onOpen?: (e: MouseEvent<HTMLElement>) => void
}

export interface WeekDayCoverage {
  /** People in the office that day. */
  count: number
  /** People in the grid. */
  total: number
  /** Under half the team in. */
  thin?: boolean
  /** A rest day's word instead of the count ("Holiday", "Weekly off"). */
  rest?: ReactNode
}

export interface WeekGridProps {
  /** The days, yyyy-MM-dd (usually weekDays(anyDayOfTheWeek)). */
  days: readonly string[]
  rows: readonly WeekRow[]
  /** Accessible name ("Team schedule, Mon 28 Sep – Sun 4 Oct"). */
  label: string
  variant?: 'tiles' | 'pills'
  /** The coverage row (tiles): 'auto' counts it from the cells; or pass one entry per day. */
  coverage?: 'auto' | readonly (WeekDayCoverage | null | undefined)[]
  /** Heading of the name column. Default "In the office" with coverage, else "Employee". */
  nameHeader?: ReactNode
  /** A day's column heading. Default "Mon 28". */
  dayLabel?: (day: string) => ReactNode
  /** Today (yyyy-MM-dd) for the marked column. Default the IST business day; null = don't mark. */
  today?: string | null
  /** Page Up / Page Down move a week; give this to allow it. */
  onWeekChange?: (delta: -1 | 1) => void
  loading?: boolean
  loadingRows?: number
  /** A line when there are no rows ("No one in your team scope"). */
  empty?: ReactNode
  /** Below this width the days scroll sideways (default 900 for tiles, 760 for pills). */
  minWidth?: number
  className?: string
  style?: CSSProperties
}

// ── Week maths (pure) ───────────────────────────────────────────────────────

/** The 7 days (yyyy-MM-dd) of the week holding `day`: Monday first (weekStartsOn 1, the app's rule) or Sunday first (0). */
export function weekDays(day: string, weekStartsOn: 0 | 1 = 1): string[] {
  const d = D.normDay(day)
  if (!d) return []
  const back = (D.parseDay(d).getDay() - weekStartsOn + 7) % 7
  const start = D.addDays(d, -back)
  return Array.from({ length: 7 }, (_, i) => D.addDays(start, i))
}

/** The same weekday `weeks` weeks away (negative = back). */
export function shiftWeek(day: string, weeks: number): string {
  const d = D.normDay(day)
  return d ? D.addDays(d, Math.trunc(weeks) * 7) : ''
}

/** A day's column heading: "Mon 28". */
export function dayHead(day: string): string {
  const d = D.normDay(day)
  if (!d) return ''
  const x = D.parseDay(d)
  return `${D.WD[x.getDay()]} ${x.getDate()}`
}

/** The week as the design writes it: "Mon 28 Sep – Sun 4 Oct" (with the years when it crosses one). */
export function weekLabel(days: readonly string[]): string {
  const list = days.map((d) => D.normDay(d)).filter(Boolean)
  if (!list.length) return ''
  const a = D.parseDay(list[0]), b = D.parseDay(list[list.length - 1])
  const years = a.getFullYear() !== b.getFullYear()
  const part = (x: Date) => `${D.WD[x.getDay()]} ${x.getDate()} ${D.MON[x.getMonth()]}${years ? ' ' + x.getFullYear() : ''}`
  return list.length === 1 ? part(a) : `${part(a)} – ${part(b)}`
}

export interface WeekCoverageCount {
  /** Rows with a shift that day (shift or alt). */
  count: number
  /** All rows. */
  total: number
  /** Under half the rows in (never on a rest day). */
  thin: boolean
  /** Everyone is on a holiday or weekly off (holiday wins when both). */
  rest: 'holiday' | 'off' | null
}

/**
 * Who is in the office on day `index`: people with a shift (not on leave, at home, off or with a
 * request still waiting). Null when no cell that day says anything (an empty week).
 */
export function weekCoverage(rows: readonly Pick<WeekRow, 'cells'>[], index: number): WeekCoverageCount | null {
  let count = 0, hol = 0, off = 0, known = 0
  for (const r of rows) {
    const t = r.cells[index]?.tone ?? 'none'
    if (t === 'none') continue
    known++
    if (t === 'shift' || t === 'alt') count++
    else if (t === 'holiday') hol++
    else if (t === 'off') off++
  }
  if (!known) return null
  const total = rows.length
  const rest = count === 0 && hol + off === known ? (hol > 0 ? 'holiday' : 'off') : null
  return { count, total, thin: !rest && count < total / 2, rest }
}

export type WeekGridMove = { row: number; col: number } | 'prev-week' | 'next-week' | null

/** Where a key moves focus in the grid (col -1 is the name column); null when the key isn't the grid's. */
export function weekGridKeyTarget(key: string, row: number, col: number, rows: number, cols: number, ctrl = false): WeekGridMove {
  if (rows <= 0) return null
  const last = cols - 1
  switch (key) {
    case 'ArrowRight': return { row, col: Math.min(last, col + 1) }
    case 'ArrowLeft': return { row, col: Math.max(-1, col - 1) }
    case 'ArrowDown': return { row: Math.min(rows - 1, row + 1), col }
    case 'ArrowUp': return { row: Math.max(0, row - 1), col }
    case 'Home': return ctrl ? { row: 0, col: -1 } : { row, col: -1 }
    case 'End': return ctrl ? { row: rows - 1, col: last } : { row, col: last }
    case 'PageUp': return 'prev-week'
    case 'PageDown': return 'next-week'
    default: return null
  }
}

// ── Component ───────────────────────────────────────────────────────────────

const TONE_WORD: Record<WeekTone, string> = {
  shift: 'Shift', alt: 'Shift', home: 'Work from home', leave: 'Leave', pending: 'Waiting for you', holiday: 'Holiday', off: 'Off', none: 'Nothing planned',
}
const PILL: Record<WeekTone, StatusTone> = {
  shift: 'brand', alt: 'info', home: 'mint', leave: 'neutral', pending: 'warning', holiday: 'holiday', off: 'muted', none: 'muted',
}

const plain = (n: ReactNode): string => (typeof n === 'string' || typeof n === 'number' ? String(n) : '')
function spokenCell(c: WeekCell): string {
  if (c.label) return c.label
  const words = [plain(c.title), plain(c.sub)].filter(Boolean).join(', ')
  return words || TONE_WORD[c.tone]
}

function autoCoverage(rows: readonly WeekRow[], i: number): WeekDayCoverage | null {
  const c = weekCoverage(rows, i)
  if (!c) return null
  return { count: c.count, total: c.total, thin: c.thin, rest: c.rest === 'holiday' ? 'Holiday' : c.rest === 'off' ? 'Weekly off' : undefined }
}

export function WeekGrid({
  days, rows, label, variant = 'tiles', coverage, nameHeader, dayLabel = dayHead, today, onWeekChange, loading, loadingRows = 6, empty,
  minWidth, className, style,
}: WeekGridProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ row: number; col: number } | null>(null)
  const [scrolled, setScrolled] = useState(false)
  // After Page Up / Page Down the cells are the new week's: put focus back on the same place.
  const refocus = useRef<string | null>(null)
  useEffect(() => {
    const key = refocus.current
    if (!key) return
    refocus.current = null
    wrapRef.current?.querySelector<HTMLElement>(`[data-wg="${key}"]`)?.focus({ preventScroll: true })
  })

  // The name column gets a divider once the days scroll under it.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const on = () => setScrolled(el.scrollLeft > 1)
    on()
    el.addEventListener('scroll', on, { passive: true })
    return () => el.removeEventListener('scroll', on)
  }, [loading])

  const tiles = variant === 'tiles'
  const nCols = days.length
  const nRows = rows.length
  const todayIso = today === null ? '' : D.normDay(today ?? D.istToday())
  const todayCol = todayIso ? days.indexOf(todayIso) : -1
  const want = pos ?? { row: 0, col: todayCol >= 0 ? todayCol : 0 }
  const cur = { row: Math.max(0, Math.min(nRows - 1, want.row)), col: Math.max(-1, Math.min(nCols - 1, want.col)) }
  const stop = (r: number, c: number) => (cur.row === r && cur.col === c ? 0 : -1)
  const at = (r: number, c: number) => `${r}:${c}`

  const cls = cx('uk-wg', `uk-wg--${variant}`, scrolled && 'is-scrolled', className)
  // Pills: the name column takes 1.8 shares to each day's 1 (the UtSection table's flex 1.8 / 1).
  const wrapStyle = {
    ...style,
    ['--wg-min' as string]: `${minWidth ?? (tiles ? 900 : 760)}px`,
    ...(tiles ? null : { ['--wg-namepct' as string]: `${(180 / (1.8 + Math.max(1, nCols))).toFixed(2)}%` }),
  } as CSSProperties

  if (loading) {
    return (
      <div ref={wrapRef} className={cls} style={wrapStyle}>
        <SkeletonTable rows={loadingRows} cols={Math.min(8, nCols + 1)} label={`Loading ${label}`} />
      </div>
    )
  }

  const focusCell = (r: number, c: number) => {
    setPos({ row: r, col: c })
    requestAnimationFrame(() => wrapRef.current?.querySelector<HTMLElement>(`[data-wg="${at(r, c)}"]`)?.focus())
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    const t = (e.target as HTMLElement).closest?.('[data-wg]') as HTMLElement | null
    if (!t || e.altKey) return
    const [r, c] = (t.dataset.wg ?? '').split(':').map(Number)
    if (!Number.isFinite(r) || !Number.isFinite(c)) return
    const m = weekGridKeyTarget(e.key, r, c, nRows, nCols, e.ctrlKey || e.metaKey)
    if (!m) return
    if (m === 'prev-week' || m === 'next-week') {
      if (!onWeekChange) return
      e.preventDefault()
      setPos({ row: r, col: c })
      refocus.current = at(r, c)
      onWeekChange(m === 'prev-week' ? -1 : 1)
      return
    }
    e.preventDefault()
    if (m.row !== r || m.col !== c) focusCell(m.row, m.col)
  }
  const onFocus = (e: FocusEvent<HTMLTableElement>) => {
    const t = (e.target as HTMLElement).closest?.('[data-wg]') as HTMLElement | null
    if (!t) return
    const [r, c] = (t.dataset.wg ?? '').split(':').map(Number)
    if (Number.isFinite(r) && Number.isFinite(c) && (r !== cur.row || c !== cur.col)) setPos({ row: r, col: c })
  }

  const cov = coverage === 'auto' ? days.map((_, i) => autoCoverage(rows, i)) : coverage
  const hasCov = tiles && !!cov

  const head = (d: string, i: number) => {
    const isToday = i === todayCol
    const c = hasCov ? cov![i] : null
    const rest = c && c.rest != null && c.rest !== '' ? c.rest : null
    const spoken = [D.fmtDayFull(d), isToday ? 'today' : '',
      c ? (rest ? plain(rest) : `${c.count} of ${c.total} in the office${c.thin ? ', thin' : ''}`) : ''].filter(Boolean).join(', ')
    const pct = c && !rest && c.total > 0 ? Math.max(0, Math.min(100, (c.count / c.total) * 100)) : 0
    return (
      <th key={i} scope="col" role="columnheader" aria-label={spoken} className={cx('uk-wg__th', isToday && 'is-today')}>
        <span className="uk-wg__head" aria-hidden="true">
          <span className="uk-wg__day">
            {dayLabel(d)}
            {isToday && <span className="uk-wg__todaytag">Today</span>}
          </span>
          {c && (rest
            ? <span className="uk-wg__cov">{rest}</span>
            : (
              <>
                <span className="uk-wg__covbar"><span style={{ width: `${pct.toFixed(1)}%` }} /></span>
                <span className="uk-wg__cov">{c.count} of {c.total}{c.thin ? ' · thin' : ''}</span>
              </>
            ))}
        </span>
      </th>
    )
  }

  const cellBody = (c: WeekCell) => {
    if (!tiles) {
      if (c.tone === 'off' || c.tone === 'none') return <span className="uk-wg__plain">{c.title ?? (c.tone === 'off' ? 'Off' : '')}</span>
      return (
        <span className="uk-wg__pillcell">
          <StatusPill tone={c.pill ?? PILL[c.tone]} size="sm">{c.title ?? TONE_WORD[c.tone]}</StatusPill>
          {c.sub != null && c.sub !== '' && <span className="uk-wg__psub">{c.sub}</span>}
        </span>
      )
    }
    return (
      <>
        {c.title != null && c.title !== '' && <span className="uk-wg__t">{c.title}</span>}
        {c.sub != null && c.sub !== '' && <span className="uk-wg__s">{c.sub}</span>}
      </>
    )
  }

  const cell = (row: WeekRow, r: number, d: string, ci: number) => {
    const c = row.cells[ci] ?? null
    const isToday = ci === todayCol
    const tdCls = cx('uk-wg__td', isToday && 'is-today')
    if (c?.onClick) {
      const name = c.label ?? `${row.name}, ${D.fmtDayFull(d)}: ${spokenCell(c)}`
      return (
        <td key={ci} role="gridcell" className={tdCls}>
          <button type="button" data-wg={at(r, ci)} tabIndex={stop(r, ci)} title={c.tip} aria-label={name} aria-disabled={c.disabled || undefined}
            className={cx(tiles ? cx('uk-wg__tile', `uk-wg--${c.tone}`) : 'uk-wg__pbtn', 'uk-wg__act')}
            onClick={(e) => { if (!c.disabled) c.onClick!(e) }}>
            {cellBody(c)}
          </button>
        </td>
      )
    }
    return (
      <td key={ci} role="gridcell" className={tdCls} data-wg={at(r, ci)} tabIndex={stop(r, ci)} aria-label={c?.label} title={c?.tip}>
        {c && (tiles ? <span className={cx('uk-wg__tile', `uk-wg--${c.tone}`)}>{cellBody(c)}</span> : cellBody(c))}
      </td>
    )
  }

  const person = (row: WeekRow) => (
    <>
      <Avatar name={row.name} initials={row.initials} src={row.src} size={32} tone={tiles ? 'pale' : 'soft'} weight={600} />
      <span className="uk-wg__who">
        <span className="uk-wg__nm">{row.name}</span>
        {row.sub != null && row.sub !== '' && <span className="uk-wg__sub">{row.sub}</span>}
      </span>
    </>
  )

  return (
    <div ref={wrapRef} className={cls} style={wrapStyle}>
      <table role="grid" aria-label={label} aria-readonly="true" className="uk-wg__table" onKeyDown={onKeyDown} onFocus={onFocus}>
        <colgroup>
          <col className="uk-wg__col-name" />
          {days.map((_, i) => <col key={i} />)}
        </colgroup>
        <thead>
          <tr role="row" className="uk-wg__hrow">
            <th scope="col" role="columnheader" className="uk-wg__th uk-wg__th--name">{nameHeader ?? (hasCov ? 'In the office' : 'Employee')}</th>
            {days.map(head)}
          </tr>
        </thead>
        <tbody>
          {nRows === 0 && empty != null && (
            <tr role="row">
              <td role="gridcell" colSpan={nCols + 1} className="uk-wg__empty">{empty}</td>
            </tr>
          )}
          {rows.map((row, r) => {
            const link = !!(row.href || row.onOpen)
            return (
              <tr key={row.key} role="row" className="uk-wg__row">
                <th scope="row" role="rowheader" className="uk-wg__name"
                  {...(link ? {} : { 'data-wg': at(r, -1), tabIndex: stop(r, -1) })}>
                  {row.href
                    ? <a className="uk-wg__person uk-wg__open" href={row.href} data-wg={at(r, -1)} tabIndex={stop(r, -1)} onClick={linkClick(row.onOpen)}>{person(row)}</a>
                    : row.onOpen
                      ? <button type="button" className="uk-wg__person uk-wg__open" data-wg={at(r, -1)} tabIndex={stop(r, -1)} onClick={row.onOpen}>{person(row)}</button>
                      : <span className="uk-wg__person">{person(row)}</span>}
                </th>
                {days.map((d, ci) => cell(row, r, d, ci))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export interface WeekLegendItem {
  tone: WeekTone
  label: ReactNode
}

/** The swatches under the grid ("General shift", "Other shifts", "Home", "Leave", "Waiting for you · tap to decide"). */
export function WeekLegend({ items, className }: { items: readonly WeekLegendItem[]; className?: string }) {
  return (
    <div className={cx('uk-wg-legend', className)}>
      {items.map((it, i) => (
        <span key={`${it.tone}-${i}`} className="uk-wg-legend__item">
          <span aria-hidden="true" className={cx('uk-wg-legend__sw', `uk-wg--${it.tone}`)} />
          {it.label}
        </span>
      ))}
    </div>
  )
}
