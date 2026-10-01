// Pure rules behind the self-service Home (EmpHome.dc.html): greeting words,
// the "Your day" line, stat-card figures and sparklines, request and task
// wording, the long-weekend tip and the month calendar's day states. Every
// input is real API data; nothing here invents a value.
import { MON, MONTHS, WD, WDL, addDays, dt } from '@/design/dc/dates'
import type { CalendarDay, CalendarTone } from '@/design/kit/display'
import type { DayRecordResponse } from '../../api/useAttendance'
import type { LeaveBalanceResponse, LeaveRequestResponse, LeaveTypeResponse } from '../../api/useLeave'
import type { WfhRequestResponse } from '../../api/useWfh'
import type { MyPayslip } from '../../api/usePayrollRuns'
import type { AroundItem, MyDay, MyRequest, NeedsYouItem } from './homeApi'

// ── Greeting ────────────────────────────────────────────────────────────────

/** The greeting word for an IST hour, as the admin dashboard words it. */
export const greetingWord = (hourIst: number) => (hourIst < 12 ? 'Good morning' : hourIst < 17 ? 'Good afternoon' : 'Good evening')

/** "4h 46m"; "0h 05m". */
export function hm(minutes: number | null | undefined): string {
  const m = Math.max(0, Math.round(minutes ?? 0))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** "1 thing" / "5 things". */
export const things = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`

// ── Your day ────────────────────────────────────────────────────────────────

/**
 * Minutes worked so far, net of breaks, running on from when the day was read:
 * while checked in, not out and not on a break, the minutes since the read are added.
 */
export function liveActiveMinutes(day: Pick<MyDay, 'activeMinutes' | 'checkedIn' | 'checkedOut' | 'onBreak'>, readAt: number, now: number): number | null {
  if (day.activeMinutes == null) return null
  if (!day.checkedIn || day.checkedOut || day.onBreak) return day.activeMinutes
  return day.activeMinutes + Math.max(0, Math.floor((now - readAt) / 60_000))
}

/** The shift's working time in minutes: its working hours, else its span (an overnight shift wraps). */
export function shiftMinutes(shift: MyDay['shift']): number | null {
  if (!shift) return null
  if (shift.workingHours != null && shift.workingHours > 0) return Math.round(shift.workingHours * 60)
  const a = toMinutes(shift.start), b = toMinutes(shift.end)
  if (a == null || b == null) return null
  return b > a ? b - a : b + 24 * 60 - a
}

export function toMinutes(hhmm: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** "09:24" in IST for an instant (or the HH:mm part of a local time string). */
export function clock(v: string | null | undefined): string {
  if (!v) return ''
  if (!v.includes('T')) return v.slice(0, 5)
  return new Date(v).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

/** "2:10 PM" in IST. */
export function clock12(now: Date): string {
  return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
}

/** How a punch was made, as Daily tracking labels it (AttendanceContainer SOURCE), shortened for one line. */
const METHOD: Record<string, string> = {
  FACE_RECOGNITION: 'Face', FACE: 'Face', GPS: 'Mobile', MOBILE_GPS: 'Mobile', MOBILE: 'Mobile', WEB: 'Web',
  BIOMETRIC: 'Fingerprint', BIOMETRIC_FINGERPRINT: 'Fingerprint', BIOMETRIC_DEVICE: 'Fingerprint', DEVICE: 'Fingerprint', KIOSK: 'Kiosk',
  PIN: 'PIN', MANUAL: 'Added by HR', OVERRIDE: 'Manager', MANAGER_OVERRIDE: 'Manager', GEO_FENCE: 'Mobile', API: 'Device',
}
export const methodLabel = (m: string | null | undefined) => (m ? METHOD[m] ?? m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ') : '')

/** The two halves of the Your day line: what happened (bold) and what's next. Null when there's nothing to say. */
export function dayLine(day: MyDay, now: Date): { lead: string; rest: string } {
  const r = day.record
  const shift = day.shift
  const shiftName = shift?.name ? `${shift.name} shift` : 'Your shift'
  if (day.checkedIn && !day.checkedOut) {
    const where = [methodLabel(r?.checkInMethod), r?.locationName || r?.checkInZoneName].filter(Boolean).join(' · ')
    const lead = `In since ${clock(r?.checkInTime)}${where ? ` · ${where}` : ''}.`
    if (day.onBreak) return { lead, rest: `On a break since ${clock(day.breakStartedAt)}. Your timer is paused.` }
    return { lead, rest: shift?.end ? `${shiftName} ends at ${shift.end}. It’s ${clock12(now)}.` : `It’s ${clock12(now)}.` }
  }
  if (day.checkedOut) {
    return { lead: `Checked out at ${clock(r?.checkOutTime)}.`, rest: 'See you tomorrow.' }
  }
  switch (day.status) {
    case 'WEEKLY_OFF': return { lead: 'It’s your weekly off.', rest: day.statusNote ?? 'Enjoy the day.' }
    case 'HOLIDAY': return { lead: 'It’s a holiday.', rest: day.statusNote ?? '' }
    case 'ON_LEAVE': return { lead: 'You’re on leave today.', rest: day.statusNote ?? '' }
    case 'NOT_TRACKED': return { lead: 'Your attendance isn’t tracked today.', rest: day.statusNote ?? '' }
    default: return { lead: 'You haven’t checked in yet.', rest: shift?.start ? `${shiftName} starts at ${shift.start}.` : '' }
  }
}

// ── Stat cards ──────────────────────────────────────────────────────────────

/** Days of `history` before `upTo` (inclusive), oldest first, that the API reported. */
const daysUpTo = (history: readonly DayRecordResponse[], upTo: string) =>
  [...history].filter((d) => d.date <= upTo).sort((a, b) => a.date.localeCompare(b.date))

const PRESENT = new Set(['PRESENT', 'ON_TIME', 'LATE', 'HALF_DAY'])

/** Cumulative count per reported day, the last `n` points: the stat cards' sparklines. */
export function cumulativeSeries(history: readonly DayRecordResponse[], today: string, test: (d: DayRecordResponse) => boolean, n = 7): number[] {
  let run = 0
  const all = daysUpTo(history, today).map((d) => (run += test(d) ? 1 : 0))
  return all.slice(-n)
}

export const presentSeries = (h: readonly DayRecordResponse[], today: string) => cumulativeSeries(h, today, (d) => PRESENT.has(d.status))
export const lateSeries = (h: readonly DayRecordResponse[], today: string) => cumulativeSeries(h, today, (d) => d.status === 'LATE')

/** "3 and 11 Sep", "3, 11 and 14 Sep", "28 Aug and 3 Sep": the days of the late marks, or null when none. */
export function lateDaysNote(history: readonly DayRecordResponse[], today: string): string | null {
  const days = daysUpTo(history, today).filter((d) => d.status === 'LATE').map((d) => d.date)
  if (!days.length) return null
  const shown = days.slice(-3)
  const sameMonth = shown.every((d) => d.slice(0, 7) === shown[0].slice(0, 7))
  const word = (iso: string, withMonth: boolean) => `${dt(iso).getDate()}${withMonth ? ` ${MON[dt(iso).getMonth()]}` : ''}`
  const parts = shown.map((d, i) => word(d, !sameMonth || i === shown.length - 1))
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/** JS weekdays (Sun = 0) of a person's weekly offs: their own ("6,7" ISO), else the company's, else Sat + Sun. */
export function weeklyOffSet(own: string | null | undefined, company: readonly number[] | null | undefined): Set<number> {
  const ownIso = (own ?? '').split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 7)
  const iso = ownIso.length ? ownIso : company && company.length ? [...company] : [6, 7]
  return new Set(iso.map((d) => d % 7))
}

const WFH_LIVE = new Set(['APPROVED'])

/** Approved work-from-home days in a month (yyyy-MM) up to `upTo`, weekly offs left out, one per calendar day. */
export function wfhDaysInMonth(requests: readonly WfhRequestResponse[], month: string, off: ReadonlySet<number>, upTo?: string): string[] {
  const days = new Set<string>()
  for (const r of requests) {
    if (!WFH_LIVE.has(r.status)) continue
    for (let d = r.fromDate; d <= r.toDate; d = addDays(d, 1)) {
      if (d.slice(0, 7) !== month) continue
      if (upTo && d > upTo) continue
      if (off.has(dt(d).getDay())) continue
      days.add(d)
    }
  }
  return [...days].sort()
}

/** The leave type whose balance leads the Leave left card: casual first, then earned, sick, the rest. */
export function mainBalance(balances: readonly LeaveBalanceResponse[], types: readonly LeaveTypeResponse[] | undefined): LeaveBalanceResponse | null {
  if (!balances.length) return null
  const order = ['CASUAL', 'EARNED', 'PRIVILEGE', 'ANNUAL', 'SICK']
  const cat = new Map((types ?? []).map((t) => [t.id, (t.category ?? '').toUpperCase()]))
  const rank = (b: LeaveBalanceResponse) => {
    const c = cat.get(b.leaveTypeId) || guessCategory(b.leaveTypeName)
    const i = order.findIndex((o) => c.includes(o))
    return i < 0 ? order.length : i
  }
  return [...balances].sort((a, b) => rank(a) - rank(b))[0]
}

const guessCategory = (name: string) => (name ?? '').toUpperCase()

/** "casual · 11 earned days": the main type's word and the next type's days, as the design's note. */
export function leaveNote(main: LeaveBalanceResponse, balances: readonly LeaveBalanceResponse[]): string {
  const word = main.leaveTypeName.replace(/\s*leave$/i, '').toLowerCase()
  const other = balances.find((b) => b.id !== main.id)
  return other ? `${word} · ${num(other.available)} ${other.leaveTypeName.replace(/\s*leave$/i, '').toLowerCase()} days` : word
}

/** 6.5 → "6.5", 6 → "6". */
export const num = (n: number | null | undefined) => (n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''))

/** "of" for a balance: what the person had this year (entitlement plus carried forward). */
export const balanceOf = (b: LeaveBalanceResponse) => b.totalEntitlement + (b.carryForward || 0)

/** The newest locked or paid payslip that isn't after this month (test runs can sit in the future). */
export function latestPayslip(slips: readonly MyPayslip[], today: string): MyPayslip | null {
  const ym = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7))
  return [...slips]
    .filter((p) => (p.status === 'LOCKED' || p.status === 'PAID') && p.periodYear * 12 + p.periodMonth <= ym)
    .sort((a, b) => (b.periodYear * 12 + b.periodMonth) - (a.periodYear * 12 + a.periodMonth))[0] ?? null
}

export const monthName = (m: number) => MONTHS[m - 1] ?? ''

/** "₹4,860"; other currencies by Intl. */
export function money(amount: number | null | undefined, currency?: string | null): string {
  if (amount == null) return ''
  const c = (currency || 'INR').toUpperCase()
  if (c === 'INR') return '₹' + Math.round(amount).toLocaleString('en-IN')
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: c, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${c} ${amount.toLocaleString('en-IN')}`
  }
}

// ── Dates in words ──────────────────────────────────────────────────────────

/** "Wed 23 Sep". */
export const dayShort = (iso: string) => { const d = dt(iso); return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}` }

/** "Mon 28 – Tue 29 Sep", "Wed 23 Sep", "Mon 28 Sep – Fri 2 Oct". */
export function dayRangeLong(from: string | null, to: string | null): string {
  if (!from) return ''
  if (!to || to === from) return dayShort(from)
  const a = dt(from), b = dt(to)
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${WD[a.getDay()]} ${a.getDate()} – ${dayShort(to)}`
  return `${dayShort(from)} – ${dayShort(to)}`
}

/** Today, Tomorrow, Yesterday, a weekday within the week ahead, else "6 Nov". */
export function relDay(iso: string, today: string): string {
  if (iso === today) return 'Today'
  if (iso === addDays(today, 1)) return 'Tomorrow'
  if (iso === addDays(today, -1)) return 'Yesterday'
  if (iso > today && iso <= addDays(today, 6)) return WDL[dt(iso).getDay()]
  const d = dt(iso)
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

/** When something was sent: "today, 1:58 PM", "yesterday", "Mon, 21 Sep". */
export function sentWhen(instant: string | null | undefined, today: string): string {
  if (!instant) return ''
  const day = istDate(instant)
  if (day === today) return `today, ${clock12(new Date(instant))}`
  if (day === addDays(today, -1)) return 'yesterday'
  const d = dt(day)
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`
}

/** The IST calendar day of an instant. */
export function istDate(instant: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(instant))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** "21 Sep". */
export const dayMonth = (iso: string) => { const d = dt(iso); return `${d.getDate()} ${MON[d.getMonth()]}` }

// ── My requests ─────────────────────────────────────────────────────────────

export type PillKind = 'wait' | 'ok' | 'bad' | 'gray'

export function requestPill(r: Pick<MyRequest, 'state'>): PillKind {
  if (r.state === 'WAITING') return 'wait'
  if (r.state === 'APPROVED' || r.state === 'DONE') return 'ok'
  if (r.state === 'REJECTED') return 'bad'
  return 'gray'
}

/** The row's first line: "Casual leave · Mon 28 – Tue 29 Sep", "Client visit travel · ₹4,860". */
export function requestTitle(r: MyRequest): string {
  const tail = r.amount != null ? money(r.amount, r.currency) : r.fromDate ? dayRangeLong(r.fromDate, r.toDate) : ''
  return tail ? `${r.title} · ${tail}` : r.title
}

/** The row's second line: who has it, or who decided, and when. */
export function requestSub(r: MyRequest, today: string): string {
  const when = (i: string | null) => (i ? dayMonth(istDate(i)) : '')
  switch (r.state) {
    case 'WAITING': {
      const who = r.waitingForName ? `Waiting for ${r.waitingForName}` : r.statusLabel || 'Waiting'
      const sent = sentWhen(r.createdAt, today)
      return sent ? `${who} · sent ${sent}` : who
    }
    case 'CANCELLED':
      return r.lastActivityAt ? `Cancelled on ${when(r.lastActivityAt)}` : 'Cancelled'
    default: {
      const by = r.decidedByName ? ` by ${r.decidedByName}` : ''
      const on = r.lastActivityAt ? ` on ${when(r.lastActivityAt)}` : ''
      return `${r.statusLabel}${by}${on}`
    }
  }
}

// ── Needs you ───────────────────────────────────────────────────────────────

/** The due chip: "Overdue", "Due today", "Due Wed" within the week, else "Due 9 Oct". Null without a due date. */
export function dueChip(due: string | null | undefined, today: string): string | null {
  if (!due) return null
  if (due < today) return 'Overdue'
  if (due === today) return 'Due today'
  if (due <= addDays(today, 6)) return `Due ${WD[dt(due).getDay()]}`
  return `Due ${dayMonth(due)}`
}

/** The icon and colour of a Needs-you row (the design's clock/upload/target/… and its four tones). */
export function needsLook(item: Pick<NeedsYouItem, 'kind' | 'tone'>): { icon: string; tone: 'danger' | 'warning' | 'info' | 'brand' } {
  const icon: Record<string, string> = {
    MISSED_PUNCH_OUT: 'clock', DOCUMENT_REDO: 'upload', DOCUMENT_MISSING: 'upload', ONBOARDING_TASK: 'clipboard',
    INTERVIEW_SCORECARD: 'star', SELF_REVIEW: 'target', REVIEWS_TO_WRITE: 'target', POLICY_TO_ACCEPT: 'checkCircle',
    PROBATION_DECISION: 'timer', ASSET_TO_CONFIRM: 'laptop', TIMESHEET_SENT_BACK: 'calendarClock',
  }
  const tone = item.tone === 'bad' ? 'danger' : item.tone === 'gold' ? 'warning' : item.tone === 'blue' ? 'info' : 'brand'
  return { icon: icon[item.kind] ?? 'info', tone }
}

// ── Upcoming events ─────────────────────────────────────────────────────────

/** "Tomorrow · Engineering", "Friday · National holiday", "Posted today · Team lunch…". */
export function eventSub(item: AroundItem, today: string): string {
  const when = item.dateKind === 'POSTED' ? (item.date === today ? 'Posted today' : `Posted ${relDay(item.date, today).toLowerCase() === 'yesterday' ? 'yesterday' : dayMonth(item.date)}`) : relDay(item.date, today)
  return item.detail ? `${when} · ${item.detail}` : when
}

// ── Leave: the long-weekend tip ─────────────────────────────────────────────

export interface LongWeekendTip { holiday: string; holidayName: string; take: string; days: number }

/**
 * A holiday in the next `within` days next to a weekly off, where taking one
 * working day in between makes a break of four days or more ("Fri 2 Oct is a
 * holiday. Take Thu 1 Oct for a 4-day weekend."). Only real holidays and the
 * person's own weekly offs; days already taken off (leave) aren't suggested.
 */
export function longWeekendTip(
  holidays: readonly { date: string; name: string }[], off: ReadonlySet<number>, today: string,
  busy: ReadonlySet<string> = new Set(), within = 30,
): LongWeekendTip | null {
  const hol = new Map(holidays.map((h) => [h.date, h.name]))
  const isOff = (iso: string) => off.has(dt(iso).getDay()) || hol.has(iso)
  const runFrom = (start: string, step: 1 | -1) => { let n = 0; for (let d = start; isOff(d) && n < 14; d = addDays(d, step)) n++; return n }
  for (const h of [...holidays].sort((a, b) => a.date.localeCompare(b.date))) {
    if (h.date <= today || h.date > addDays(today, within)) continue
    if (off.has(dt(h.date).getDay())) continue
    for (const step of [-1, 1] as const) {
      const take = addDays(h.date, step)
      if (take <= today || isOff(take) || busy.has(take)) continue
      // The break: the day taken, then the holiday and every off day after it (or before, the other way).
      const days = 1 + runFrom(h.date, step === -1 ? 1 : -1) + runFrom(addDays(take, step), step)
      if (days >= 4) return { holiday: h.date, holidayName: h.name, take, days }
    }
  }
  return null
}

/** Days a person is on approved or waiting leave (busy for the tip). */
export function leaveDays(leaves: readonly LeaveRequestResponse[]): Set<string> {
  const out = new Set<string>()
  for (const l of leaves) {
    if (!['APPROVED', 'PENDING', 'PENDING_L2'].includes(l.status)) continue
    for (let d = l.startDate; d <= l.endDate; d = addDays(d, 1)) out.add(d)
  }
  return out
}

// ── The month calendar ──────────────────────────────────────────────────────

/**
 * The days of a month on Home's mini calendar: present, late, home, holiday, leave,
 * weekly off and "to fix" (a missed punch-out with no fix sent), from the attendance
 * history plus the person's own approved WFH and leave.
 */
export function calendarDays(args: {
  month: string; today: string; history: readonly DayRecordResponse[]; wfhDays: readonly string[];
  leaves: readonly LeaveRequestResponse[]; toFix: ReadonlySet<string>; holidays: readonly { date: string; name: string }[]; off: ReadonlySet<number>
}): CalendarDay[] {
  const { month, today, history, wfhDays, leaves, toFix, holidays, off } = args
  const byDate = new Map(history.map((d) => [d.date, d]))
  const home = new Set(wfhDays)
  const hol = new Map(holidays.map((h) => [h.date, h.name]))
  const onLeave = new Map<string, string>()
  for (const l of leaves) {
    if (!['APPROVED', 'PENDING', 'PENDING_L2'].includes(l.status)) continue
    for (let d = l.startDate; d <= l.endDate; d = addDays(d, 1)) if (d.slice(0, 7) === month) onLeave.set(d, l.status === 'APPROVED' ? 'Leave' : 'Leave (waiting)')
  }
  const out: CalendarDay[] = []
  const first = `${month}-01`
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) {
    const rec = byDate.get(d)
    let tone: CalendarTone | undefined
    let tip = ''
    if (toFix.has(d)) { tone = 'fix'; tip = 'No punch-out: fix this day' }
    else if (rec && (rec.status === 'PRESENT' || rec.status === 'ON_TIME' || rec.status === 'HALF_DAY')) { tone = home.has(d) ? 'home' : rec.status === 'HALF_DAY' ? 'half' : 'present' }
    else if (rec && rec.status === 'LATE') tone = 'late'
    else if (hol.has(d) || rec?.status === 'HOLIDAY') { tone = 'holiday'; tip = hol.get(d) ?? 'Holiday' }
    else if (onLeave.has(d) || rec?.status === 'ON_LEAVE') { tone = 'leave'; tip = onLeave.get(d) ?? 'Leave' }
    else if (rec?.status === 'ABSENT') tone = 'absent'
    else if (home.has(d) && d >= today) { tone = 'home'; tip = 'Work from home' }
    else if (off.has(dt(d).getDay()) || rec?.status === 'WEEKEND') tone = 'off'
    if (rec && (rec.checkInTime || rec.checkOutTime)) {
      tip = [tip, `${clock(rec.checkInTime) || '—'} – ${clock(rec.checkOutTime) || '—'}`].filter(Boolean).join(' · ')
    }
    out.push({ date: d, tone, tip: tip || undefined })
  }
  return out
}

/** "17 of 18 working days · 1 day to fix". */
export function calendarSub(presentDays: number | null | undefined, workingSoFar: number | null | undefined, toFix: number): string {
  const parts: string[] = []
  if (presentDays != null && workingSoFar != null) parts.push(`${presentDays} of ${workingSoFar} working ${workingSoFar === 1 ? 'day' : 'days'}`)
  if (toFix > 0) parts.push(`${toFix} ${toFix === 1 ? 'day' : 'days'} to fix`)
  return parts.join(' · ')
}

/** The IST month of a day: "2026-09". */
export const monthOf = (iso: string) => iso.slice(0, 7)

/** "September". */
export const monthWord = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1]
