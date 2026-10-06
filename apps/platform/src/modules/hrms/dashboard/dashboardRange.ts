// The admin dashboard's date range (owner decision, 6 Oct 2026): a start and an end date, picked on one plain
// calendar (one click is a single day). One day behaves exactly as before (?date=, dashboardDate.ts). A range
// adds ?from= (its first day) to ?date= (its last day; none = today): the stat cards then add up the period
// from GET /v1/attendance/dashboard/trend (the same per-day counts as the chart), and the headcount card shows
// the end date's headcount with the period's joiners and leavers. Pure: vitest covers every rule here.
import { addDays, dt, isoOf, MON } from '@/design/dc/dates'
import { shiftDay, type ViewPreset } from '@/design/kit/dateRangeModel'
import type { DailyAttendanceCounts } from '../api/useAttendance'
import { trendBuckets, type DayBuckets } from '../attendance/attendanceBuckets'
import { pctOf } from './dashboardModel'

/**
 * The longest range the cards add up: the trend endpoint answers up to 31 days (it keeps the latest 31 of a
 * longer window), so a longer range would quietly drop its first days. "Last month" always fits.
 */
export const MAX_RANGE_DAYS = 31

const isDay = (raw: string | null | undefined): raw is string => !!raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && isoOf(dt(raw)) === raw

/**
 * The range's first day from ?from=, against its last day (`end`: the dashboard's date, today when none).
 * Null — one day, as before — when there is none, it isn't a real day, or it isn't before the end. A start more
 * than MAX_RANGE_DAYS before the end is moved up to the earliest day that fits.
 */
export function parseRangeFrom(raw: string | null | undefined, end: string): string | null {
  if (!isDay(raw) || raw >= end) return null
  const earliest = addDays(end, -(MAX_RANGE_DAYS - 1))
  return raw < earliest ? earliest : raw
}

/** "1–6 Oct", "28 Sep – 3 Oct", "30 Dec 2025 – 2 Jan 2026": the period as each card's note says it. */
export function periodLabel(from: string, to: string): string {
  const a = dt(from), b = dt(to)
  if (from === to) return `${a.getDate()} ${MON[a.getMonth()]}`
  if (a.getFullYear() !== b.getFullYear()) return `${a.getDate()} ${MON[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}`
  return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`
}

/** The date chip's text for a range: "1 Oct – 6 Oct 2026" (the year once, at the end, when both share it). */
export function chipRangeLabel(from: string, to: string): string {
  const a = dt(from), b = dt(to)
  const left = `${a.getDate()} ${MON[a.getMonth()]}${a.getFullYear() !== b.getFullYear() ? ` ${a.getFullYear()}` : ''}`
  return `${left} – ${b.getDate()} ${MON[b.getMonth()]} ${b.getFullYear()}`
}

/** Monday of the Mon–Sun week holding `iso`. */
const mondayOf = (iso: string) => shiftDay(iso, -((dt(iso).getDay() + 6) % 7))
const lastOfMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return isoOf(new Date(y, m, 0)) }
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }

/**
 * The picker's quick picks: Today · Yesterday · This week · Last week · This month · Last month. The dashboard
 * can't show a day after today, so "This week" and "This month" end today. Weeks are Monday to Sunday.
 */
export function dashboardPresets(today: string): ViewPreset[] {
  const monday = mondayOf(today), ym = today.slice(0, 7), last = prevMonth(ym)
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: 'thisWeek', label: 'This week', from: monday, to: today },
    { key: 'lastWeek', label: 'Last week', from: addDays(monday, -7), to: addDays(monday, -1) },
    { key: 'thisMonth', label: 'This month', from: `${ym}-01`, to: today },
    { key: 'lastMonth', label: 'Last month', from: `${last}-01`, to: lastOfMonth(last) },
  ]
}

/** What the picker's Apply sends back: one day (`from` null) or a range, in the URL's terms. */
export function pickToUrl(picked: { from: string; to: string }, today: string): { from: string | null; date: string | null } {
  const to = picked.to > today ? today : picked.to
  const from = picked.from < to ? picked.from : null
  return { from, date: to < today ? to : null }
}

// ── The period's totals ─────────────────────────────────────────────────────

export interface RangeTotals {
  /** Days of the period the trend answered for (calendar days, offs included). */
  days: number
  /** Person-days: each bucket added up over the period. */
  present: number; late: number; halfDay: number; wfh: number; onLeave: number; notMarked: number; absent: number
  /** Person-days people were expected at work (present + on leave + absent + not marked yet). */
  scheduled: number
  /** present ÷ scheduled, a whole percent (0 when nobody was expected). */
  attendancePct: number
  /** Each day's buckets, oldest first. */
  perDay: { date: string; b: DayBuckets }[]
}

/**
 * The period's totals from the trend's per-day counts, each day bucketed exactly as the dashboard buckets one
 * day of the trend (trendBuckets): every person once per day. Days outside [from, to] are left out.
 */
export function rangeTotals(rows: readonly DailyAttendanceCounts[], from: string, to: string, today: string): RangeTotals {
  const t: RangeTotals = { days: 0, present: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, notMarked: 0, absent: 0, scheduled: 0, attendancePct: 0, perDay: [] }
  const days = rows.filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  for (const r of days) {
    const b = trendBuckets(r, today)
    t.days++
    t.present += b.present; t.late += b.late; t.halfDay += b.halfDay; t.wfh += b.wfh
    t.onLeave += b.onLeave; t.notMarked += b.notMarked; t.absent += b.absent
    t.scheduled += b.total
    t.perDay.push({ date: r.date, b })
  }
  t.attendancePct = pctOf(t.present, t.scheduled)
  return t
}

/** The Total employees card's note for a range: the period's joiners and leavers, or the end date when the server can't say. */
export function rangeRollNote(st: { joinedInPeriod?: number; leftInPeriod?: number } | undefined, period: string, endLabel: string): string {
  if (st?.joinedInPeriod != null) return `${st.joinedInPeriod} joined · ${st.leftInPeriod ?? 0} left, ${period}`
  return `On ${endLabel}`
}

/** "1 day", "6 days". */
export const dayCount = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
