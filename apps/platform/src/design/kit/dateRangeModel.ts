/**
 * The rules behind the "Select dates" dialog (DateRangePicker.tsx), the same
 * as the mobile app's utils/dateRange.ts so both count alike:
 * which days are working days, how many working days a range is, the quick
 * presets, what a tap on a day does, and the month grid.
 *
 * Working days are counted exactly the way the server counts a leave request
 * (LeaveService.calculateWorkingDays, the same count GET /v1/leave/preview
 * answers with): every calendar day from the start to the end, both included,
 * minus the weekly offs and minus the company's holidays. A half day is 0.5
 * when that day is a working day. No working days at all is 0.
 *
 * Every date is a plain calendar day ("2026-10-05"); "today" is India's
 * business day (istToday), whatever zone the browser is in. Weekdays are
 * JavaScript's getDay() numbers (0 = Sunday … 6 = Saturday), worked out with
 * UTC arithmetic so no time zone can shift a day.
 */
import { MONTHS } from '@/design/dc/dates'

/** Weekly offs (getDay() numbers) and holidays (yyyy-MM-dd → name) of the person's company. */
export interface WorkCalendar {
  off: ReadonlySet<number>
  holidays: ReadonlyMap<string, string>
}

/** A picked range; `to` is null while only the start has been tapped. */
export interface DraftRange {
  from: string | null
  to: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const DAY_MS = 86_400_000

function utcOf(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map((n) => parseInt(n, 10))
  return Date.UTC(y || 1970, (m || 1) - 1, d || 1)
}

function isoOfUtc(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** yyyy-MM-dd `n` days after `iso` (negative goes back). */
export function shiftDay(iso: string, n: number): string {
  return isoOfUtc(utcOf(iso) + n * DAY_MS)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  return new Date(utcOf(iso)).getUTCDay()
}

/** Calendar days from `from` to `to`, both included (0 when `to` is before `from`). */
export function spanDays(from: string, to: string): number {
  const n = Math.round((utcOf(to) - utcOf(from)) / DAY_MS) + 1
  return n > 0 ? n : 0
}

/**
 * The server's weekly offs (ISO 1 = Mon … 7 = Sun, as GET
 * /v1/settings/hr-configuration/weekend-days answers) as getDay() numbers.
 * Saturday and Sunday when the company hasn't set any, as the server does.
 */
export function offDaysFromIso(iso: readonly number[] | null | undefined): Set<number> {
  const days = (iso ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  return new Set((days.length ? days : [6, 7]).map((d) => d % 7))
}

export function isWeeklyOff(iso: string, cal: WorkCalendar): boolean {
  return cal.off.has(weekdayOf(iso))
}

export function isWorkingDay(iso: string, cal: WorkCalendar): boolean {
  return !isWeeklyOff(iso, cal) && !cal.holidays.has(iso)
}

/**
 * Working days from `from` to `to`, both included, counted as the server
 * counts a leave request: weekly offs and holidays are skipped; a half day is
 * 0.5 when there is a working day; no working day at all is 0.
 */
export function countWorkingDays(from: string, to: string, cal: WorkCalendar, halfDay = false): number {
  if (!from || !to || to < from) return 0
  const n = Math.min(spanDays(from, to), 366 * 2)
  let working = 0
  for (let i = 0; i < n; i++) if (isWorkingDay(shiftDay(from, i), cal)) working++
  if (working === 0) return 0
  return halfDay ? 0.5 : working
}

/** "1 working day", "2.5 working days", "0.5 working day". */
export function workingDaysLabel(n: number): string {
  return `${n} working ${n === 1 || n === 0.5 ? 'day' : 'days'}`
}

/** "05/10/2026": a yyyy-MM-dd as the date fields show it. */
export function ddmmyyyy(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : 'DD/MM/YYYY'
}

const WD3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "Mon, 05/10/2026". */
export function weekdayDdmmyyyy(iso: string): string {
  return `${WD3[weekdayOf(iso)]}, ${ddmmyyyy(iso)}`
}

// ── taps ────────────────────────────────────────────────────────────────────

/**
 * What a tap on `day` does. Single: that day. Range: the first tap is the
 * start; the next tap on or after it is the end (the same day again = one
 * day); a tap before the start starts again from there; a tap once both ends
 * are set starts a new range.
 */
export function tapDay(sel: DraftRange, day: string, single: boolean): DraftRange {
  if (single) return { from: day, to: day }
  if (!sel.from || sel.to) return { from: day, to: null }
  if (day < sel.from) return { from: day, to: null }
  return { from: sel.from, to: day }
}

/** The range a draft stands for: a start alone is that one day. */
export function settled(sel: DraftRange): { from: string; to: string } | null {
  if (!sel.from) return null
  return { from: sel.from, to: sel.to ?? sel.from }
}

/** Whether `day` may be picked under the form's own limits. */
export function allowed(day: string, min?: string | null, max?: string | null): boolean {
  return (!min || day >= min) && (!max || day <= max)
}

// ── presets ─────────────────────────────────────────────────────────────────

export type PresetKey = 'today' | 'tomorrow' | 'restOfWeek' | 'nextWeek' | 'nextMonday'

export interface DatePreset {
  key: PresetKey
  label: string
  from: string
  to: string
  /** Nothing of it fits the form's limits (or it has no working day). */
  disabled: boolean
}

/** Monday of the Mon–Sun week holding `iso`. */
function mondayOf(iso: string): string {
  return shiftDay(iso, -((weekdayOf(iso) + 6) % 7))
}

/**
 * The quick picks, clamped to the form's own min / max:
 *   Today · Tomorrow · Rest of this week (today, or the next working day, to the
 *   week's last working day) · Next week (Mon–Fri) · Next Monday.
 * A single-date form gets only the one-day picks.
 */
export function datePresets(
  today: string,
  cal: WorkCalendar,
  opts: { min?: string | null; max?: string | null; single?: boolean } = {},
): DatePreset[] {
  const { min, max, single } = opts
  const thisMonday = mondayOf(today)
  const nextMonday = shiftDay(thisMonday, 7)
  const sunday = shiftDay(thisMonday, 6)

  let restFrom: string | null = null
  let restTo: string | null = null
  for (let d = today; d <= sunday; d = shiftDay(d, 1)) {
    if (!isWorkingDay(d, cal)) continue
    if (!restFrom) restFrom = d
    restTo = d
  }

  const raw: { key: PresetKey; label: string; from: string | null; to: string | null; range: boolean }[] = [
    { key: 'today', label: 'Today', from: today, to: today, range: false },
    { key: 'tomorrow', label: 'Tomorrow', from: shiftDay(today, 1), to: shiftDay(today, 1), range: false },
    { key: 'restOfWeek', label: 'Rest of this week', from: restFrom, to: restTo, range: true },
    { key: 'nextWeek', label: 'Next week (Mon–Fri)', from: nextMonday, to: shiftDay(nextMonday, 4), range: true },
    { key: 'nextMonday', label: 'Next Monday', from: nextMonday, to: nextMonday, range: false },
  ]

  return raw
    .filter((p) => !single || !p.range)
    .map((p) => {
      if (!p.from || !p.to) return { key: p.key, label: p.label, from: today, to: today, disabled: true }
      const from = min && p.from < min ? min : p.from
      const to = max && p.to > max ? max : p.to
      const disabled = from > to || (p.range && countWorkingDays(from, to, cal) === 0)
      return { key: p.key, label: p.label, from, to, disabled }
    })
}

// ── month grid ──────────────────────────────────────────────────────────────

/** Monday-first weeks of a month ('yyyy-MM'); days outside the month are null. */
export function monthWeeks(ym: string): (string | null)[][] {
  const first = `${ym}-01`
  const lead = (weekdayOf(first) + 6) % 7
  const [y, m] = ym.split('-').map((n) => parseInt(n, 10))
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) cells.push(`${ym}-${pad(d)}`)
  while (cells.length % 7) cells.push(null)
  const weeks: (string | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** 'yyyy-MM' moved by `n` months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10))
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`
}

/** "October 2026". */
export function monthTitle(ym: string): string {
  const [y, m] = ym.split('-').map((v) => parseInt(v, 10))
  return `${MONTHS[m - 1] ?? ''} ${y}`
}

/** Monday-first weekday heads. */
export const WEEK_HEADS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
