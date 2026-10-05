// Pure view logic for the admin dashboard (PgDashboard.dc.html). Everything here works on real API
// data handed in by AdminDashboardContainer; nothing is sample data. Kept free of React so vitest covers it.
import { addDays, dt, MON, MONTHS, WD } from '@/design/dc/dates'
import type { DayBuckets } from '../attendance/attendanceBuckets'
import { isWeeklyOff, offWeekdays } from '../attendance/attendanceBuckets'
import type { StaffStatusResponse } from '../api/useAttendance'

// ── Section pills (header) ────────────────────────────────────────────────────
export type DashSection = 'overview' | 'attendance' | 'upcoming' | 'people' | 'hiring' | 'payroll'
export const DASH_SECTIONS: { key: DashSection; label: string; icon: string }[] = [
  { key: 'overview', label: 'Overview', icon: 'dashboard' },
  { key: 'attendance', label: 'Attendance', icon: 'clock' },
  { key: 'upcoming', label: 'Upcoming', icon: 'calendar' },
  { key: 'people', label: 'People', icon: 'users' },
  { key: 'hiring', label: 'Hiring & projects', icon: 'briefcase' },
  { key: 'payroll', label: 'Payroll & activity', icon: 'rupee' },
]

/** The pills for the sections the viewer can see, in the design's order. A hidden section has no pill. */
export function sectionPills(show: Record<DashSection, boolean>) {
  return DASH_SECTIONS.filter((s) => show[s.key])
}

// ── Numbers ──────────────────────────────────────────────────────────────────
/** Share of a whole as a whole percent; 0 when there is no whole. */
export const pctOf = (n: number, whole: number) => (whole > 0 ? Math.round((n / whole) * 100) : 0)

/** People scheduled on the day: the roster less holidays, weekly offs and people not tracked. */
export const scheduledOf = (c: Pick<DayBuckets, 'total' | 'other'>) => Math.max(0, c.total - (c.other || 0))

/**
 * The Present card's note: the share of the people scheduled on the day, and, when that isn't the
 * Total employees figure beside it, why. A company-wide viewer's cards cover everyone on the roll (the
 * viewer too), so the gap is the people off that day (weekly off, holiday); anyone else's attendance
 * cards cover their team only, while Total employees is the whole company. The note is one line on a
 * card that also holds a sparkline, so each wording stays short enough to be read whole.
 */
export function presentNote(present: number, sched: number, o: { total: number | null; companyWide: boolean; isPast: boolean }): string {
  if (!sched) {
    if (!o.companyWide) return o.isPast ? 'No team members that day' : 'No team members today'
    return o.isPast ? 'Nobody was scheduled' : 'Nobody scheduled today'
  }
  if (!o.companyWide) return `${pctOf(present, sched)}% of ${sched} in your team`
  // Scheduled and off add up to Total employees.
  const off = o.total != null ? o.total - sched : 0
  return off > 0 ? `${sched} scheduled · ${off} off` : `${pctOf(present, sched)}% of ${sched} scheduled`
}

/** ₹ in lakh with one decimal ("₹62.5L"), as the design's payroll figures. */
export const lakh = (n: number) => '₹' + (n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + 'L'
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

/** Round a chart's top up to a tidy value and return ticks from top to 0. */
export function niceScale(max: number, steps = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: steps, ticks: Array.from({ length: steps + 1 }, (_, i) => steps - i) }
  const raw = max / steps, mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw
  const top = step * steps
  return { max: top, ticks: Array.from({ length: steps + 1 }, (_, i) => top - i * step) }
}

// ── Total employees ──────────────────────────────────────────────────────────
/** The summary's people figures (GET /v1/admin/dashboard/stats, with hrms.employee.read). */
export interface RollStats {
  /** Everyone on the roll on the day. Servers before the Home fix sent it for a past day only. */
  headcount?: number
  /** Confirmed (ACTIVE) people. */
  activeEmployees?: number
  probation?: number
  onNotice?: number
  /** Past days: the month's joiners and leavers up to the day. */
  joinedInMonth?: number
  leftInMonth?: number
}

/**
 * Everyone on the roll on the day: the summary's headcount, else the headcount report's (the same rule), else the
 * directory's count; null while none is known. Never the day's attendance roster, which leaves out the people on
 * their weekly off and the viewer.
 */
export function rollTotal(st: RollStats | undefined, report: readonly { total?: number | string | null }[] | undefined, directory: number | undefined): number | null {
  if (st?.headcount != null) return Number(st.headcount)
  if (report) return report.reduce((n, r) => n + (Number(r.total) || 0), 0)
  return directory ?? null
}

/**
 * The Total employees note. Today: who is confirmed, on probation and serving notice ("1 confirmed · 10 on
 * probation"), so the figure adds up; a past day: that month's joiners and leavers up to it (`range`).
 * People on probation are active employees too, so the confirmed ones are "confirmed", never "active".
 */
export function rollNote(st: RollStats | undefined, isPast: boolean, range: string): string {
  if (isPast && st?.joinedInMonth != null) return `${st.joinedInMonth} joined · ${st.leftInMonth ?? 0} left, ${range}`
  // A server without the split sends the confirmed count alone, which reads as if the rest had left.
  if (st?.probation == null || st.activeEmployees == null) return 'Everyone on the roll'
  const parts = [
    st.activeEmployees ? `${st.activeEmployees} confirmed` : '',
    st.probation ? `${st.probation} on probation` : '',
    st.onNotice ? `${st.onNotice} on notice` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : st.headcount ? 'Everyone on the roll' : 'No one on the roll yet'
}

/** "12 min ago" style relative time. */
export function relTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`
  return `${Math.round(s / 86400)} d ago`
}

/** "09:41" in IST for an instant. */
export const clockIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : ''

/** "28–29 Sep" / "30 Sep – 2 Oct" / "5 Oct" for a date range. */
export function dayRange(from: string, to: string): string {
  const a = dt(from), b = dt(to || from)
  if (from === to || !to) return `${a.getDate()} ${MON[a.getMonth()]}`
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()}–${b.getDate()} ${MON[b.getMonth()]}`
  return `${a.getDate()} ${MON[a.getMonth()]} – ${b.getDate()} ${MON[b.getMonth()]}`
}
export const daysWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
/** "Wed, 23 Sep". */
export const wdShort = (iso: string) => { const d = dt(iso); return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}` }

// ── Sparklines and the weekly chart ──────────────────────────────────────────
/** The last `n` working days (weekly offs left out) up to and including `sel` that the trend covers. */
export function workingWindow(daily: Record<string, DayBuckets>, sel: string, n = 7): string[] {
  const off = offWeekdays(daily), out: string[] = []
  for (let i = 0; i < 60 && out.length < n; i++) {
    const iso = addDays(sel, -i)
    if (!daily[iso]) continue
    if (isWeeklyOff(iso, daily, off)) continue
    out.unshift(iso)
  }
  return out
}

export interface TrendColumn {
  iso: string
  label: string
  title: string
  off: boolean
  regular: number
  late: number
  absent: number
}

/**
 * The seven calendar days ending on `sel` for the stacked weekly chart. A weekly off or a holiday is an "Off"
 * column. "Regular check-ins" are everyone who came in less the late ones (present − late, as Attendance & time).
 */
export function trendColumns(daily: Record<string, DayBuckets>, sel: string, holidays: ReadonlySet<string> = new Set()): TrendColumn[] {
  const off = offWeekdays(daily), cols: TrendColumn[] = []
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(sel, -i), d = dt(iso), b = daily[iso]
    const isOff = holidays.has(iso) || isWeeklyOff(iso, daily, off)
    cols.push({
      iso, label: `${WD[d.getDay()]} ${d.getDate()}`, title: `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`,
      off: isOff && !(b && b.present > 0),
      regular: b ? Math.max(0, b.present - b.late) : 0, late: b ? b.late : 0, absent: b ? b.absent : 0,
    })
  }
  return cols
}

// ── Today's attendance list ──────────────────────────────────────────────────
export type AttFilter = 'all' | 'late' | 'none'
export type PillTone = 'ok' | 'warn' | 'bad' | 'mint' | 'info' | 'gray'
export interface AttRow { id: string; name: string; dept: string; time: string; status: string; tone: PillTone }

/** The person's status for the day, from the server's effective status when it sends one (as attendanceBuckets). */
export function attStatus(s: StaffStatusResponse, over: boolean): { label: string; tone: PillTone; key: 'late' | 'none' | 'other' } {
  const eff = s.effectiveStatus || (!s.checkInAt ? (s.onLeave ? 'ON_LEAVE' : 'NOT_MARKED') : s.status === 'HALF_DAY' ? 'HALF_DAY' : s.status === 'LATE' ? 'LATE' : 'PRESENT')
  switch (eff) {
    case 'LATE': return { label: 'Late', tone: 'warn', key: 'late' }
    case 'HALF_DAY': return { label: 'Half day', tone: 'info', key: 'other' }
    case 'ON_LEAVE': return { label: 'On leave', tone: 'gray', key: 'other' }
    case 'ABSENT': case 'NOT_MARKED': return over ? { label: 'Absent', tone: 'bad', key: 'none' } : { label: 'Not marked', tone: 'gray', key: 'none' }
    case 'PRESENT': return s.attendanceType === 'WFH' ? { label: 'Work from home', tone: 'mint', key: 'other' } : { label: 'Present', tone: 'ok', key: 'other' }
    default: return { label: eff.charAt(0) + eff.slice(1).toLowerCase().replace(/_/g, ' '), tone: 'gray', key: 'other' }
  }
}

/** Up to `limit` people for the filter: latest check-ins first, then the people without a punch. */
export function attRows(list: readonly StaffStatusResponse[], filter: AttFilter, over: boolean, limit = 6): AttRow[] {
  const rows = list
    .map((s) => ({ s, st: attStatus(s, over) }))
    .filter(({ st }) => filter === 'all' || st.key === filter)
    .sort((a, b) => (b.s.checkInAt || '').localeCompare(a.s.checkInAt || '') || a.s.fullName.localeCompare(b.s.fullName))
  return rows.slice(0, limit).map(({ s, st }) => ({
    id: s.employeeId, name: s.fullName, dept: s.departmentName || s.jobTitle || '', time: clockIst(s.checkInAt) || '—', status: st.label, tone: st.tone,
  }))
}

/** The late card's note: the grace time when everyone late shares one, else each shift's own. */
export function lateNote(list: readonly StaffStatusResponse[], late: number): string {
  if (!late) return 'No one late'
  const graces = new Set<string>()
  for (const s of list) {
    if (!s.expectedCheckInAt) continue
    const t = new Date(new Date(s.expectedCheckInAt).getTime() + (s.graceMinutes || 0) * 60000)
    graces.add(clockIst(t.toISOString()))
  }
  return graces.size === 1 ? `After the ${[...graces][0]} grace` : 'After each shift’s grace'
}

// ── Needs your action: attendance follow-ups ────────────────────────────────
export interface AttException { id: string; name: string; kind: string; what: string; when: string }

/** People who need a follow-up on the day: a rejected punch, a punch outside the work area, an early punch-out, or no punch yet (no leave). */
export function attendanceExceptions(list: readonly StaffStatusResponse[], over: boolean): AttException[] {
  const out: AttException[] = []
  for (const s of list) {
    const st = attStatus(s, over)
    const shift = s.shiftName ? `${s.shiftName}` : 'No shift'
    if (s.punchRejected) out.push({ id: s.employeeId, name: s.fullName, kind: 'Punch rejected', what: s.locationName || shift, when: clockIst(s.checkInAt) })
    else if (s.outsideGeofence) out.push({ id: s.employeeId, name: s.fullName, kind: 'Outside work area', what: s.locationName ? `Punched at ${s.locationName}` : 'Punched outside the work area', when: clockIst(s.checkInAt) })
    else if (s.earlyCheckout) out.push({ id: s.employeeId, name: s.fullName, kind: 'Early punch-out', what: s.earlyByMinutes ? `${s.earlyByMinutes} min before the shift ends` : shift, when: clockIst(s.checkOutAt) })
    else if (st.key === 'none') out.push({ id: s.employeeId, name: s.fullName, kind: over ? 'No punch that day' : 'No punch today', what: `Not on leave · ${shift}`, when: clockIst(s.expectedCheckInAt) })
  }
  return out
}

// ── Payroll chart ────────────────────────────────────────────────────────────
export interface RunLike { id: string; periodYear: number; periodMonth: number; status: string; totalGross?: number | string | null }
export interface PayMonth { month: string; label: string; title: string; gross: number; finalized: boolean; path: string }

const FINAL = new Set(['LOCKED', 'PAID'])
/**
 * One bar per month with a run: the finalized (locked or paid) gross when the month has one, else the run in
 * review (draft / processing). Oldest first; the last `count` months up to `upTo` (yyyy-MM) when given.
 */
export function payrollMonths(runs: readonly RunLike[], count: number, upTo?: string): PayMonth[] {
  const by = new Map<string, { fin: number; rev: number; hasFin: boolean; finRun?: string; anyRun: string }>()
  for (const r of runs) {
    if (r.status === 'CANCELLED') continue
    const m = `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}`
    const e = by.get(m) || { fin: 0, rev: 0, hasFin: false, anyRun: r.id }
    const g = Number(r.totalGross || 0)
    if (FINAL.has(r.status)) { e.fin += g; e.hasFin = true; e.finRun = e.finRun || r.id } else e.rev += g
    by.set(m, e)
  }
  const months = [...by.keys()].filter((m) => !upTo || m <= upTo).sort().slice(-count)
  return months.map((m) => {
    const e = by.get(m)!, mi = Number(m.slice(5, 7)) - 1
    const run = e.hasFin ? e.finRun : e.anyRun
    return { month: m, label: MON[mi], title: `${MON[mi]} ${m.slice(0, 4)}`, gross: e.hasFin ? e.fin : e.rev, finalized: e.hasFin, path: run ? `/hrms/payroll/runs/${run}` : `/hrms/payroll/runs?month=${m}` }
  })
}

/** "Apr – Sep 2026" / "Nov 2025 – Apr 2026" for the months shown. */
export function monthSpan(ms: readonly PayMonth[]): string {
  if (!ms.length) return ''
  const a = ms[0], b = ms[ms.length - 1]
  if (a.month === b.month) return b.title
  return `${a.month.slice(0, 4) === b.month.slice(0, 4) ? a.label : a.title} – ${b.title}`
}
export const monthName = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`

// ── Quick actions ────────────────────────────────────────────────────────────
export interface QuickAction { key: string; label: string; path: string }
/** Today's six tiles, in today's order, kept only when allowed. (Customise and "most used first" wait for BW-112.) */
export function quickActions(all: readonly (QuickAction & { allowed: boolean })[]): QuickAction[] {
  return all.filter((q) => q.allowed).slice(0, 6).map(({ key, label, path }) => ({ key, label, path }))
}

/** The month a payroll run's status is in, for the Run payroll hint. */
export function payrollHint(runs: readonly RunLike[], today: string): string {
  const ym = today.slice(0, 7)
  const mine = runs.filter((r) => `${r.periodYear}-${String(r.periodMonth).padStart(2, '0')}` === ym && r.status !== 'CANCELLED')
  const name = MONTHS[Number(ym.slice(5, 7)) - 1]
  if (!mine.length) return `No run for ${name} yet`
  if (mine.some((r) => r.status === 'PAID')) return `${name} is paid`
  if (mine.some((r) => r.status === 'LOCKED')) return `${name} is locked`
  return `${name} is in review`
}

