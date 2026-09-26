// Pure date helpers for the shared calendar. Every value is a plain local
// calendar string — 'yyyy-MM-dd' for a day, 'yyyy-MM' for a month — never a
// Date with a time or zone, so a picked day can't drift across midnight.
// "Today" is the IST business day (istToday), like the rest of the app.
import { istToday } from '@/design/dc/dates'

export { istToday }

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const MON = MONTHS.map((m) => m.slice(0, 3))
export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** Column headers, Monday first. */
export const WEEK_HEAD = [['Mo', 'Monday'], ['Tu', 'Tuesday'], ['We', 'Wednesday'], ['Th', 'Thursday'], ['Fr', 'Friday'], ['Sa', 'Saturday'], ['Su', 'Sunday']]

const pad = (n: number) => String(n).padStart(2, '0')

/** 'yyyy-MM-dd' (or 'yyyy-MM', day 1) → a local Date at midnight. */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
export function toDay(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
/** 'yyyy-MM' from a year and a 1-based month. */
export function toMonth(y: number, m1: number): string { return `${y}-${pad(m1)}` }
export const yearOf = (s: string) => Number(s.slice(0, 4))
export const monthOf = (s: string) => Number(s.slice(5, 7))

/** A valid 'yyyy-MM-dd' from anything (a longer ISO string is cut to its day), else ''. */
export function normDay(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''
  return toDay(parseDay(s)) === s ? s : ''
}
/** A valid 'yyyy-MM' from anything (a day is cut to its month), else ''. */
export function normMonth(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(s)) return ''
  const m = monthOf(s)
  return m >= 1 && m <= 12 ? s : ''
}

export function addDays(day: string, n: number): string { const d = parseDay(day); d.setDate(d.getDate() + n); return toDay(d) }
/** Moves by whole months, keeping the day of month where it exists (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(day: string, n: number): string {
  const d = parseDay(day), dom = d.getDate(), t = new Date(d.getFullYear(), d.getMonth() + n, 1)
  t.setDate(Math.min(dom, daysInMonth(t.getFullYear(), t.getMonth() + 1)))
  return toDay(t)
}
export function addMonthsYm(ym: string, n: number): string { return addMonths(ym + '-01', n).slice(0, 7) }
export function daysInMonth(y: number, m1: number): number { return new Date(y, m1, 0).getDate() }
/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(day: string): number { return (parseDay(day).getDay() + 6) % 7 }

export function inRange(day: string, min?: string, max?: string): boolean {
  return (!min || day >= min) && (!max || day <= max)
}
export function clampDay(day: string, min?: string, max?: string): string {
  if (min && day < min) return min
  if (max && day > max) return max
  return day
}
/** A month is usable when any of its days is. */
export function monthUsable(ym: string, min?: string, max?: string): boolean {
  return (!min || ym >= min.slice(0, 7)) && (!max || ym <= max.slice(0, 7))
}
export function yearUsable(y: number, min?: string, max?: string): boolean {
  return (!min || y >= yearOf(min)) && (!max || y <= yearOf(max))
}
export function clampMonth(ym: string, min?: string, max?: string): string {
  if (min && ym < min.slice(0, 7)) return min.slice(0, 7)
  if (max && ym > max.slice(0, 7)) return max.slice(0, 7)
  return ym
}
/** Same day of month in another month, clamped to that month's length and to min/max. */
export function dayInMonth(ym: string, dom: number, min?: string, max?: string): string {
  const y = yearOf(ym), m = monthOf(ym)
  return clampDay(`${ym}-${pad(Math.min(Math.max(1, dom), daysInMonth(y, m)))}`, min, max)
}

/**
 * The years the year view offers: min/max when given, else `from`…`to`
 * (default 1940 … today + 10), always widened to include the value and today.
 */
export function yearSpan(opts: { min?: string; max?: string; fromYear?: number; toYear?: number; today: string; value?: string }): [number, number] {
  const ty = yearOf(opts.today)
  let lo = opts.min ? yearOf(opts.min) : opts.fromYear ?? 1940
  let hi = opts.max ? yearOf(opts.max) : opts.toYear ?? ty + 10
  if (opts.value) { const vy = yearOf(opts.value); if (!opts.min) lo = Math.min(lo, vy); if (!opts.max) hi = Math.max(hi, vy) }
  if (!opts.min && ty < lo) lo = ty
  if (!opts.max && ty > hi) hi = ty
  return lo <= hi ? [lo, hi] : [hi, lo]
}

/** "Sat, 26 Sep 2026" (long) or "26 Sep 2026" (short). */
export function fmtDay(day: string, format: 'long' | 'short' = 'long'): string {
  const d = parseDay(day), s = `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
  return format === 'short' ? s : `${WD[d.getDay()]}, ${s}`
}
/** "Saturday, 26 September 2026" — for screen readers. */
export function fmtDayFull(day: string): string {
  const d = parseDay(day)
  return `${WDL[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
/** "September 2026" (long) or "Sep 2026" (short). */
export function fmtMonth(ym: string, format: 'long' | 'short' = 'long'): string {
  const m = monthOf(ym) - 1
  return `${format === 'short' ? MON[m] : MONTHS[m]} ${yearOf(ym)}`
}
/** "26 – 30 Sep 2026", "26 Sep – 3 Oct 2026", "26 Dec 2026 – 2 Jan 2027". */
export function fmtRange(from: string, to: string): string {
  if (!from && !to) return ''
  if (!to) return `${fmtDay(from, 'short')} – …`
  if (!from) return `… – ${fmtDay(to, 'short')}`
  if (from === to) return fmtDay(from, 'short')
  const a = parseDay(from), b = parseDay(to)
  if (a.getFullYear() !== b.getFullYear()) return `${fmtDay(from, 'short')} – ${fmtDay(to, 'short')}`
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${MON[a.getMonth()]} – ${fmtDay(to, 'short')}`
  return `${a.getDate()} – ${fmtDay(to, 'short')}`
}
/** Whole days from `from` to `to`, both included. */
export function spanDays(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86400000) + 1
}

/** The 42 days (6 weeks, Monday first) that show a month. */
export function monthCells(ym: string): string[] {
  const first = ym + '-01', start = addDays(first, -weekdayMon0(first))
  const out: string[] = []
  for (let i = 0; i < 42; i++) out.push(addDays(start, i))
  return out
}

// ── presets ──────────────────────────────────────────────────────────────────
export interface DatePreset { label: string; value: string }
export interface RangePreset { label: string; from: string; to: string }
export interface MonthPreset { label: string; value: string }

/** Today / Yesterday / Tomorrow / Next Monday — the first three that min/max allow. */
export function defaultDayPresets(today: string, min?: string, max?: string): DatePreset[] {
  const nextMon = addDays(today, 7 - weekdayMon0(today))
  const seen = new Set<string>()
  return ([['Today', today], ['Yesterday', addDays(today, -1)], ['Tomorrow', addDays(today, 1)], ['Next Monday', nextMon]] as [string, string][])
    .filter(([, v]) => inRange(v, min, max) && !seen.has(v) && !!seen.add(v))
    .slice(0, 3)
    .map(([label, value]) => ({ label, value }))
}

/** Common report ranges, each clamped to min/max; a range that falls wholly outside is dropped. */
export function defaultRangePresets(today: string, min?: string, max?: string): RangePreset[] {
  const ym = today.slice(0, 7), y = yearOf(today)
  const lastYm = addMonthsYm(ym, -1)
  const all: RangePreset[] = [
    { label: 'Today', from: today, to: today },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'Last 30 days', from: addDays(today, -29), to: today },
    { label: 'This month', from: ym + '-01', to: `${ym}-${pad(daysInMonth(y, monthOf(ym)))}` },
    { label: 'Last month', from: lastYm + '-01', to: `${lastYm}-${pad(daysInMonth(yearOf(lastYm), monthOf(lastYm)))}` },
    { label: 'This year', from: `${y}-01-01`, to: `${y}-12-31` },
    { label: 'Last year', from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ]
  return clampRangePresets(all, min, max)
}
export function clampRangePresets(list: RangePreset[], min?: string, max?: string): RangePreset[] {
  return list
    .filter((p) => p.from <= p.to && (!min || p.to >= min) && (!max || p.from <= max))
    .map((p) => ({ ...p, from: clampDay(p.from, min, max), to: clampDay(p.to, min, max) }))
}

export function defaultMonthPresets(today: string, min?: string, max?: string): MonthPreset[] {
  const ym = today.slice(0, 7)
  return [{ label: 'This month', value: ym }, { label: 'Last month', value: addMonthsYm(ym, -1) }]
    .filter((p) => monthUsable(p.value, min, max))
}
