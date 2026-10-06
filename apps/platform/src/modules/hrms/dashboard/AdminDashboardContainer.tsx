// The admin dashboard at /dashboard (prototype PgDashboard.dc.html), hand-built on the redesign kit.
// Every number comes from an existing endpoint; each card has its own loading / empty / error state and shows
// only with the permission its endpoint checks, so no request is refused.
//
// The date (?date= in the URL) drives every card: a past day asks each endpoint for that day (`date=`, the
// history view: headcount from joining / exit dates and status history, the day's attendance with the people
// employed then, the requests pending then, the payroll months up to it…). Today's view sends the same requests
// as before. Seats have no history: they say "As of today".
//
// Release 1 is frontend only on today's backend. Design pieces that need a new endpoint are left out until it
// exists (never faked): "most used first" quick actions (BW-112; Customise is in QuickActionsSection), the Total employees sparkline and "joined
// this month" today (BW-113), the performers' average (BW-114), onboarding department and joining date (BW-115),
// hiring "this quarter" and conversion (BW-116 / BW-66), project owner / due / health (BW-117), notice event
// date (BW-118), approval Undo (BW-06) and Remind (BW-10).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { greetingName } from '@/shared/hooks/greetingName'
import { canOpen } from '@/shared/navigation/access'
import { PAGE_REGISTRY, MENU_RULES } from '@/shared/navigation/pageRegistry'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { useToast } from '@/design/kit/overlays'
import { istToday, istHour, addDays, fmtShort } from '@/design/dc/dates'
import { HOLIDAYS_PATH } from '@/design/dc/milestoneRange'
import { useCompanies } from '../api/useOrg'
import { useTeamDashboard, useAttendanceTrend, type TeamDashboardResponse, type DailyAttendanceCounts } from '../api/useAttendance'
import { dayBuckets, trendBuckets, type DayBuckets } from '../attendance/attendanceBuckets'
import { useHeadcountReport, fetchHeadcountWorkbook } from '../api/useReports'
import { useActivityFeed, activityActor, ACTIVITY_FEED_EXCLUDE, type AuditPageResponse } from '../api/useActivity'
import { useSeatsUsage } from '../api/useSeats'
import { useHolidays } from '../api/useSettings'
import { useUpcomingProbations, type UpcomingProbation } from '../api/useProbation'
import { useRuns } from '../api/usePayrollRuns'
import { useEmployeeDirectory } from '../api/useWorkforce'
import { headcountFileName, headcountSheets } from './headcountWorkbook'
import { saveAndRecord, xlsxBlob } from '@/shared/export/fileExport'
import { endOfIstDay, monthToDate, parseDashboardDate } from './dashboardDate'
import { useInboxCounts } from './NeedsAction'
import { AdminDashboard, type DashboardVm } from '@/design/dc/AdminDashboard'
import {
  lateNote, monthSpan, payrollHint, payrollMonths, pctOf, presentNote, quickActions, relTime, rollNote, rollTotal, scheduledOf, trendColumns, workingWindow,
  type DashSection, type RollStats,
} from './dashboardModel'
import { useMyDay } from '../attendance/webpunch/useMyDay'
import { WebPunchDialog } from '../attendance/webpunch/WebPunchDialog'

/** The people figures (RollStats) come with hrms.employee.read; the month's joiners / leavers on a past day only. */
interface Stats extends RollStats { openRoles?: number; complianceScore?: number | null; complianceDue?: number; complianceCompleted?: number; monthlyPayroll?: number | null; month: string }
interface Alert { type: string; count: number; label: string; path: string }
interface Notice { id: string; title: string; body: string; expiresOn?: string; createdAt: string }
interface Project { id: string; name: string; status: string; total: number; completed: number }

const STAGE_LABEL: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected', WITHDRAWN: 'Withdrawn' }
/** A stage code the map doesn't know yet still reads as words ("ON_HOLD" → "On hold"), never as the raw code. */
const stageLabel = (code: string) => STAGE_LABEL[code] || code.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
const humanise = (t: string) => t.replace(/[._-]+/g, ' ').trim().toLowerCase()
/** "CREATE" → "created", so the feed reads "Asha created report schedule …". */
const VERB: Record<string, string> = { create: 'created', update: 'updated', delete: 'deleted', approve: 'approved', reject: 'rejected', export: 'exported', submit: 'submitted', cancel: 'cancelled', login: 'signed in', logout: 'signed out' }
const verb = (a: string) => VERB[humanise(a)] || humanise(a)
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const NOTICES_PER_PAGE = 5
const ZERO: DayBuckets = { total: 0, present: 0, regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, notMarked: 0, absent: 0, earlyOut: 0, other: 0 }

export function AdminDashboardContainer() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirmDialog()
  const toast = useToast()
  const today = istToday()
  // The date is kept in the URL (?date=yyyy-MM-dd): a refresh or Back keeps it.
  // Only past days are kept; today, a later day or a bad value is today's view.
  const [params, setParams] = useSearchParams()
  const rawDate = params.get('date')
  const parsed = parseDashboardDate(rawDate, today)
  const date = parsed.date
  const setDate = (iso: string | null) => setParams((prev) => {
    const next = new URLSearchParams(prev)
    if (iso && iso < today) next.set('date', iso)
    else next.delete('date')
    return next
  }, { replace: true })
  const futureNoted = useRef(false)
  useEffect(() => {
    if (!rawDate || date) return
    // A later day (or not a date) can't be shown: say so once and drop it from the URL.
    if (parsed.future && !futureNoted.current) {
      futureNoted.current = true
      toast.info('Showing today', { detail: 'The dashboard can show today or an earlier date, not a date after today.' })
    }
    setDate(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawDate, date, parsed.future])
  const sel = date || today
  const isPast = !!date
  /** `&date=` for the endpoints that take a past day; nothing for today's view (the same request as before). */
  const dq = isPast ? `&date=${sel}` : ''
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [noticePage, setNoticePage] = useState(0)
  const [punch, setPunch] = useState<'in' | 'out' | null>(null)

  // ── permissions ────────────────────────────────────────────────────────────
  const ctx = useAccessContext()
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canReadCompany = usePermission(P.ORG_COMPANY_READ)
  const canWriteCompany = usePermission(P.ORG_COMPANY_WRITE)
  const canReadHiring = usePermission(P.HRMS_HIRING_READ)
  const canReadPerformance = usePermission('hrms.performance.read' as any)
  const canReadOnboarding = usePermission('hrms.onboarding.instance.write' as any)
  const canReadProjects = usePermission('hrms.project.read' as any)
  const canAudit = usePermission(P.AUDIT_READ)
  const canSeeProbation = usePermission(P.HRMS_PROBATION_REMINDERS_READ)
  const canProbationConfig = usePermission('hrms.probation.config.read' as any)
  const canApproveCorrections = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canApproveLeave = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canApproveWfh = usePermission(P.WFH_APPROVE)
  const canShiftAdmin = usePermission('attendance.workforce.admin' as any)
  const canRequestLeave = usePermission(P.LEAVE_REQUEST_SELF)
  const canCheckIn = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  const canExport = usePermission(P.HRMS_REPORT_HEADCOUNT)
  const canAddEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canReportAttrition = usePermission(P.HRMS_REPORT_ATTRITION)
  const canReportAttendance = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const canReportLeave = usePermission(P.HRMS_REPORT_LEAVE)
  const canReportDiversity = usePermission(P.HRMS_REPORT_DIVERSITY)
  const canViewReports = canExport || canReportAttrition || canReportAttendance || canReportLeave || canReportDiversity
  const hasPayrollModule = useLocalAuthStore((s) => s.tenant?.activeModules?.includes('payroll') ?? false)
  const canRunsRead = usePermission(P.PAYROLL_RUNS_READ)
  const hasPayroll = hasPayrollModule && canRunsRead
  // Seats: the Billing & plan page's own rule (workspace.billing.manage), not a list of role names.
  const reg = (id: string) => PAGE_REGISTRY.find((e) => e.id === id)?.access
  const canBilling = canOpen(reg('s-billing'), ctx)
  // The greeting's name: the person's full name, first and last (greetingName.ts).
  const greetName = useAuthStore((s) => greetingName(s.user?.firstName, s.user?.lastName))

  // ── data (query keys as before) ────────────────────────────────────────────
  const { data: companies = [], isLoading: companiesLoading } = useCompanies()
  const companyId = companies[0]?.id as string | undefined
  // Attendance: today's view keeps its hooks; a past day asks for the team as it was then
  // (includeLeavers: people who have left since count on the days they worked) and a trend ending on it.
  // includeSelf: a company-wide viewer is on the roster and the trend like everyone else, so Total employees and
  // "scheduled" count the same people, and the viewer's own check-in from the header shows in Present and the list.
  // (A manager's team never includes the manager; a server without the flag leaves the viewer out, as before.)
  // Today's roster is read again when the tab comes back into view: its minute's polling pauses while it is hidden.
  const teamToday = useTeamDashboard(sel, undefined, canReadTeam && !isPast, false, { includeSelf: true, refetchOnFocus: true })
  const teamPast = useQuery({ queryKey: ['hrms', 'attendance', 'dashboard', 'history', sel, 'self'], queryFn: () => apiJson<TeamDashboardResponse>(`/v1/attendance/dashboard?date=${sel}&includeLeavers=true&includeSelf=true`), enabled: canReadTeam && isPast, staleTime: 60_000 })
  const team = isPast ? teamPast : teamToday
  const trendToday = useAttendanceTrend(addDays(today, -30), today, undefined, canReadTeam && !isPast, { includeSelf: true })
  const trendPast = useQuery({ queryKey: ['hrms', 'attendance', 'dashboard', 'trend', 'history', sel, 'self'], queryFn: () => apiJson<DailyAttendanceCounts[]>(`/v1/attendance/dashboard/trend?from=${addDays(sel, -30)}&to=${sel}&includeLeavers=true&includeSelf=true`), enabled: canReadTeam && isPast, staleTime: 60_000 })
  const trend = isPast ? trendPast : trendToday
  const stats = useQuery({ queryKey: ['dashboard', 'summary', companyId, date], queryFn: () => apiJson<Stats>(`/v1/admin/dashboard/stats?companyId=${companyId}${dq}`), enabled: canReadCompany && !!companyId })
  // Total employees comes from the summary's headcount (rollTotal). Only a viewer who gets neither it nor the
  // headcount report (a server before the Home fix, today) falls back to the directory's count.
  const noRollTotal = !canReadCompany || (stats.isSuccess && stats.data?.headcount == null)
  const directory = useEmployeeDirectory({ companyId, pageSize: 1 }, { enabled: canReadEmployees && !!companyId && !isPast && !canExport && noRollTotal })
  const alerts = useQuery({ queryKey: ['dashboard', 'alerts', companyId, date], queryFn: () => apiJson<Alert[]>(`/v1/admin/dashboard/alerts${isPast ? `?date=${sel}` : ''}`), enabled: canReadCompany && !!companyId })
  // Seats: read for the billing line, and for Add employee (disabled with the reason when every seat is used).
  const seats = useSeatsUsage({ enabled: canBilling || canAddEmployee })
  const holidays = useHolidays(companyId ?? '', Number(sel.slice(0, 4)))
  const headcount = useHeadcountReport(canReadEmployees && canExport ? (companyId ?? null) : null, isPast ? sel : undefined)
  const performers = useQuery({ queryKey: ['admin-dashboard', 'performers', companyId, date], queryFn: () => apiJson<{ id: string; name: string; department?: string | null; rating: number; reviews: number }[]>(`/v1/admin/dashboard/performers?companyId=${companyId}${dq}`), enabled: canReadPerformance && !!companyId })
  const onboarding = useQuery({ queryKey: ['admin-dashboard', 'onboarding', companyId, date], queryFn: () => apiJson<{ id: string; name: string; status: string; completed: number; total: number }[]>(`/v1/admin/dashboard/onboarding?companyId=${companyId}${dq}`), enabled: canReadOnboarding && !!companyId })
  const hiring = useQuery({ queryKey: ['admin-dashboard', 'hiring', companyId, date], queryFn: () => apiJson<{ openJobs: number; stages: { stage: string; count: number }[] }>(`/v1/admin/dashboard/hiring?companyId=${companyId}${dq}`), enabled: canReadHiring && !!companyId })
  const projects = useQuery({ queryKey: isPast ? ['hrms', 'projects', companyId, 'on', sel] : ['hrms', 'projects', companyId], queryFn: () => apiJson<Project[]>(`/v1/hrms/projects?companyId=${companyId}${dq}`), enabled: canReadProjects && !!companyId })
  const runs = useRuns({ companyId }, { enabled: hasPayroll && !!companyId })
  const activityToday = useActivityFeed(5, canAudit && !isPast)
  // A past day: the five latest events up to the end of it.
  const activityPast = useQuery({ queryKey: ['hrms', 'activity', 'feed', 5, 'to', sel], queryFn: () => apiJson<AuditPageResponse>(`/v1/audit/events?page=0&size=5&${ACTIVITY_FEED_EXCLUDE}&to=${encodeURIComponent(endOfIstDay(sel))}`), enabled: canAudit && isPast, staleTime: 60_000 })
  const activity = isPast ? activityPast : activityToday
  const notices = useQuery({ queryKey: ['dashboard', 'notices', companyId, noticePage, date], queryFn: () => apiJson<{ content: Notice[]; totalElements: number }>(`/v1/admin/dashboard/notices?companyId=${companyId}&page=${noticePage}&size=${NOTICES_PER_PAGE}${dq}`), enabled: !!companyId })
  // A different day starts the notices from their first page.
  useEffect(() => { setNoticePage(0) }, [date])
  // Archiving the last notice on a page steps back to the page before.
  const noticePages = Math.max(1, Math.ceil((notices.data?.totalElements ?? 0) / NOTICES_PER_PAGE))
  useEffect(() => { if (notices.data && noticePage > 0 && noticePage >= noticePages) setNoticePage(noticePages - 1) }, [notices.data, noticePage, noticePages])
  const probationsToday = useUpcomingProbations(30, canReadEmployees && !isPast)
  // A past day: people on probation then whose probation ended within 30 days of it.
  const probationsPast = useQuery({ queryKey: ['hrms', 'probation', 'upcoming', 30, 'on', sel], queryFn: () => apiJson<UpcomingProbation[]>(`/v1/probation/upcoming?days=30&date=${sel}`), enabled: canReadEmployees && isPast, staleTime: 60_000 })
  const probations = isPast ? probationsPast : probationsToday
  // Check in / out from the dashboard (today's view): the same "Your day" read and face punch as Home at /me, for
  // people who punch too and whose Home this dashboard is. Shown only where the company allows web check-in.
  const day = useMyDay({ enabled: canCheckIn && !isPast })
  const myDay = day.notAvailable ? undefined : day.data
  const punchMode = isPast || !myDay?.webPunchAllowed ? null : !myDay.checkedIn ? 'in' as const : !myDay.checkedOut ? 'out' as const : null

  // ── Needs your action: the counts behind the tiles and the greeting ────────
  const pastAlert = (type: string) => (isPast && alerts.data ? alerts.data.find((a) => a.type === type)?.count ?? 0 : undefined)
  const inbox = useInboxCounts({
    isPast, canAtt: canReadTeam, canFix: canApproveCorrections, canLeave: canApproveLeave, canWfh: canApproveWfh,
    staff: team.data?.staffStatuses, pastCounts: { leave: pastAlert('LEAVE'), fix: pastAlert('CORRECTIONS') },
  })

  // ── notices: save / archive through the API ────────────────────────────────
  const noticeMutation = useMutation({
    mutationFn: ({ id, archive, title, body, expiry }: { id?: string | null; archive?: boolean; title?: string; body?: string; expiry?: string | null }) =>
      apiJson(`/v1/admin/dashboard/notices${id ? '/' + id : ''}`, { method: archive ? 'DELETE' : id ? 'PUT' : 'POST', ...(!archive ? { body: JSON.stringify({ companyId, title, body, expiresOn: expiry || null }) } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'notices'] }),
  })

  // "Export headcount": an Excel workbook (Summary + Employees) for the dashboard's company and date.
  const exportHeadcount = async () => {
    if (!companyId || exporting) return
    setExporting(true)
    try {
      const wb = await fetchHeadcountWorkbook(companyId, sel)
      const file = headcountFileName(wb.companyName, wb.asOf)
      saveAndRecord(file, xlsxBlob(headcountSheets(wb)), { report: 'headcount', fmt: 'XLSX', companyId, filters: { asOf: wb.asOf, workbook: true } })
      toast.success('Headcount exported', { detail: wb.employeesIncluded ? file : `${file} · summary only, your role can’t read employee records` })
    } catch (err) {
      const code = (err as Error & { status?: number }).status
      toast.error('Could not generate the report', { detail: code === 403 ? "Your role doesn't include the headcount report." : (err as Error)?.message || 'Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  // ── the view model ─────────────────────────────────────────────────────────
  const vm: DashboardVm = useMemo(() => {
    const staff = team.data?.staffStatuses ?? []
    // Everyone on the roll (rollTotal), not the day's attendance roster: that leaves out people on their weekly
    // off and the viewer, so it read 0 every Sunday and one short on other days.
    const total = rollTotal(stats.data, headcount.data, directory.data?.totalElements)
    const totalLoading = total == null && (companiesLoading || stats.isLoading || headcount.isLoading || directory.isLoading)
    const c: DayBuckets = team.data ? dayBuckets(team.data, today) : ZERO
    const daily: Record<string, DayBuckets> = {}
    for (const r of trend.data ?? []) daily[r.date] = trendBuckets(r, today)
    if (team.data) daily[sel] = c
    const win = workingWindow(daily, sel)
    const series = (k: keyof DayBuckets) => (win.length >= 2 ? win.map((d) => Number(daily[d][k]) || 0) : null)
    const dot = win.indexOf(sel) >= 0 ? win.indexOf(sel) : undefined
    const sched = scheduledOf(c)
    const st = stats.data
    const hol = (holidays.data ?? []).filter((h) => h.active !== false).map((h) => ({ date: h.holidayDate, name: h.holidayName }))
    const runList = runs.data ?? []
    const upTo = isPast ? sel.slice(0, 7) : undefined
    const months6 = payrollMonths(runList, 6, upTo), months12 = payrollMonths(runList, 12, upTo)

    // Quick actions: today's six tiles, each shown only when its target page opens for the viewer (§5.5).
    const qa = quickActions([
      { key: 'att', label: 'Attendance', path: '/hrms/attendance', allowed: canReadTeam && canOpen(reg('att-daily'), ctx) },
      { key: 'shift', label: 'Change shifts', path: '/hrms/shifts?tab=roster', allowed: canShiftAdmin && canReadTeam && canOpen(reg('att-shifts'), ctx) },
      { key: 'off', label: 'Add time-off', path: '/hrms/leave?tab=apply', allowed: canRequestLeave && canOpen(MENU_RULES['myleave:/hrms/leave'], ctx) },
      { key: 'pay', label: 'Run payroll', path: '/hrms/payroll-dashboard', allowed: hasPayroll && canOpen(reg('pay-dashboard'), ctx) },
      // A past date: the reports open on that date (Reports Center passes it on to the dated reports).
      { key: 'rep', label: 'View reports', path: isPast ? `/hrms/reports?asOf=${sel}` : '/hrms/reports', allowed: canViewReports && canOpen(reg('reports'), ctx) },
      { key: 'org', label: 'Org setup', path: '/hrms/organization', allowed: canOpen(reg('organization'), ctx) },
    ])
    const hint: Record<string, string> = {
      att: sched ? `${c.present} of ${sched} in${isPast ? ` on ${fmtShort(sel).slice(0, -5)}` : ''}` : 'Daily tracking',
      shift: 'Roster and shift changes',
      off: 'Apply for leave',
      pay: runs.data ? payrollHint(runList, today) : 'Payroll dashboard',
      rep: isPast ? `Open on ${fmtShort(sel)}` : 'Headcount, attrition and more',
      org: 'Departments, branches and designations',
    }
    const kind: Record<string, DashboardVm['quick'][number]['kind']> = { att: 'clock', shift: 'swap', off: 'calendar', pay: 'coins', rep: 'chart', org: undefined }

    const needN = inbox.total
    const seatsData = seats.data ? { used: seats.data.current, total: seats.data.purchased } : null
    const seatsFull = !!seatsData && seatsData.total > 0 && seatsData.used >= seatsData.total

    const sections: Record<DashSection, boolean> = {
      overview: true,
      attendance: canReadTeam,
      upcoming: true,
      people: (canReadEmployees && canExport) || canReadPerformance || canReadOnboarding,
      hiring: canReadHiring || canReadProjects,
      payroll: hasPayroll || canAudit,
    }
    const activityRows = (activity.data?.data ?? []).map((e) => {
      const act = (e.action || '').toLowerCase()
      const type = /approv/.test(act) ? 'approve' : /regulari|correct/.test(act) ? 'regularize' : /payroll|lock|process/.test(act) || (e.module || '').includes('payroll') ? 'payroll' : /onboard/.test(act) ? 'onboard' : 'update'
      const record = e.resourceName?.trim() || ''
      const summary = e.summary?.trim() || ''
      const words = summary || `${verb(e.action || 'update')}${e.resourceType ? ' ' + humanise(e.resourceType) : ''}`
      return {
        id: e.id, type, actor: activityActor(e), action: words, record: summary && record && summary.includes(record) ? '' : record,
        module: cap(humanise(e.module || '')), rel: isPast && e.occurredAt ? fmtShort(istToday(new Date(e.occurredAt))) : relTime(e.occurredAt), path: e.resourcePath || '/audit-logs',
      }
    })

    return {
      today, sel, isPast,
      greeting: `${(() => { const h = istHour(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })()}, ${greetName || 'there'}`,
      greetSub: canReadTeam && team.data
        ? { inN: c.present, sched, needN, past: isPast ? fmtShort(sel).slice(0, -5) : null }
        : { inN: null, sched: null, needN, past: isPast ? fmtShort(sel).slice(0, -5) : null },
      // Nobody on the roll yet. It used to read the confirmed (ACTIVE) count, so a company whose people were all
      // still on probation was told to add its first employees.
      emptyWorkspace: !isPast && canReadEmployees && total === 0,
      sections,
      daily, holidays: hol,
      // ── stat cards ──
      counts: c, staff,
      liveLoading: canReadTeam ? team.isLoading : totalLoading,
      liveError: canReadTeam ? team.error : null,
      stats: {
        showTotal: canReadEmployees, showAtt: canReadTeam,
        total, totalLoading,
        // Who is confirmed, on probation and serving notice; a past date: the month's joiners and leavers (§5.5).
        totalNote: rollNote(st, isPast, monthToDate(sel)),
        // Says why "scheduled" isn't Total employees when it isn't: people off that day, or the viewer's team only.
        presentNote: presentNote(c.present, sched, { total: canReadEmployees ? total : null, companyWide: canShiftAdmin, isPast }),
        leaveNote: `Approved leave · ${pctOf(c.onLeave, c.total)}%`,
        lateNote: lateNote(staff, c.late),
        spark: { present: series('present'), leave: series('onLeave'), late: series('late'), half: series('halfDay'), wfh: series('wfh'), none: isPast ? null : series('notMarked'), absent: series('absent') },
        sparkDot: dot,
      },
      // ── quick actions, seats ──
      quick: qa.map((q) => ({ ...q, hint: hint[q.key], kind: kind[q.key] })),
      seats: canBilling && seatsData && seatsData.total > 0 ? seatsData : null,
      addEmployee: canAddEmployee ? { disabledReason: seatsFull ? `All ${seatsData!.total} seats are in use. Add seats to add employees.` : null } : null,
      canExport, exporting, exportName: headcountFileName(companies[0]?.name as string | undefined, sel),
      punch: punchMode,
      // ── needs your action / today's attendance ──
      inbox, canAtt: canReadTeam, canFix: canApproveCorrections, canLeave: canApproveLeave, canWfh: canApproveWfh,
      trendCols: trendColumns(daily, sel, new Set(hol.map((h) => h.date))),
      trendLoading: trend.isLoading, trendError: trend.error,
      // ── upcoming ──
      showNotices: canReadCompany, notices: (notices.data?.content ?? []), noticeTotal: notices.data?.totalElements ?? 0,
      noticesLoading: notices.isLoading, noticesError: notices.isError, noticePage, noticePages,
      canManageNotices: canWriteCompany && !isPast,
      compliance: st && st.complianceDue != null ? { due: Number(st.complianceDue || 0), done: Number(st.complianceCompleted || 0) } : null,
      companyId, canReadEmployees,
      // Upcoming events' holidays open the Leave page's Holidays view, for people who can open it.
      holidaysHref: canOpen(reg('leave:holidays'), ctx) ? HOLIDAYS_PATH : null,
      showProbations: canSeeProbation && canReadEmployees, probations: probations.data ?? [], probationsLoading: probations.isLoading, probationsError: probations.error,
      canDecideProbation: canAddEmployee, canProbationConfig,
      // ── people ──
      showDept: canReadEmployees && canExport, showPerformers: canReadPerformance, showOnboarding: canReadOnboarding,
      // Everyone on the roll per department (confirmed, on probation and serving notice), as the directory a bar opens.
      departments: (headcount.data ?? []).map((r) => ({ id: r.department_id ?? null, name: r.department ?? 'No department', people: Number(r.total ?? 0) })).filter((d) => d.people > 0),
      deptLoading: headcount.isLoading, deptError: headcount.error,
      performers: (performers.data ?? []).map((x) => ({ id: x.id, name: x.name, dept: x.department || '', reviews: x.reviews, rating: x.rating })),
      performersLoading: performers.isLoading, performersError: performers.error,
      onboarding: (onboarding.data ?? []).map((o) => ({ ...o, statusLabel: o.status === 'IN_PROGRESS' ? 'In progress' : o.status.charAt(0) + o.status.slice(1).toLowerCase().replace(/_/g, ' ') })),
      onboardingLoading: onboarding.isLoading, onboardingError: onboarding.error,
      // ── hiring & projects ──
      showHiring: canReadHiring, showProjects: canReadProjects,
      hiring: { openJobs: hiring.data?.openJobs ?? 0, stages: (hiring.data?.stages ?? []).map((x) => ({ ...x, label: stageLabel(x.stage) })) },
      hiringLoading: hiring.isLoading, hiringError: hiring.error,
      projects: projects.data ?? [], projectsLoading: projects.isLoading, projectsError: projects.error,
      // ── payroll & activity ──
      showPayroll: hasPayroll, showActivity: canAudit,
      months6, months12,
      payRange: months6.length ? monthSpan(months6) : isPast ? `Up to ${fmtShort(sel).slice(-8)}` : '',
      payHeadline: st && 'monthlyPayroll' in st ? { month: st.month, gross: st.monthlyPayroll ?? null } : undefined,
      payLoading: runs.isLoading, payError: runs.error,
      activity: activityRows, activityLoading: activity.isLoading, activityError: activity.error,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.data, team.isLoading, team.error, trend.data, trend.isLoading, trend.error, directory.data, directory.isLoading, stats.data, stats.isLoading, alerts.data, seats.data, holidays.data, headcount.data, headcount.isLoading, headcount.error,
    performers.data, performers.isLoading, performers.error, onboarding.data, onboarding.isLoading, onboarding.error, hiring.data, hiring.isLoading, hiring.error, projects.data, projects.isLoading, projects.error,
    runs.data, runs.isLoading, runs.error, activity.data, activity.isLoading, activity.error, notices.data, notices.isLoading, notices.isError, probations.data, probations.isLoading, probations.error,
    inbox, sel, today, greetName, isPast, noticePage, noticePages, ctx, exporting, companies, companiesLoading, punchMode])

  const refetch = {
    live: () => { team.refetch(); trend.refetch(); directory.refetch() }, trend: () => trend.refetch(), notices: () => notices.refetch(), probations: () => probations.refetch(),
    dept: () => headcount.refetch(), performers: () => performers.refetch(), onboarding: () => onboarding.refetch(), hiring: () => hiring.refetch(),
    projects: () => projects.refetch(), payroll: () => runs.refetch(), activity: () => activity.refetch(),
  }

  const onNavigate = (path: string) => navigate(path)

  return (
    <>
      <AdminDashboard
        vm={vm}
        refetch={refetch}
        onNavigate={onNavigate}
        onDate={setDate}
        onPunch={setPunch}
        onExport={exportHeadcount}
        onNoticePage={setNoticePage}
        onSaveNotice={async (n) => {
          try {
            await noticeMutation.mutateAsync(n)
            toast.success(n.id ? 'Notice updated' : 'Notice published')
            return true
          } catch (e) {
            toast.error('Could not save the notice', { detail: (e as Error)?.message })
            return false
          }
        }}
        onArchiveNotice={async (id) => {
          if (!(await confirm({ title: 'Archive notice?', body: 'This notice will no longer appear on the dashboard.', confirmLabel: 'Archive', tone: 'danger' }))) return
          try {
            await noticeMutation.mutateAsync({ id, archive: true })
            toast.success('Notice archived')
          } catch (e) {
            toast.error('Could not archive the notice', { detail: (e as Error)?.message })
          }
        }}
        projectsOpen={projectsOpen}
        onProjects={setProjectsOpen}
      />
      {canCheckIn && <WebPunchDialog open={punch !== null} mode={punch ?? 'in'} onClose={() => setPunch(null)} />}
    </>
  )
}

