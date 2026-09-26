// Real-data container for the redesigned Attendance & Time module
// (design/dc/AttendancePage) — /hrms/att-analytics, /hrms/attendance and
// /hrms/shifts. Every tab gets its own loading / error state. Where the API has
// no value for something the design shows, the design gets a dash instead of a
// made-up number (see docs/Designs/STATIC-UI-TO-BUILD.md §4).
import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { AttendancePage } from '@/design/dc/AttendancePage'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import { istToday, addDays, fmtShort, fmtWd, isoOf, MON, MONTHS } from '@/design/dc/dates'
import { toneFor, span, overnight, fmt as fmtTime } from '@/design/dc/shift-util'
import { useCompanies } from '../api/useOrg'
import {
  useTeamDashboard, useAttendanceTrend, useAttendanceSources, useMonthlyStats, useAttendanceHistory,
  useMyCorrections, useCorrectionApprovals, useCreateCorrection, useDecideCorrection,
  type StaffStatusResponse, type CorrectionRequestResponse,
} from '../api/useAttendance'
import { dayBuckets, trendBuckets, offWeekdays, isWeeklyOff, type DayBuckets } from './attendanceBuckets'
import {
  useReviewExceptions, useFaceReviewEvents, useChangeDayStatus, useDecideFacePunch, uploadCorrectionProof, correctionProofLink,
  statusLabel, type ReviewException, type FaceReviewEvent,
} from '../api/useAttendanceReview'
import { ReviewList } from './ReviewList'
import { StatusChangeDrawer, type StatusTarget } from './StatusChangeDrawer'
import { useShiftPolicies, useCreateShiftPolicy, useUpdateShiftPolicy, useDeleteShiftPolicy, type ShiftPolicy } from '../api/useShiftPolicies'
import { usePendingShiftRequests, useDecidedShiftRequests, useDecideShiftRequest, type ShiftRequest } from '../api/useShiftRequests'
import { useHolidays } from '../api/useSettings'
import { useAttendanceSummaryReport, useLateMarksReport } from '../api/useReports'

type St = 'live' | 'loading' | 'empty' | 'error'
interface Q { isLoading: boolean; isError: boolean }
/** Tab state from a query: not allowed → empty; then loading / error / empty / live. */
const stateOf = (q: Q, allowed: boolean, empty = false): St => (!allowed ? 'empty' : q.isLoading ? 'loading' : q.isError ? 'error' : empty ? 'empty' : 'live')
const errText = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
/** "9:22 AM" in IST, or a dash. */
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '')
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
const worked = (a?: string | null, b?: string | null) => (a && b ? hm(Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000))) : '—')
/** yyyy-MM-dd from a date the API sends as a string or as epoch millis. */
const isoDay = (v: unknown) => (typeof v === 'number' ? isoOf(new Date(v)) : String(v ?? '').slice(0, 10))
const fileName = (url: string) => { try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'Attachment' } catch { return 'Attachment' } }

/** How a punch arrived — capture method → the design's label and icon. */
const SOURCE: Record<string, [string, string]> = {
  FACE_RECOGNITION: ['Face check-in', 'scanFace'], FACE: ['Face check-in', 'scanFace'], GPS: ['Mobile app (GPS)', 'smartphone'], MOBILE: ['Mobile app', 'smartphone'],
  WEB: ['Web check-in', 'globe'], BIOMETRIC: ['Fingerprint device', 'fingerprint'], DEVICE: ['Fingerprint device', 'fingerprint'], PIN: ['PIN', 'hash'],
  MANUAL: ['Added by HR', 'pencil'], OVERRIDE: ['Manager override', 'shield'], MANAGER_OVERRIDE: ['Manager override', 'shield'],
}
const sourceOf = (m: string): [string, string] => SOURCE[m] || [m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' '), 'clock']
/** The face API gives a match band, never a score — bar length per band. Only High clears the 85% marker: Medium and Low need a person to check (V143.10). */
const BAND: Record<string, [number, string]> = { HIGH: [96, 'High'], MEDIUM: [80, 'Medium'], LOW: [70, 'Low'], REJECTED: [30, 'Rejected'], UNKNOWN: [0, 'Unknown'] }
/** Last path segment of a proof link ("r2://…/gate-log.pdf" or a web link). */
const proofName = (url: string) => { try { return decodeURIComponent(url.replace(/[?#].*$/, '').split('/').pop() || '') || 'Proof' } catch { return 'Proof' } }

interface MeResponse { id: string }
interface CurrentShift { shiftPolicyId?: string | null; effectiveFrom?: string | null }
interface Overtime {
  id: string; employeeId: string; employeeName: string; date: string | number; minutes: number; status: string; note?: string | null
  // V143.25: the shift in force that day, when they left, and why.
  shiftName?: string | null; shiftEnd?: string | null; checkOutAt?: string | number | null
  reason?: string | null; reasonSource?: 'EMPLOYEE' | 'FIX_REQUEST' | 'MANUAL_ENTRY' | null
}
/** Where an overtime reason came from, as the card's "Raised" line says it. */
const OT_RAISED: Record<string, string> = { EMPLOYEE: 'reason from the employee', FIX_REQUEST: 'times from an approved fix request', MANUAL_ENTRY: 'times entered by HR' }
interface ScheduleRow { employeeId: string; employeeName: string; shiftName?: string | null; shiftPolicyId?: string | null; since?: string | null; joinedOn?: string | null }

/** Every overtime row in the range — the API pages 20 at a time. */
async function loadOvertime(from: string, to: string) {
  const all: Overtime[] = []
  for (let page = 0; page < 50; page++) {
    const r = await apiJson<{ content: Overtime[]; totalElements: number }>(`/v1/attendance/overtime?from=${from}&to=${to}&page=${page}`)
    all.push(...r.content)
    if (r.content.length < 20 || all.length >= r.totalElements) break
  }
  return all
}
export function AttendanceContainer() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const mobile = useIsMobile()
  const qc = useQueryClient()
  const today = istToday()
  const section = location.pathname.startsWith('/hrms/att-analytics') ? 'analytics' : location.pathname.startsWith('/hrms/shifts') ? 'shifts' : 'daily'
  const tab = params.get('tab') || ''
  const date = params.get('date') || today
  const monthStart = today.slice(0, 8) + '01'
  const prevMonthStart = addDays(monthStart, -1).slice(0, 8) + '01'
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))]

  // ── permissions (the ones each endpoint checks) ──
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canApprove = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE) // corrections, shift requests, manual entry
  const canFace = usePermission(P.ATTENDANCE_FACE_ADMIN_READ)
  const canOt = usePermission('attendance.overtime.approve')
  const canShiftAdmin = usePermission('attendance.workforce.admin') // shift policies + assigning shifts
  const canReport = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const canSelf = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  const canReview = usePermission('attendance.status.review') // the review list (V143.10)
  const canOverride = usePermission('attendance.status.override') // change a day, decide face punches
  const isHr = canTeam
  const canFaceList = canFace || canReview
  const weekAgo = addDays(today, -6)
  const [target, setTarget] = useState<StatusTarget | null>(null)

  // ── data ──
  const { data: companies = [] } = useCompanies()
  const companyId: string = companies[0]?.id ?? ''
  // A past day's logs list the team as it was then (people who have left since
  // still show on the days they worked), matching the admin dashboard's counts.
  const team = useTeamDashboard(date, undefined, canTeam, date < today)
  const teamToday = useTeamDashboard(today, undefined, canTeam)
  const trend = useAttendanceTrend(monthStart, today, undefined, canTeam && section === 'analytics')
  const sources = useAttendanceSources(today, undefined, canTeam && section === 'analytics')
  const holidays = useHolidays(companyId, y)
  const summary = useAttendanceSummaryReport(canReport ? companyId || null : null, monthStart, today, { enabled: section === 'analytics' })
  const lateMarks = useLateMarksReport(canReport && section === 'analytics' ? companyId || null : null, monthStart, today)
  // Face punches with names and HR decisions: today's, plus older ones still to check.
  const face = useFaceReviewEvents(weekAgo, today, canFaceList && section === 'daily')
  const review = useReviewExceptions(weekAgo, today, canReview && section === 'daily')
  const approvals = useCorrectionApprovals('PENDING', { enabled: canApprove, size: 100 })
  const approved = useCorrectionApprovals('APPROVED', { enabled: canApprove && section === 'daily', size: 5 })
  const rejected = useCorrectionApprovals('REJECTED', { enabled: canApprove && section === 'daily', size: 5 })
  const myCorr = useMyCorrections()
  const monthStats = useMonthlyStats(y, m, { enabled: canSelf && (section === 'daily' || !isHr) })
  const history = useAttendanceHistory(y, m, { enabled: canSelf && section === 'daily' })
  const policies = useShiftPolicies(companyId)
  const schedule = useQuery({
    queryKey: ['team', 'schedule', today, today],
    queryFn: () => apiJson<ScheduleRow[]>(`/v1/team/schedule?from=${today}&to=${today}`),
    enabled: canTeam && section === 'shifts',
  })
  const me = useQuery({ queryKey: ['employees', 'me'], queryFn: () => apiJson<MeResponse>('/v1/employees/me'), enabled: canSelf && (section === 'shifts' || !isHr), staleTime: 300_000 })
  const myShift = useQuery({
    queryKey: ['shifts', 'employee', me.data?.id],
    queryFn: () => apiJson<CurrentShift>(`/v1/shifts/employee/${me.data!.id}`),
    enabled: !!me.data?.id,
  })
  const overtime = useQuery({ queryKey: ['attendance', 'overtime', 'design', prevMonthStart, today], queryFn: () => loadOvertime(prevMonthStart, today), enabled: canTeam })
  const sreq = usePendingShiftRequests({ enabled: canApprove })
  const sreqDone = useDecidedShiftRequests(30, { enabled: canApprove && section === 'shifts' })
  const myReq = useQuery({ queryKey: ['shifts', 'change-requests', 'my'], queryFn: () => apiJson<ShiftRequest[]>('/v1/shifts/change-requests/my'), enabled: canSelf && section === 'shifts' })

  // ── mutations ──
  const createCorr = useCreateCorrection()
  const decideCorr = useDecideCorrection()
  const createPolicy = useCreateShiftPolicy()
  const updatePolicy = useUpdateShiftPolicy()
  const deletePolicy = useDeleteShiftPolicy()
  const decideSreq = useDecideShiftRequest()
  const changeStatus = useChangeDayStatus()
  const decideFace = useDecideFacePunch()
  const assign = useMutation({
    mutationFn: ({ emp, sid, from, note }: { emp: string; sid: string; from: string; note?: string }) =>
      apiJson(`/v1/shifts/employee/${emp}`, { method: 'POST', body: JSON.stringify({ shiftPolicyId: sid, effectiveFrom: from, ...(note ? { note } : {}) }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['team', 'schedule'] }); qc.invalidateQueries({ queryKey: ['shifts'] }); qc.invalidateQueries({ queryKey: ['hrms', 'attendance'] }) },
  })
  const decideOt = useMutation({
    mutationFn: ({ id, action, note }: { id: string; action: 'approve' | 'reject'; note: string }) =>
      apiJson(`/v1/attendance/overtime/${id}/${action}`, { method: 'POST', body: JSON.stringify({ note }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance', 'overtime'] }),
  })
  const newSreq = useMutation({
    mutationFn: (b: { requestedShiftPolicyId: string; effectiveDate: string; reason: string }) =>
      apiJson('/v1/shifts/change-requests', { method: 'POST', body: JSON.stringify(b) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shifts'] }),
  })

  // ── view data ──
  const data = useMemo(() => {
    const people = new Map<string, { code: string; name: string; dept: string }>()
    for (const s of teamToday.data?.staffStatuses ?? []) people.set(s.employeeId, { code: s.employeeCode, name: s.fullName, dept: s.departmentName || '—' })
    const who = (id: string, fallback?: string) => people.get(id) || { code: '—', name: fallback || 'Employee', dept: '—' }
    const idByCode = new Map<string, string>()
    for (const s of teamToday.data?.staffStatuses ?? []) idByCode.set(s.employeeCode, s.employeeId)

    // Today's numbers — one bucket per person (see attendanceBuckets.ts).
    const todayCounts = teamToday.data ? dayBuckets(teamToday.data, today) : {}

    // Daily Logs rows for the chosen day. The shift reads "General · 9:00 AM–5:00 PM".
    const policyByName = new Map((policies.data ?? []).map((sp) => [sp.name, sp]))
    const shiftLabel = (s: StaffStatusResponse) => {
      if (!s.shiftName) return 'No shift yet'
      const sp = policyByName.get(s.shiftName)
      return sp ? `${s.shiftName} · ${fmtTime(hhmm(sp.startTime))}–${fmtTime(hhmm(sp.endTime))}` : `${s.shiftName}${s.expectedCheckInAt ? ' · ' + clock(s.expectedCheckInAt) : ''}`
    }
    const rowOf = (s: StaffStatusResponse) => {
      // The effective status (company attendance policy + reviewers' changes) when the server sends it.
      const eff = s.effectiveStatus
      const status = eff
        ? (eff === 'PRESENT' && s.attendanceType === 'WFH' ? 'WFH' : eff)
        : !s.checkInAt ? (s.onLeave ? 'ON_LEAVE' : 'NOT_MARKED') : s.status === 'HALF_DAY' ? 'HALF_DAY' : s.status === 'LATE' ? 'LATE' : s.attendanceType === 'WFH' ? 'WFH' : 'PRESENT'
      return {
        effective: eff || null, note: s.statusNote || null, manual: !!s.statusManual,
        id: s.employeeId, code: s.employeeCode, name: s.fullName, dept: s.departmentName || '—',
        shift: shiftLabel(s), status,
        in: clock(s.checkInAt), exp: clock(s.expectedCheckInAt), late: s.lateByMinutes || 0, out: clock(s.checkOutAt), worked: worked(s.checkInAt, s.checkOutAt), earlyOut: !!s.earlyCheckout,
        src: s.punchRejected ? 'Face punch rejected by HR' : s.checkInAt ? (s.locationName || 'Checked in') + (s.outsideGeofence ? ' · outside the zone' : '') : s.onLeave ? 'On approved leave' : 'No punch yet',
      }
    }
    const staff = team.data?.staffStatuses ?? []
    const logs = { today, date, rows: staff.map(rowOf), departments: [...new Set(staff.map((s) => s.departmentName).filter(Boolean))].sort() as string[], total: staff.length }

    // Analytics: this month to date (past days from the trend API, today from the live roster).
    const daily: Record<string, DayBuckets> = {}
    for (const r of trend.data ?? []) daily[r.date] = trendBuckets(r, today)
    // Today's numbers come from the live roster; whether today is a weekly off comes from the trend.
    if (teamToday.data) daily[today] = { ...dayBuckets(teamToday.data, today), ...(typeof daily[today]?.weeklyOff === 'boolean' ? { weeklyOff: daily[today].weeklyOff } : {}) }
    const hol = (holidays.data ?? []).filter((h) => h.active !== false).map((h) => ({ date: h.holidayDate, name: h.holidayName }))
    const holSet = new Set(hol.map((h) => h.date))
    // Weekly offs are the company's and each person's own (the trend flags a day nobody was scheduled), not just Sundays.
    const offDays = offWeekdays(daily)
    let workingDays = 0
    for (let d = monthStart; d <= today; d = addDays(d, 1)) if (!isWeeklyOff(d, daily, offDays) && !holSet.has(d)) workingDays++
    const lateBy = new Map<string, { id: string; code: string; name: string; dept: string; n: number }>()
    for (const r of lateMarks.data ?? []) {
      const cur = lateBy.get(r.employee_code) || { id: idByCode.get(r.employee_code) || '', code: r.employee_code, name: r.employee_name, dept: r.department || '—', n: 0 }
      cur.n++
      lateBy.set(r.employee_code, cur)
    }
    const graces = [...new Set((policies.data ?? []).map((sp) => sp.gracePeriodMinutes ?? 0))]
    const reportLink = `/hrms/reports/attendance-summary?${new URLSearchParams({ ...(companyId ? { company: companyId } : {}), from: monthStart, to: today })}`
    const ov = {
      today, counts: todayCounts, graceMin: graces.length === 1 ? graces[0] : null, daily, offWeekdays: offDays, holidays: hol, workingDays, reportLink,
      sources: (sources.data?.sources ?? []).filter((s) => s.count > 0).map((s) => ({ label: sourceOf(s.method)[0], icon: sourceOf(s.method)[1], n: s.count })),
      lateMarks: [...lateBy.values()].sort((a, b) => b.n - a.n).slice(0, 5),
      summary: (summary.data ?? []).map((r) => ({
        id: idByCode.get(r.employee_code) || '', code: r.employee_code, name: r.employee_name, dept: r.department || '—', present: r.present_days, late: r.late_days,
        avg: r.avg_hours ? hm(Math.round(r.avg_hours * 60)) : '—', ot: r.total_overtime_mins,
      })),
    }

    // Face punches: today's, and older ones still waiting for a check. Names come with the events.
    const faceRows = (face.data ?? [])
      .filter((e) => e.date === today || e.status === 'REVIEW')
      .map((e: FaceReviewEvent) => {
        const b = BAND[e.scoreBucket || 'UNKNOWN'] || BAND.UNKNOWN, isToday = e.date === today
        return {
          id: e.id, empId: e.employeeId, code: e.employeeCode || '—', name: e.employeeName || 'Unknown person', dept: e.departmentName || '—', date: e.date, today: isToday,
          // The phone or kiosk the check was made on; older events recorded none.
          device: e.device || 'Not recorded', time: isToday ? clock(e.createdAt) : `${fmtShort(e.date)}, ${clock(e.createdAt)}`, conf: b[0], band: b[1],
          status: e.status, raw: e,
        }
      })

    // Regularization.
    const corrRow = (r: CorrectionRequestResponse) => {
      const p = who(r.employeeId, r.employeeName)
      return {
        id: r.id, empId: r.employeeId, name: r.employeeName || p.name, emp: r.employeeCode || p.code, dept: r.departmentName || p.dept,
        date: fmtShort(r.requestedDate), in: clock(r.requestedCheckInAt), out: clock(r.requestedCheckOutAt), reason: r.reason,
        attachment: r.attachmentUrl && /^https?:\/\//i.test(r.attachmentUrl) ? fileName(r.attachmentUrl) : r.attachmentUrl && r.attachmentUrl.startsWith('r2://') ? proofName(r.attachmentUrl) : null, attachmentUrl: r.attachmentUrl,
        status: r.status, raised: `${fmtShort(istToday(new Date(r.createdAt)))}, ${clock(r.createdAt)}`, note: r.approverComment,
      }
    }
    const corr = [...(approvals.data?.content ?? []), ...(approved.data?.content ?? []), ...(rejected.data?.content ?? [])].map(corrRow)
    const mineCorr = (myCorr.data?.content ?? []).map((r) => ({ id: r.id, date: fmtShort(r.requestedDate), in: clock(r.requestedCheckInAt), out: clock(r.requestedCheckOutAt), reason: r.reason, status: r.status }))

    // My Attendance — one colour code per day of this month.
    const days: Record<number, string> = {}
    for (const d of history.data ?? []) {
      const st = d.status
      // /attendance/history: PRESENT · LATE · HOLIDAY · ON_LEAVE · ABSENT · WEEKEND (the person's week-offs);
      // future days and days before joining are left out.
      days[Number(d.date.slice(8, 10))] = st === 'LATE' ? 'L' : st === 'HOLIDAY' ? 'H' : st === 'ON_LEAVE' ? 'V' : st === 'WEEKEND' ? 'O'
        : st === 'ABSENT' ? 'A' : d.checkInTime ? 'P' : 'A'
    }
    const ms = monthStats.data
    const month = {
      label: `${MONTHS[m - 1]} ${y}`, year: y, month: m, todayDay: Number(today.slice(8, 10)), days,
      stats: ms ? { present: ms.presentDays, absent: ms.absentDays, late: ms.lateDays, ontime: ms.onTimeDays, holidays: ms.holidays, score: Math.round(ms.attendanceScore) } : {},
    }

    // Shifts. The API stores no colour: the tone comes from the start time, and night shifts are the moon.
    const shiftList = (policies.data ?? []).map((sp: ShiftPolicy) => {
      const start = hhmm(sp.startTime), end = hhmm(sp.endTime), hours = sp.workingHoursPerDay
      return {
        id: sp.id, name: sp.name, start, end, grace: sp.gracePeriodMinutes ?? 0,
        breakMin: hours ? Math.max(0, span(start, end) - Math.round(hours * 60)) : 0, tone: toneFor(start, sp.shiftType === 'NIGHT'), raw: sp,
      }
    })
    const idByName = new Map(shiftList.map((s) => [s.name, s.id]))
    const roster = (schedule.data ?? []).map((r) => {
      const p = who(r.employeeId, r.employeeName)
      // Matched by id (two shifts may share a name); older servers only send the name.
      const shift = r.shiftPolicyId || (r.shiftName ? idByName.get(r.shiftName) || null : null)
      // Since: the day the current assignment started; with no shift yet, the joining date.
      const since = shift && r.since ? fmtShort(r.since) : !shift && r.joinedOn ? `Joined ${fmtShort(r.joinedOn)}` : '—'
      return { id: r.employeeId, code: p.code, name: r.employeeName || p.name, dept: p.dept, shift, since }
    })

    // Overtime: everything still waiting (this month and last), plus this month's decided rows.
    const otAll = overtime.data ?? []
    const thisMonth = (o: Overtime) => isoDay(o.date) >= monthStart
    const otRows = otAll.filter((o) => o.status === 'PENDING' || thisMonth(o)).map((o) => {
      const p = who(o.employeeId, o.employeeName), iso = isoDay(o.date)
      // Shift end = the shift in force that day; left at = the check-out; reason = the employee's, else the fix or manual entry's.
      const shiftEnd = o.shiftEnd ? fmtTime(o.shiftEnd) : '—', out = o.checkOutAt ? clock(typeof o.checkOutAt === 'number' ? new Date(o.checkOutAt).toISOString() : o.checkOutAt) : '—'
      const raised = `${fmtShort(iso)} · ${(o.reasonSource && OT_RAISED[o.reasonSource]) || 'recorded automatically'}`
      return { id: o.id, emp: p.code, name: o.employeeName || p.name, dept: p.dept, date: fmtWd(iso), shift: o.shiftName || '', shiftEnd, out, minutes: o.minutes, reason: o.reason || 'None given', raised, status: o.status, note: o.note || '' }
    })
    const otBy = new Map<string, { emp: string; name: string; dept: string; days: number; minutes: number }>()
    for (const o of otAll) {
      if (o.status === 'REJECTED' || !thisMonth(o)) continue
      const p = who(o.employeeId, o.employeeName), cur = otBy.get(o.employeeId) || { emp: p.code, name: o.employeeName || p.name, dept: p.dept, days: 0, minutes: 0 }
      cur.days++
      cur.minutes += o.minutes
      otBy.set(o.employeeId, cur)
    }

    // Shift change requests.
    // Waiting (pending), plus what was decided in the last 30 days: who decided, when, and their note.
    const decidedLine = (r: ShiftRequest) => {
      const when = r.decidedAt ? fmtShort(istToday(new Date(r.decidedAt))) : ''
      const head = r.approverName ? `${r.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${r.approverName}${when ? ', ' + when : ''}` : `Closed automatically${when ? ', ' + when : ''}`
      return r.decisionNote ? `${head} · ${r.decisionNote}` : head
    }
    const pendingIds = new Set((sreq.data ?? []).map((r) => r.id))
    const sreqRows = [...(sreq.data ?? []), ...(sreqDone.data ?? []).filter((r) => !pendingIds.has(r.id))].map((r) => {
      const p = who(r.employeeId)
      const startIso = r.status === 'PENDING' ? r.requestedEffectiveDate : r.appliedEffectiveDate || r.requestedEffectiveDate
      return {
        id: r.id, emp: p.code, name: p.name, dept: p.dept, from: r.currentShiftPolicyId || '', fromName: r.currentShiftName || 'No shift yet', to: r.requestedShiftPolicyId, toName: r.requestedShiftName,
        starts: startIso ? fmtShort(startIso) : 'the day it’s approved', submitted: fmtShort(istToday(new Date(r.createdAt))),
        reason: r.reason || '', status: r.status, note: r.status === 'PENDING' ? r.decisionNote || '' : decidedLine(r),
      }
    })
    const myReqRows = (myReq.data ?? []).map((r) => ({
      id: r.id, from: r.currentShiftPolicyId || '', fromName: r.currentShiftName || 'No shift yet', to: r.requestedShiftPolicyId, toName: r.requestedShiftName,
      starts: fmtShort(r.appliedEffectiveDate || r.requestedEffectiveDate || istToday(new Date(r.createdAt))), submitted: fmtShort(istToday(new Date(r.createdAt))),
      reason: r.reason || '', status: r.status, note: r.decisionNote || '',
    }))

    // Review list (V143.10): day exceptions; face punches to check come from the face list.
    const reviewItems: ReviewException[] = review.data ?? []
    const reviewFaces: FaceReviewEvent[] = (face.data ?? []).filter((e) => e.status === 'REVIEW')

    return {
      reviewItems, reviewFaces, reviewCount: reviewItems.length,
      today, todayLabel: fmtWd(today), counts: todayCounts, logs, ov, face: faceRows, corr, mineCorr, month, reportLink,
      shifts: shiftList, roster, ot: otRows, otSummary: [...otBy.values()], otRange: `1–${Number(today.slice(8, 10))} ${MON[m - 1]}`,
      sreq: sreqRows, myReq: myReqRows, myShift: myShift.data?.shiftPolicyId || null, mySince: myShift.data?.effectiveFrom ? fmtShort(myShift.data.effectiveFrom) : '',
    }
  }, [team.data, teamToday.data, trend.data, sources.data, holidays.data, summary.data, lateMarks.data, face.data, review.data,
    approvals.data, approved.data, rejected.data, myCorr.data, monthStats.data, history.data, policies.data, schedule.data, myShift.data,
    overtime.data, sreq.data, sreqDone.data, myReq.data, companyId, monthStart, today, date, y, m])

  const states: Record<string, St> = {
    logs: stateOf(team, canTeam),
    ov: stateOf(teamToday, canTeam),
    face: stateOf(face, canFaceList, !data.face.length),
    review: stateOf(review, canReview),
    corr: stateOf(canApprove ? approvals : myCorr, true),
    month: stateOf(monthStats, canSelf),
    shifts: stateOf(policies, !!companyId, !data.shifts.length),
    roster: stateOf(schedule, canTeam),
    ot: stateOf(overtime, canTeam),
    sreq: stateOf(sreq, canApprove),
    myReq: stateOf(myReq, canSelf),
  }

  const done = (msg: string) => { toast.success(msg); return true }
  // A failed decision may mean the item changed meanwhile (expired, already reviewed) — reload that list.
  const failed = (title: string, reload?: () => unknown) => (e: unknown) => { toast.error(title, { description: errText(e) }); reload?.(); return false }
  const actions = {
    onDate: (iso: string) => {
      const next = new URLSearchParams(params)
      next.set('tab', 'team')
      if (iso && iso !== today) next.set('date', iso); else next.delete('date')
      navigate(`/hrms/attendance?${next}`, { replace: true })
    },
    retryLogs: () => team.refetch(),
    retryOv: () => { teamToday.refetch(); trend.refetch(); sources.refetch(); summary.refetch(); lateMarks.refetch() },
    retryFace: () => face.refetch(),
    retryCorr: () => { approvals.refetch(); myCorr.refetch() },
    retryMonth: () => { monthStats.refetch(); history.refetch() },
    retryShifts: () => policies.refetch(),
    retryRoster: () => schedule.refetch(),
    retryOt: () => overtime.refetch(),
    retrySreq: () => { sreq.refetch(); sreqDone.refetch() },
    retryMyReq: () => myReq.refetch(),
    decideCorr: (id: string, d: string, note: string) =>
      decideCorr.mutateAsync({ id, status: d === 'APPROVED' ? 'APPROVED' : 'REJECTED', comment: note?.trim() || undefined })
        .then(() => done(d === 'APPROVED' ? 'Fix approved — attendance updated' : 'Fix rejected — attendance stays as it was'), failed('Could not record the decision', approvals.refetch)),
    newCorr: (q: { date: string; in: string; out: string; reason: string; attachmentUrl?: string }) =>
      // Times are IST, as the page labels them, whatever the browser's timezone.
      createCorr.mutateAsync({ requestedDate: q.date, requestedCheckInAt: new Date(`${q.date}T${q.in}:00+05:30`).toISOString(), requestedCheckOutAt: new Date(`${q.date}T${q.out}:00+05:30`).toISOString(), reason: q.reason, ...(q.attachmentUrl ? { attachmentUrl: q.attachmentUrl } : {}) })
        .then(() => done(q.attachmentUrl ? 'Fix request sent with your proof' : 'Fix request sent'), failed('Could not send the request')),
    uploadProof: (file: File) => uploadCorrectionProof(file),
    // The window opens on the click (so it isn't blocked), then goes to the short-lived signed link.
    openProof: (r: { id: string; attachmentUrl?: string | null }) => {
      const w = window.open('', '_blank')
      if (w) w.opener = null
      correctionProofLink(r.id).then((l) => { if (w) w.location.href = l.url; else window.open(l.url, '_blank', 'noopener') })
        .catch((e) => { w?.close(); toast.error('Couldn’t open the proof', { description: errText(e) }) })
    },
    // "Yes, it's …" records the check; "Not them" asks why, then rejects the punch.
    reviewFace: (id: string, yes: boolean) => {
      const e = (face.data ?? []).find((x) => x.id === id)
      if (!e) return
      if (!canOverride) { toast.error('You can’t check face punches', { description: 'Ask an admin for the “Change a day’s attendance status” permission.' }); return }
      if (yes) {
        decideFace.mutateAsync({ id, decision: 'CONFIRMED' })
          .then(() => done(`Checked — the punch stays as ${e.employeeName.split(' ')[0]}’s`), failed('Could not record the check', face.refetch))
        return
      }
      setTarget({ kind: 'face-reject', employeeId: e.employeeId, name: e.employeeName, sub: `${e.employeeCode}${e.departmentName ? ' · ' + e.departmentName : ''}`, date: e.date, faceEventId: e.id, punchOut: e.purpose === 'PUNCH_OUT',
        facts: [{ k: 'Time', v: `${clock(e.createdAt)} IST` }, { k: 'Match', v: (BAND[e.scoreBucket || 'UNKNOWN'] || BAND.UNKNOWN)[1] }] })
    },
    // Daily Logs drawer → "Change status".
    openStatus: (row: { id: string; name: string; code: string; dept: string; status: string; effective?: string | null; note?: string | null; manual?: boolean; in: string; out: string }, iso: string) =>
      setTarget({ kind: 'status', employeeId: row.id, name: row.name, sub: `${row.code} · ${row.dept}`, date: iso || today, status: row.effective || (row.status === 'WFH' ? 'PRESENT' : row.status),
        note: row.note, manual: row.manual, facts: [{ k: 'Came in', v: row.in }, { k: 'Left', v: row.out }] }),
    saveShift: (s: { id: string | null; name: string; start: string; end: string; grace: number; breakMin: number; tone: string }) => {
      if (!companyId) return false
      const prev = s.id ? data.shifts.find((x) => x.id === s.id) : undefined
      const prevType = prev?.raw.shiftType
      // Flexible / rotational shifts keep their type; otherwise night (or past midnight) is NIGHT, the rest FIXED.
      const shiftType: ShiftPolicy['shiftType'] = prevType === 'FLEXIBLE' || prevType === 'ROTATIONAL' ? prevType : s.tone === 'moon' || overnight(s.start, s.end) ? 'NIGHT' : 'FIXED'
      const sameHours = !!prev && prev.start === s.start && prev.end === s.end && prev.breakMin === s.breakMin
      const hours = sameHours ? prev!.raw.workingHoursPerDay ?? undefined : Math.min(24, Math.max(0.5, Math.round(((span(s.start, s.end) - s.breakMin) / 60) * 100) / 100))
      const body = { name: s.name, shiftType, startTime: `${s.start}:00`, endTime: `${s.end}:00`, gracePeriodMinutes: Math.max(0, Math.min(120, Math.round(s.grace) || 0)), ...(hours != null ? { workingHoursPerDay: hours } : {}) }
      const req = s.id ? updatePolicy.mutateAsync({ id: s.id, companyId, data: body }) : createPolicy.mutateAsync({ companyId, data: body })
      return req.then(() => done(s.id ? `${s.name} shift updated` : `${s.name} shift added`), failed('Could not save the shift'))
    },
    deleteShift: (id: string) => {
      const s = data.shifts.find((x) => x.id === id)
      if (!companyId) return false
      return deletePolicy.mutateAsync({ id, companyId }).then(() => done(`${s ? s.name : 'Shift'} deleted`), failed('Could not delete the shift'))
    },
    assign: (emp: string, sid: string, from: string, note?: string) => {
      const e = data.roster.find((r) => r.id === emp), s = data.shifts.find((x) => x.id === sid)
      return assign.mutateAsync({ emp, sid, from, note: note?.trim() || undefined }).then(() => done(`${e ? e.name : 'Employee'} moves to ${s ? s.name : 'the new shift'} from ${fmtShort(from)}`), failed('Could not change the shift'))
    },
    decideOt: (id: string, d: string, note: string) => {
      const text = note?.trim() || ''
      // The API needs a reason to reject overtime.
      if (d !== 'APPROVED' && !text) { toast.error('Add a note saying why before rejecting'); return false }
      return decideOt.mutateAsync({ id, action: d === 'APPROVED' ? 'approve' : 'reject', note: text })
        .then(() => done(d === 'APPROVED' ? 'Overtime approved · recorded, not paid' : 'Overtime rejected'), failed('Could not record the decision', overtime.refetch))
    },
    decideSreq: (id: string, d: string, note: string) => {
      const r = data.sreq.find((x) => x.id === id)
      return decideSreq.mutateAsync({ id, approved: d === 'APPROVED', comment: note?.trim() || undefined })
        .then(() => done(d === 'APPROVED' ? `${r ? r.name : 'Employee'} moves to ${r?.toName || 'the new shift'}` : 'Shift change rejected'), failed('Could not record the decision', sreq.refetch))
    },
    newSreq: (q: { to: string; date: string; reason: string }) =>
      newSreq.mutateAsync({ requestedShiftPolicyId: q.to, effectiveDate: q.date, reason: q.reason }).then(() => done('Request sent to HR'), failed('Could not send the request')),
  }

  // Saves the drawer: a day's new status, or a face punch rejection.
  const submitTarget = (t: StatusTarget, status: string, reason: string) => {
    if (t.kind === 'face-reject' && t.faceEventId) {
      return decideFace.mutateAsync({ id: t.faceEventId, decision: 'REJECTED', note: reason })
        .then((r) => done(`Punch rejected — ${t.name.split(' ')[0]}’s ${fmtShort(t.date)} now counts as ${statusLabel(r.day?.status).toLowerCase()}`), failed('Could not reject the punch', face.refetch))
    }
    return changeStatus.mutateAsync({ employeeId: t.employeeId, date: t.date, status, reason })
      .then((d) => done(status === 'EXCUSE' ? `Excused — ${t.name.split(' ')[0]}’s ${fmtShort(t.date)} counts as present` : `${t.name.split(' ')[0]}’s ${fmtShort(t.date)} is now ${statusLabel(d.status).toLowerCase()}`),
        failed('Could not change the status', review.refetch))
  }
  const reviewBlock = (
    <ReviewList
      state={review.isLoading || face.isLoading ? 'loading' : review.isError ? 'error' : 'live'}
      errorText={review.isError ? errText(review.error) : undefined}
      items={data.reviewItems} faces={data.reviewFaces} canOverride={canOverride}
      onRetry={() => { review.refetch(); face.refetch() }}
      onFace={(f, yes) => actions.reviewFace(f.id, yes)}
      onExcuse={(i) => setTarget({ kind: 'status', employeeId: i.employeeId, name: i.employeeName, sub: `${i.employeeCode}${i.departmentName ? ' · ' + i.departmentName : ''}`, date: i.date, status: i.status, note: i.note, preset: 'EXCUSE',
        facts: [{ k: 'Came in', v: clock(i.checkIn) }, { k: 'Left', v: clock(i.checkOut) }] })}
      onChange={(i) => setTarget({ kind: 'status', employeeId: i.employeeId, name: i.employeeName, sub: `${i.employeeCode}${i.departmentName ? ' · ' + i.departmentName : ''}`, date: i.date, status: i.status, note: i.note,
        facts: [{ k: 'Came in', v: clock(i.checkIn) }, { k: 'Left', v: clock(i.checkOut) }] })}
    />
  )

  return (
    <DesignFrame>
      {/* The design pulls the page up so its section bar sits right under the header. */}
      <div style={{ marginTop: -24 }}>
        <AttendancePage
          section={section}
          initialTab={tab}
          initialStatus={params.get('status') || ''}
          date={date}
          viewAs={isHr ? 'admin' : 'employee'}
          mobile={mobile}
          data={{ ...data, reviewBlock }}
          states={states}
          actions={actions}
          canApproveCorr={canApprove}
          canRequestFix={canApprove}
          canManual={canApprove}
          canEditShifts={canShiftAdmin}
          canAssign={canShiftAdmin}
          canDecideOt={canOt}
          canReview={canReview}
          canOverride={canOverride}
          onNavigate={(path: string) => navigate(path)}
          onTab={(route: string, next: string) => navigate(`${route}?tab=${next}`, { replace: route === location.pathname })}
        />
      </div>
      {target && <StatusChangeDrawer target={target} onClose={() => setTarget(null)} onSubmit={submitTarget} />}
    </DesignFrame>
  )
}
