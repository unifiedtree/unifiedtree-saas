// Pure pieces of Shifts & overtime (P-ATT-PLAN), free of React so vitest covers them.
import { MON } from '@/design/dc/dates'
import type { OvertimeEntry, OvertimeRequest } from '../../api/useOvertime'

const WD3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "HH:mm:ss" → "HH:mm". */
export const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')

/** "09:30" and "18:30" → "09:30 – 18:30" (the design's 24-hour form). */
export const timeRange = (start?: string | null, end?: string | null) => (start && end ? `${hhmm(start)} – ${hhmm(end)}` : '—')

const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0) }
/** Ends at or before it starts: the shift runs past midnight. */
export const overnight = (start: string, end: string) => mins(hhmm(end)) <= mins(hhmm(start))
/** Length of a shift in minutes (a past-midnight shift wraps). */
export const span = (start: string, end: string) => { const d = (mins(hhmm(end)) - mins(hhmm(start)) + 1440) % 1440; return d || 1440 }

/**
 * A shift's working time a day in minutes: its working hours (the daily target attendance measures,
 * the "8h daily target" Master data shows), else the start-to-end span when none is set. A 09:00–18:00
 * shift with a 1-hour break works 8h, not 9h.
 */
export function workMinutes(s: { startTime: string; endTime: string; workingHoursPerDay?: number | null }) {
  return s.workingHoursPerDay && s.workingHoursPerDay > 0 ? Math.round(s.workingHoursPerDay * 60) : span(s.startTime, s.endTime)
}

/** Minutes → "1h 20m", "2h", "45m". */
export function hm(n: number | null | undefined) {
  const v = Math.round(Math.abs(n || 0)), h = Math.floor(v / 60), m = v % 60
  return h && m ? `${h}h ${String(m).padStart(2, '0')}m` : h ? `${h}h` : `${m}m`
}

/** ISO weekly offs [6, 7] → "Sat, Sun"; none set → null (the company's apply). */
export function weeklyOffLabel(days?: readonly number[] | null) {
  if (!days || days.length === 0) return null
  return [...days].sort((a, b) => a - b).filter((d) => d >= 1 && d <= 7).map((d) => WD3[d - 1]).join(', ')
}

/** The working days a shift's weekly offs leave: [6, 7] → "Mon–Fri", [7] → "Mon–Sat", [5, 6] → "Mon–Thu, Sun". */
export function workDaysLabel(offs?: readonly number[] | null) {
  const off = new Set(offs && offs.length ? offs : [6, 7])
  const on = [1, 2, 3, 4, 5, 6, 7].filter((d) => !off.has(d))
  if (!on.length) return 'No working days'
  const runs: number[][] = []
  for (const d of on) {
    const last = runs[runs.length - 1]
    if (last && d === last[last.length - 1] + 1) last.push(d); else runs.push([d])
  }
  return runs.map((r) => (r.length >= 3 ? `${WD3[r[0] - 1]}–${WD3[r[r.length - 1] - 1]}` : r.map((d) => WD3[d - 1]).join(', '))).join(', ')
}

/** Where a shift sits on the day, for the 00:00–24:00 bar: left and width in % (a past-midnight shift starts at its start, wrapping off the end). */
export function dayBar(start: string, end: string) {
  const s = mins(hhmm(start)), len = span(start, end)
  const left = (s / 1440) * 100, width = Math.min(100 - left, (len / 1440) * 100)
  return { left: Number(left.toFixed(2)), width: Number(width.toFixed(2)) }
}

const dmy = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return { y, m, d } }
/** "2026-10-03" → "3 Oct". */
export const dayMonth = (iso: string) => { const { m, d } = dmy(iso); return `${d} ${MON[m - 1]}` }

/** A change's days: "from 5 Oct" (permanent), "3 – 7 Aug" (same month), "30 Sep – 2 Oct". */
export function changeRange(start?: string | null, end?: string | null) {
  if (!start) return 'from the day it’s approved'
  if (!end) return `from ${dayMonth(start)}`
  const a = dmy(start), b = dmy(end)
  if (start === end) return `on ${dayMonth(start)}`
  return a.m === b.m && a.y === b.y ? `${a.d} – ${b.d} ${MON[b.m - 1]}` : `${dayMonth(start)} – ${dayMonth(end)}`
}

/** Status → pill tone and word, for shift changes and overtime alike. */
export const STATUS: Record<string, { tone: 'warning' | 'success' | 'danger' | 'neutral'; label: string }> = {
  PENDING: { tone: 'warning', label: 'Waiting' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  CANCELLED: { tone: 'neutral', label: 'Withdrawn' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
}
export const statusOf = (s: string) => STATUS[s] || { tone: 'neutral' as const, label: s.charAt(0) + s.slice(1).toLowerCase() }

/** yyyy-MM-dd from a date the API sends as a string or as epoch millis. */
export const isoDay = (v: unknown) => {
  if (typeof v === 'number') { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  return String(v ?? '').slice(0, 10)
}

/** Minutes that count for a punch day: what the server counted, else the stored minutes (older servers). */
export const counted = (e: OvertimeEntry) => (typeof e.countedMinutes === 'number' ? e.countedMinutes : e.minutes)

/**
 * The month's overtime figures over punch days and requests alike: everything not rejected or withdrawn ("logged"),
 * approved, and waiting; and how many people logged any.
 */
export function overtimeTotals(entries: readonly OvertimeEntry[], requests: readonly OvertimeRequest[], monthStart: string) {
  let logged = 0, approved = 0, waiting = 0
  const people = new Set<string>()
  const add = (who: string, min: number, status: string) => {
    if (status === 'REJECTED' || status === 'CANCELLED') return
    logged += min
    people.add(who)
    if (status === 'APPROVED') approved += min
    if (status === 'PENDING') waiting += min
  }
  for (const e of entries) if (isoDay(e.date) >= monthStart) add(e.employeeId, counted(e), e.status)
  for (const r of requests) if (r.date >= monthStart) add(r.employeeId, r.minutes, r.status)
  return { logged, approved, waiting, people: people.size }
}

/** Hours and minutes typed in two boxes → minutes; blanks are 0; null when both are blank or not whole numbers. */
export function toMinutes(hours: string, minutes: string) {
  const h = hours.trim(), m = minutes.trim()
  if (!h && !m) return null
  if ((h && !/^\d+$/.test(h)) || (m && !/^\d+$/.test(m))) return null
  return Number(h || 0) * 60 + Number(m || 0)
}

/** The overtime rules card: "1h (default)", "No cap". */
export const minimumLabel = (minutes: number, isDefault: boolean) => (minutes === 0 ? 'From the first minute' : `${hm(minutes)}${isDefault ? ' (default)' : ''}`)
export const capLabel = (minutes: number | null) => (minutes == null ? 'No cap' : minutes === 0 ? 'None can be approved' : `${hm(minutes)} a month per person`)
