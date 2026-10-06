// My team (/team): the pure rules behind Team today, Team schedule and Approvals. Every value comes
// from the API; these only decide how it is grouped and worded. Dates are IST business days
// (yyyy-MM-dd); instants are formatted in Asia/Kolkata.
import * as D from '@/shared/components/calendar/dateMath'
import type {
  ApprovalKind, InboxRow, InboxTab, RecentDecision, TeamMember, TeamSummary, TeamTimeOffEntry,
} from '../api/shared/contracts'
import type { StaffStatusResponse } from '../api/useAttendance'
import type { CycleProgress } from '../api/usePerformanceAdmin'

// ── Views ───────────────────────────────────────────────────────────────────

export type TeamView = 'today' | 'schedule' | 'approvals'
export const TEAM_VIEWS: readonly { key: TeamView; label: string }[] = [
  { key: 'today', label: 'Team today' },
  { key: 'schedule', label: 'Team schedule' },
  { key: 'approvals', label: 'Approvals' },
]
export const INBOX_TAB_LABEL: Record<InboxTab, string> = {
  all: 'All', leave: 'Leave', attendance: 'Attendance', requests: 'Requests', expenses: 'Expenses',
}
export const INBOX_TABS: readonly InboxTab[] = ['all', 'leave', 'attendance', 'requests', 'expenses']

/** The view in the URL, or the first one the person may open. */
export function pickView(asked: string | null, allowed: readonly TeamView[]): TeamView {
  return (allowed as readonly string[]).includes(asked ?? '') ? (asked as TeamView) : allowed[0] ?? 'today'
}

/** The inbox tabs a person may open, from the same permissions the inbox reads (InboxAccess.tabs). */
export function inboxTabsFor(p: { leave: boolean; wfh: boolean; fixes: boolean; expenses: boolean; timesheets: boolean }): InboxTab[] {
  const out: InboxTab[] = []
  if (p.leave) out.push('leave')
  if (p.fixes) out.push('attendance')
  if (p.wfh || p.fixes || p.timesheets) out.push('requests')
  if (p.expenses) out.push('expenses')
  return out.length ? ['all', ...out] : []
}

/** The inbox tab in the URL, when the person may open it; else All. */
export function pickTab(asked: string | null, allowed: readonly InboxTab[] | undefined): InboxTab {
  const list = allowed ?? []
  return (list as readonly string[]).includes(asked ?? '') ? (asked as InboxTab) : 'all'
}

// ── Dates and amounts ───────────────────────────────────────────────────────

/** "Friday, 25 September". */
export function dayLong(iso: string): string {
  const d = D.parseDay(iso)
  return `${D.WDL[d.getDay()]}, ${d.getDate()} ${D.MONTHS[d.getMonth()]}`
}

/** "Mon 28 Sep". */
export function dayShort(iso: string): string {
  const d = D.parseDay(iso)
  return `${D.WD[d.getDay()]} ${d.getDate()} ${D.MON[d.getMonth()]}`
}

/** "Mon 5 Oct" (a day), "Mon 28 – Tue 29 Sep" (same month), "Wed 30 Sep – Fri 2 Oct", with years when they differ. */
export function rangeShort(from: string | null | undefined, to: string | null | undefined): string {
  if (!from) return ''
  if (!to || to === from) return dayShort(from)
  const a = D.parseDay(from), b = D.parseDay(to)
  if (a.getFullYear() !== b.getFullYear()) return `${dayShort(from)} ${a.getFullYear()} – ${dayShort(to)} ${b.getFullYear()}`
  if (a.getMonth() === b.getMonth()) return `${D.WD[a.getDay()]} ${a.getDate()} – ${dayShort(to)}`
  return `${dayShort(from)} – ${dayShort(to)}`
}

/** "1 day", "0.5 days", "2 days". */
export function daysText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  const r = Math.round(n * 100) / 100
  return `${r} ${r === 1 ? 'day' : 'days'}`
}

/** "09:24" in IST. */
export function clockIst(at: string | null | undefined): string {
  if (!at) return ''
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

/** "just now", "12 min ago", "3 hr ago", "2 days ago". */
export function relTime(at: string | null | undefined, now = Date.now()): string {
  if (!at) return ''
  const t = new Date(at).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  const d = Math.floor(s / 86400)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

/** "₹4,860" (Indian grouping), or the amount with its currency code when the code is unknown. */
export function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null || !Number.isFinite(Number(amount))) return ''
  const code = (currency || 'INR').toUpperCase()
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(Number(amount))
  } catch {
    return `${code} ${Number(amount).toLocaleString('en-IN')}`
  }
}

/** The first word of a name ("Priya Sharma" → "Priya"), for "Priya has been told". */
export const firstName = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || 'They'

// ── Team today: who is where ────────────────────────────────────────────────

/** The roster row (GET /v1/attendance/dashboard) with the BW-13 facts the API adds. */
export type RosterRow = StaffStatusResponse & {
  branchName?: string | null
  checkInMethod?: string | null
  leaveTypeName?: string | null
  leaveFrom?: string | null
  leaveTo?: string | null
  pendingLeave?: boolean
}

/** One bucket per person (the dayBuckets rule): in the office, late, at home, half day, on leave, not in yet, or off. */
export type Bucket = 'in' | 'late' | 'wfh' | 'half' | 'leave' | 'none' | 'off'

export function rosterBucket(s: RosterRow): Bucket {
  const eff = s.effectiveStatus
  if (eff) {
    if (eff === 'PRESENT') return s.attendanceType === 'WFH' ? 'wfh' : 'in'
    if (eff === 'LATE') return 'late'
    if (eff === 'HALF_DAY') return 'half'
    if (eff === 'ON_LEAVE') return 'leave'
    if (eff === 'ABSENT' || eff === 'NOT_MARKED') return 'none'
    return 'off' // holiday, weekly off, not tracked
  }
  if (!s.checkInAt) return s.onLeave ? 'leave' : 'none'
  if (s.status === 'HALF_DAY') return 'half'
  if (s.status === 'LATE') return 'late'
  if (s.attendanceType === 'WFH') return 'wfh'
  return 'in'
}

/** "Face", "Mobile", "Web"…: how a punch was made (the same words the inbox uses). */
export function methodLabel(method: string | null | undefined): string {
  if (!method) return ''
  switch (method) {
    case 'FACE_RECOGNITION': return 'Face'
    case 'MOBILE_GPS': case 'GPS': case 'GEO_FENCE': return 'Mobile'
    case 'WEB': return 'Web'
    case 'MANUAL': case 'MANAGER_OVERRIDE': return 'Manual'
    case 'BIOMETRIC_FINGERPRINT': case 'BIOMETRIC_DEVICE': return 'Biometric'
    case 'KIOSK': return 'Kiosk'
    case 'PIN': return 'PIN'
    default: return method.charAt(0) + method.slice(1).toLowerCase().replace(/_/g, ' ')
  }
}

export interface TeamTile { key: Bucket; label: string; icon: string; tone: 'brand' | 'gold' | 'red' | 'gray'; count: number; note: string }

/** The five filter tiles (plus Half day when someone is on one), from the roster. */
export function teamTiles(rows: readonly RosterRow[]): TeamTile[] {
  const by = (b: Bucket) => rows.filter((r) => rosterBucket(r) === b)
  const inRows = by('in'), lateRows = by('late'), half = by('half')
  const methods = [...new Set(inRows.map((r) => methodLabel(r.checkInMethod).toLowerCase()).filter(Boolean))]
  const inNote = methods.length
    ? `${methods.join(' or ').replace(/^./, (c) => c.toUpperCase())} punch`
    : 'On time today'
  const graces = [...new Set((lateRows.length ? lateRows : rows).map((r) => r.graceMinutes).filter((g): g is number => typeof g === 'number' && g > 0))]
  const lateNote = graces.length === 1 ? `After the ${graces[0]} min grace` : 'After their grace period'
  const tiles: TeamTile[] = [
    { key: 'in', label: 'In the office', icon: 'userCheck', tone: 'brand', count: inRows.length, note: inNote },
    { key: 'late', label: 'Late', icon: 'timer', tone: 'gold', count: lateRows.length, note: lateNote },
    { key: 'wfh', label: 'At home', icon: 'home', tone: 'brand', count: by('wfh').length, note: 'Approved work from home' },
    { key: 'leave', label: 'On leave', icon: 'calendar', tone: 'gray', count: by('leave').length, note: 'Approved leave today' },
    { key: 'none', label: 'Not in yet', icon: 'circleX', tone: 'red', count: by('none').length, note: 'Tap to see who' },
  ]
  // The design has no Half day tile; without one, people on a half day would be in no tile.
  if (half.length) tiles.splice(4, 0, { key: 'half', label: 'Half day', icon: 'sunset', tone: 'gold', count: half.length, note: 'A half day today' })
  return tiles
}

/** Team summary members who aren't on today's roster (the attendance roster leaves out people off today). */
export function offTodayMembers(members: readonly TeamMember[] | undefined, roster: readonly RosterRow[]): TeamMember[] {
  const seen = new Set(roster.map((r) => r.employeeId))
  return (members ?? []).filter((m) => !seen.has(m.employeeId) && (m.offToday === 'WEEKLY_OFF' || m.offToday === 'HOLIDAY'))
}

/** The line under a person's name: job title, "joined 1 Sep" in their first 30 days, "probation". */
export function roleLine(jobTitle: string | null | undefined, member: TeamMember | undefined, today: string): string {
  const parts: string[] = []
  if (jobTitle) parts.push(jobTitle)
  const joined = member?.dateOfJoining
  if (joined && joined <= today && D.spanDays(joined, today) <= 30) {
    const d = D.parseDay(joined)
    parts.push(`joined ${d.getDate()} ${D.MON[d.getMonth()]}`)
  }
  if (member?.employmentStatus === 'PROBATION') parts.push('probation')
  return parts.join(' · ')
}

/** The middle column: "In at 09:24 · Face · BLR-HQ", "Sick leave · today", "No punch yet". */
export function rosterWhen(s: RosterRow, bucket: Bucket, today: string): string {
  if (bucket === 'leave') {
    const type = s.leaveTypeName || 'Leave'
    return `${type} · ${s.leaveTo && s.leaveTo > today ? `until ${dayShort(s.leaveTo)}` : 'today'}`
  }
  if (bucket === 'none') return s.pendingLeave ? 'No punch yet · leave request waiting' : 'No punch yet'
  if (bucket === 'off') {
    const e = s.effectiveStatus
    return e === 'HOLIDAY' ? 'Holiday' : e === 'WEEKLY_OFF' ? 'Weekly off' : e === 'NOT_TRACKED' ? 'Attendance not tracked' : 'Off today'
  }
  const parts = [`In at ${clockIst(s.checkInAt)}`]
  const m = methodLabel(s.checkInMethod)
  if (m) parts.push(m)
  if (s.locationName) parts.push(s.locationName)
  else if (bucket === 'wfh') parts.push('home')
  if (s.outsideGeofence) parts.push('outside the zone')
  return parts.join(' · ')
}

/** "Friday, 25 September · Engineering · 8 people report to you". */
export function teamSub(summary: TeamSummary | undefined, today: string): string {
  const parts = [dayLong(today)]
  if (!summary) return parts[0]
  const n = summary.members.length
  const people = `${n} ${n === 1 ? 'person' : 'people'}`
  if (summary.scope === 'DEPARTMENT') {
    if (summary.departmentNames.length) parts.push(summary.departmentNames.join(', '))
    parts.push(`${people} in your team`)
  } else if (summary.scope === 'COMPANY') {
    parts.push(`${people} in the company`)
  } else {
    parts.push(`${people} ${n === 1 ? 'reports' : 'report'} to you`)
  }
  return parts.join(' · ')
}

// ── Out soon ────────────────────────────────────────────────────────────────

export interface OutSoonItem { key: string; name: string; when: string; status: string; waiting: boolean }

/** Leave in the next two weeks, approved or waiting, soonest first (work from home isn't "out"). */
export function outSoon(entries: readonly TeamTimeOffEntry[] | undefined, today: string, limit = 5): OutSoonItem[] {
  return (entries ?? [])
    .filter((e) => e.kind === 'LEAVE' && e.toDate >= today)
    .sort((a, b) => a.fromDate.localeCompare(b.fromDate) || a.employeeName.localeCompare(b.employeeName))
    .slice(0, limit)
    .map((e) => {
      const ongoing = e.fromDate <= today
      const when = ongoing ? (e.toDate === today ? 'Today' : `Until ${dayShort(e.toDate)}`) : rangeShort(e.fromDate, e.toDate)
      const waiting = e.status !== 'APPROVED'
      return {
        key: `${e.kind}-${e.requestId}`,
        name: e.employeeName,
        when,
        status: waiting ? (e.canDecide ? 'Waiting for you' : 'Waiting for approval') : (e.leaveTypeName || 'Leave'),
        waiting,
      }
    })
}

// ── Probation ───────────────────────────────────────────────────────────────

/** "Probation ends Mon, 5 Oct · in 10 days", "… ends today", "Probation ended Fri, 25 Sep · 3 days ago". */
export function probationWhen(end: string, daysLeft: number): string {
  const d = D.parseDay(end)
  const day = `${D.WD[d.getDay()]}, ${d.getDate()} ${D.MON[d.getMonth()]}`
  if (daysLeft < 0) return `Probation ended ${day} · ${-daysLeft} ${daysLeft === -1 ? 'day' : 'days'} ago`
  if (daysLeft === 0) return `Probation ends ${day} · today`
  return `Probation ends ${day} · in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`
}

/** "Extend by a month": the same day a month after the current end (the API wants a later day). */
export function extendedEnd(end: string): string {
  return D.addMonths(end, 1)
}

// ── Approvals ───────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<ApprovalKind, string> = {
  LEAVE: 'Leave', WFH: 'Work from home', CORRECTION: 'Attendance fix', SHIFT_CHANGE: 'Shift change', EXPENSE: 'Expense', TIMESHEET: 'Timesheet',
  LEAVE_L2: 'Leave · HR approval', ADVANCE: 'Salary advance', OVERTIME: 'Overtime', OVERTIME_REQUEST: 'Overtime request', SKILL: 'Skill level',
}

/** Which tab a kind is counted under (BW-09). */
export function tabOfKind(kind: ApprovalKind): Exclude<InboxTab, 'all'> {
  switch (kind) {
    case 'LEAVE': case 'LEAVE_L2': return 'leave'
    case 'CORRECTION': case 'OVERTIME': case 'OVERTIME_REQUEST': return 'attendance'
    case 'EXPENSE': return 'expenses'
    default: return 'requests'
  }
}

/** The request in a line: "Casual leave · Mon 28 – Tue 29 Sep · 2 days". */
export function inboxWhat(r: InboxRow): string {
  switch (r.kind) {
    case 'LEAVE': case 'LEAVE_L2': return [r.title, rangeShort(r.fromDate, r.toDate), daysText(r.days)].filter(Boolean).join(' · ')
    case 'WFH': return ['Work from home', rangeShort(r.fromDate, r.toDate), daysText(r.days)].filter(Boolean).join(' · ')
    case 'CORRECTION': return [r.title, r.fromDate ? dayShort(r.fromDate) : ''].filter(Boolean).join(' · ')
    case 'SHIFT_CHANGE': return `${r.title} · ${r.fromDate ? `From ${dayShort(r.fromDate)}` : 'from the day it’s approved'}`
    case 'EXPENSE': case 'ADVANCE': return [r.title, money(r.amount, r.currency)].filter(Boolean).join(' · ')
    case 'OVERTIME': case 'OVERTIME_REQUEST':
      return [r.title, r.fromDate ? dayShort(r.fromDate) : '', r.facts.find((f) => f.key === 'extra')?.value ?? ''].filter(Boolean).join(' · ')
    case 'TIMESHEET': return [r.title || 'Timesheet', rangeShort(r.fromDate, r.toDate)].filter(Boolean).join(' · ')
    default: return r.title
  }
}

/** Rows "Approve N with no warnings" takes: the ones the person may decide that carry no warning. */
export function easyRows(rows: readonly InboxRow[]): InboxRow[] {
  return rows.filter((r) => r.canDecide && r.warnings.length === 0)
}

/** "7 requests are waiting from your team. 2 need a closer look." */
export function approvalsSub(waiting: number, warned: number, tab: InboxTab): string {
  if (waiting <= 0) return 'You’re all caught up.'
  const where = tab === 'all' ? 'from your team' : `in ${INBOX_TAB_LABEL[tab].toLowerCase()}`
  const head = `${waiting} ${waiting === 1 ? 'request is' : 'requests are'} waiting ${where}.`
  if (warned <= 0) return `${head} None have warnings.`
  return `${head} ${warned} ${warned === 1 ? 'needs' : 'need'} a closer look.`
}

/** The decided line's wording: "Approved" / "Rejected". */
export const decisionWord = (d: RecentDecision['decision']) => (d === 'APPROVED' ? 'Approved' : 'Rejected')

/** Recent decisions the tab shows (the kinds it covers). */
export function decisionsInTab(list: readonly RecentDecision[] | undefined, tab: InboxTab, now = Date.now()): RecentDecision[] {
  return (list ?? []).filter((d) => (tab === 'all' || tabOfKind(d.kind) === tab) && Date.parse(d.undoUntil) > now)
}

// ── Team schedule ───────────────────────────────────────────────────────────

/** One person and day from GET /v1/team/schedule (with the BW-22 day facts). */
export interface ScheduleDay {
  employeeId: string
  employeeName: string
  date: string
  shiftName?: string | null
  startTime?: string | null
  endTime?: string | null
  shiftPolicyId?: string | null
  since?: string | null
  joinedOn?: string | null
  onLeave?: { leaveTypeName?: string | null; duration?: string | null; halfDay?: boolean } | null
  weeklyOff?: boolean
  holidayName?: string | null
}

export type ScheduleTone = 'shift' | 'alt' | 'home' | 'leave' | 'pending' | 'holiday' | 'off' | 'none'
export interface ScheduleCell {
  tone: ScheduleTone
  title: string
  sub?: string
  /** A request waiting: where Approvals shows it, when the person may decide it. */
  pending?: { kind: 'LEAVE' | 'WFH'; requestId: string; canDecide: boolean }
}

const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

/** The client's default shift ("General"); every other shift is an "other shift" (the design's two colours). */
export const isGeneralShift = (name: string | null | undefined) => /^general$/i.test((name ?? '').trim())

/** What a day shows for a person: holiday, approved leave, weekly off, a request waiting, home, the shift, or nothing yet. */
export function scheduleCell(day: ScheduleDay | undefined, entries: readonly TeamTimeOffEntry[], date: string): ScheduleCell {
  const covering = entries.filter((e) => e.fromDate <= date && e.toDate >= date)
  if (day?.holidayName) return { tone: 'holiday', title: day.holidayName }
  const approvedLeave = covering.find((e) => e.kind === 'LEAVE' && e.status === 'APPROVED')
  if (day?.onLeave || approvedLeave) {
    const type = day?.onLeave?.leaveTypeName || approvedLeave?.leaveTypeName || 'Leave'
    const half = day?.onLeave?.halfDay || (approvedLeave?.duration ?? '').startsWith('HALF_DAY')
    return { tone: 'leave', title: type, sub: half ? 'Half day · approved' : 'Approved' }
  }
  if (day?.weeklyOff) return { tone: 'off', title: 'Off' }
  const waiting = covering.find((e) => e.status !== 'APPROVED' && e.kind === 'LEAVE') ?? covering.find((e) => e.status !== 'APPROVED')
  if (waiting) {
    return {
      tone: 'pending',
      title: waiting.kind === 'LEAVE' ? 'Leave?' : 'Home?',
      sub: waiting.canDecide ? 'Waiting for you' : 'Waiting',
      pending: { kind: waiting.kind, requestId: waiting.requestId, canDecide: waiting.canDecide },
    }
  }
  if (covering.some((e) => e.kind === 'WFH' && e.status === 'APPROVED')) return { tone: 'home', title: 'Home', sub: 'Approved' }
  if (day?.shiftName) {
    const times = day.startTime ? `${hhmm(day.startTime)} – ${hhmm(day.endTime)}` : undefined
    return { tone: isGeneralShift(day.shiftName) ? 'shift' : 'alt', title: day.shiftName, sub: times }
  }
  if (day?.joinedOn && day.joinedOn > date) return { tone: 'none', title: 'Not joined yet' }
  return { tone: 'none', title: 'No shift yet' }
}

export interface SchedulePerson { employeeId: string; name: string; days: Map<string, ScheduleDay> }

/** The schedule's people in the API's order (by name), each with their days. */
export function schedulePeople(rows: readonly ScheduleDay[] | undefined): SchedulePerson[] {
  const out = new Map<string, SchedulePerson>()
  for (const r of rows ?? []) {
    let p = out.get(r.employeeId)
    if (!p) { p = { employeeId: r.employeeId, name: r.employeeName, days: new Map() }; out.set(r.employeeId, p) }
    p.days.set(String(r.date).slice(0, 10), r)
  }
  return [...out.values()]
}

// ── Reviews ─────────────────────────────────────────────────────────────────

export interface ReviewLine { id: string; name: string; text: string; ready: boolean }
export interface ReviewsCardModel { selfIn: number; selfTotal: number; ready: number; rows: ReviewLine[] }

/**
 * Where each person in the cycle stands (team-scoped progress): their self-review, then their
 * manager's review. People whose self-review is in and whose manager review isn't come first.
 */
export function reviewsModel(progress: CycleProgress | undefined, limit = 5): ReviewsCardModel {
  const people = progress?.reviewees ?? []
  let selfIn = 0, selfTotal = 0, ready = 0
  const rows = people.map((p) => {
    const self = p.assignments.find((a) => a.reviewerType === 'SELF')
    const mgr = p.assignments.find((a) => a.reviewerType === 'MANAGER')
    const selfDone = self?.status === 'COMPLETED'
    const mgrDone = mgr?.status === 'COMPLETED'
    if (self) selfTotal++
    if (selfDone) selfIn++
    const isReady = selfDone && !!mgr && !mgrDone
    if (isReady) ready++
    const text = mgrDone ? 'Manager review in'
      : isReady ? 'Self-review in · manager review to write'
        : selfDone ? 'Self-review in'
          : self ? 'Self-review not in yet' : 'Review started'
    return { id: p.revieweeId, name: p.revieweeName || p.revieweeCode || 'Someone in your team', text, ready: isReady }
  })
  rows.sort((a, b) => Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name))
  return { selfIn, selfTotal, ready, rows: rows.slice(0, limit) }
}
