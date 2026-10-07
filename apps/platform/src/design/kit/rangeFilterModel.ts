/**
 * The rules behind the start / end calendar that sits next to a list's filters (RangeFilter.tsx) and the
 * month / year jump inside the "Select dates" calendar (DateRangePicker.tsx). Pure, so vitest covers them.
 *
 *   - the quick picks of a list of records (Today … Last month, This year)
 *   - the range kept in the URL as ?from=&to= (links and Back keep it)
 *   - the longest range a page allows, said in plain words instead of silently blocking days
 *   - the month grid (12 months of a year) and the year grid (12 years) the month title opens
 *   - the arrow keys on those grids
 *   - whether a record's date falls in the range (for lists the page holds in full)
 *
 * Every date is a plain calendar day ("2026-10-05"); "today" is India's business day (istToday).
 */
import { MON, MONTHS } from '@/design/dc/dates'
import { shiftDay, shiftMonth, spanDays, weekdayOf, ddmmyyyy, type ViewPreset } from './dateRangeModel'

/** A picked range, both ends included. */
export interface DayRange { from: string; to: string }

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Whether `raw` is a real calendar day 'yyyy-MM-dd' (not 2026-02-30). */
export function isDay(raw: string | null | undefined): raw is string {
  if (!raw || !DAY.test(raw)) return false
  const [y, m, d] = raw.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const monday = (iso: string) => shiftDay(iso, -((weekdayOf(iso) + 6) % 7))
const lastOf = (ym: string) => shiftDay(`${shiftMonth(ym, 1)}-01`, -1)

/**
 * The quick picks of a list of records: Today · Yesterday · This week · Last week · This month · Last month ·
 * Last 3 months · This year. Weeks are Monday to Sunday; "this" periods run to their end (a list can hold
 * records dated later in the week or month, e.g. leave that starts on Friday). Clamped to the page's limits;
 * a pick wholly outside them is disabled.
 */
export function historyPresets(today: string, opts: { min?: string | null; max?: string | null } = {}): ViewPreset[] {
  const mon = monday(today), ym = today.slice(0, 7), last = shiftMonth(ym, -1)
  const raw: ViewPreset[] = [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: shiftDay(today, -1), to: shiftDay(today, -1) },
    { key: 'thisWeek', label: 'This week', from: mon, to: shiftDay(mon, 6) },
    { key: 'lastWeek', label: 'Last week', from: shiftDay(mon, -7), to: shiftDay(mon, -1) },
    { key: 'thisMonth', label: 'This month', from: `${ym}-01`, to: lastOf(ym) },
    { key: 'lastMonth', label: 'Last month', from: `${last}-01`, to: lastOf(last) },
    { key: 'last3Months', label: 'Last 3 months', from: `${shiftMonth(ym, -2)}-01`, to: lastOf(ym) },
    { key: 'thisYear', label: 'This year', from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` },
  ]
  return raw.map((p) => clampPreset(p, opts.min, opts.max))
}

/** A quick pick cut to the page's limits; disabled when nothing of it is left. */
export function clampPreset(p: ViewPreset, min?: string | null, max?: string | null): ViewPreset {
  const from = min && p.from < min ? min : p.from
  const to = max && p.to > max ? max : p.to
  return from > to ? { ...p, disabled: true } : { ...p, from, to }
}

/** A month ('yyyy-MM') as a range, first to last day: where a page had a month box, a month is a quick pick now. */
export function monthRange(ym: string): DayRange {
  return { from: `${ym}-01`, to: lastOf(ym) }
}

// ── the longest range ───────────────────────────────────────────────────────

/**
 * What is wrong with a range for a page that allows at most `maxSpan` days (null when it's fine).
 * "Pick 31 days or fewer. This range is 45 days."
 */
export function rangeProblem(range: DayRange | null, maxSpan?: number): string | null {
  if (!range || !maxSpan) return null
  const n = spanDays(range.from, range.to)
  return n > maxSpan ? `Pick ${maxSpan} days or fewer. This range is ${n} days.` : null
}

// ── the URL ─────────────────────────────────────────────────────────────────

export interface RangeKeys { from: string; to: string }
export const RANGE_KEYS: RangeKeys = { from: 'from', to: 'to' }

/**
 * The range in the URL (?from=&to=). Ends past the page's limits are cut to them (a link to "this month" on a page
 * that stops at today). Null when either end is missing or isn't a real day, when the start is after the end, when
 * nothing is left inside the limits, or when the range is longer than the page allows: the page shows its default.
 */
export function readRange(
  params: URLSearchParams,
  opts: { keys?: RangeKeys; min?: string | null; max?: string | null; maxSpan?: number } = {},
): DayRange | null {
  const keys = opts.keys ?? RANGE_KEYS
  const from = params.get(keys.from), to = params.get(keys.to)
  if (!isDay(from) || !isDay(to) || from > to) return null
  const a = opts.min && from < opts.min ? opts.min : from
  const z = opts.max && to > opts.max ? opts.max : to
  if (a > z || rangeProblem({ from: a, to: z }, opts.maxSpan)) return null
  return { from: a, to: z }
}

/** The URL's query with the range written in (null removes it); other parameters are kept, `drop` ones removed. */
export function writeRange(search: string | URLSearchParams, range: DayRange | null, opts: { keys?: RangeKeys; drop?: readonly string[] } = {}): URLSearchParams {
  const keys = opts.keys ?? RANGE_KEYS
  const p = new URLSearchParams(search)
  if (range) { p.set(keys.from, range.from); p.set(keys.to, range.to) } else { p.delete(keys.from); p.delete(keys.to) }
  for (const k of opts.drop ?? []) p.delete(k)
  return p
}

// ── labels ──────────────────────────────────────────────────────────────────

/** The trigger's text: "01/10/2026 – 07/10/2026", or one date for a one-day range. */
export function rangeText(range: DayRange | null): string {
  if (!range) return ''
  return range.from === range.to ? ddmmyyyy(range.from) : `${ddmmyyyy(range.from)} – ${ddmmyyyy(range.to)}`
}

/** "1 Oct – 7 Oct 2026": the range as a note or a file name's reader says it. */
export function rangeWords(range: DayRange): string {
  const [fy, fm, fd] = range.from.split('-').map(Number)
  const [ty, tm, td] = range.to.split('-').map(Number)
  if (range.from === range.to) return `${fd} ${MON[fm - 1]} ${fy}`
  return `${fd} ${MON[fm - 1]}${fy !== ty ? ` ${fy}` : ''} – ${td} ${MON[tm - 1]} ${ty}`
}

// ── the month and year grids ────────────────────────────────────────────────

export interface MonthCell { ym: string; label: string; name: string; disabled: boolean }
export interface YearCell { year: number; disabled: boolean }

/** The 12 months of `year`, three to a row; a month wholly outside the limits is disabled. */
export function monthCells(year: number, min?: string | null, max?: string | null): MonthCell[] {
  return MON.map((label, i) => {
    const ym = `${year}-${String(i + 1).padStart(2, '0')}`
    const disabled = (!!min && lastOf(ym) < min) || (!!max && `${ym}-01` > max)
    return { ym, label, name: `${MONTHS[i]} ${year}`, disabled }
  })
}

/** The first year of the 12-year page holding `year` (2016–2027, 2028–2039 …). */
export function yearPageStart(year: number): number {
  return year - (((year - 2016) % 12) + 12) % 12
}

/** The 12 years of the page holding `year`; a year wholly outside the limits is disabled. */
export function yearCells(year: number, min?: string | null, max?: string | null): YearCell[] {
  const start = yearPageStart(year)
  return Array.from({ length: 12 }, (_, i) => {
    const y = start + i
    return { year: y, disabled: (!!min && `${y}-12-31` < min) || (!!max && `${y}-01-01` > max) }
  })
}

/** Arrow keys on the month grid (3 to a row): the month the cursor moves to, or null for another key. */
export function monthKeyStep(key: string, ym: string): string | null {
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }
  return key in step ? shiftMonth(ym, step[key]) : null
}

/** Arrow keys on the year grid (3 to a row): the year the cursor moves to, or null for another key. */
export function yearKeyStep(key: string, year: number): number | null {
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3, PageUp: -12, PageDown: 12 }
  return key in step ? year + step[key] : null
}

/** Arrow keys on the day grid: the day the cursor moves to, or null for another key. */
export function dayKeyStep(key: string, day: string): string | null {
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }
  if (key in step) return shiftDay(day, step[key])
  if (key === 'PageUp' || key === 'PageDown') {
    const ym = shiftMonth(day.slice(0, 7), key === 'PageUp' ? -1 : 1)
    const d = Math.min(Number(day.slice(8)), Number(lastOf(ym).slice(8)))
    return `${ym}-${String(d).padStart(2, '0')}`
  }
  if (key === 'Home') return monday(day)
  if (key === 'End') return shiftDay(monday(day), 6)
  return null
}

// ── records in a range ──────────────────────────────────────────────────────

/**
 * The India business day of a record's date: a plain day as it is; an instant ("2026-10-05T20:00:00Z") as the
 * day it was in India (so a claim filed at 1 am IST counts on that day, not the UTC day before).
 */
export function istDayOf(value: string | null | undefined): string | null {
  if (!value) return null
  if (DAY.test(value)) return value
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) return value.slice(0, 10) // a local date-time: its own day
  const t = Date.parse(value)
  if (Number.isNaN(t)) return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null
  return new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

/** Whether a record dated `value` falls in the range (no range: every record does; no date: none does). */
export function inDayRange(value: string | null | undefined, range: DayRange | null): boolean {
  if (!range) return true
  const d = istDayOf(value)
  return !!d && d >= range.from && d <= range.to
}

/** Whether a record that runs from `start` to `end` (leave, WFH) overlaps the range at all. */
export function overlapsRange(start: string | null | undefined, end: string | null | undefined, range: DayRange | null): boolean {
  if (!range) return true
  const a = istDayOf(start), b = istDayOf(end) ?? a
  return !!a && !!b && a <= range.to && b >= range.from
}

/** The rows of a list the page holds in full, kept to the range. */
export function keepInRange<T>(rows: readonly T[], range: DayRange | null, dateOf: (row: T) => string | null | undefined): T[] {
  return range ? rows.filter((r) => inDayRange(dateOf(r), range)) : [...rows]
}

/** Whether a page of results is the whole list (so filtering it in the browser is honest). */
export function wholeList(loaded: number, total: number | null | undefined): boolean {
  return total == null || loaded >= total
}

/** The months ('yyyy-MM') a range touches, oldest first, at most `cap` (a month-by-month endpoint asks for each). */
export function monthsOf(range: DayRange, cap = 12): string[] {
  const out: string[] = []
  for (let ym = range.from.slice(0, 7); ym <= range.to.slice(0, 7) && out.length < cap; ym = shiftMonth(ym, 1)) out.push(ym)
  return out
}
