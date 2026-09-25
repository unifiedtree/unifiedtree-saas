import { AdminDashboardContainer } from './dashboard/AdminDashboardContainer'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, Clock, CalendarDays, Building2, ArrowRight,
  Banknote, UserPlus, FileText, UserX, ChevronRight, CheckCircle
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, Legend,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell
} from 'recharts'
import { HrStatusPill, HrAvatar } from '@/shared/components/hr'
import { SkeletonCardGrid } from '@/shared/components/SkeletonCard'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { usePendingWfhApprovals } from './api/useWfh'
import { useCorrectionApprovals } from './api/useAttendance'
import { usePendingDocumentQueue } from './api/useDocument'
import { usePendingShiftRequests } from './api/useShiftRequests'
import { usePendingExpenseApprovals } from './api/useExpense'
import { usePendingAdvanceApprovals } from './api/useAdvance'
import { useTeamDashboard, useAttendanceTrend, useAttendanceSources } from './api/useAttendance'
import { useHeadcountReport } from './api/useReports'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
// Local zustand mirror — activeModules lives here, not on the SDK's AuthTenant.
// ModuleGate reads from the same store; using the same source keeps the tile
// and the gate in agreement. The shell reads the workspace name from here too.
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { useRoles } from '@/shared/hooks/useRoles'
import { greetingName } from '@/shared/hooks/greetingName'
import { UpcomingProbations } from './probation/UpcomingProbations'
import { UpcomingMilestones } from './milestones/UpcomingMilestones'
// NOTE: the Attendance Overview donut + legend is rendered INLINE in this file
// (see `attendanceSlices`). A separate `dashboard/AttendanceOverview.tsx`
// component existed until 2026-09-21 but the redesign stopped rendering it while
// leaving the import in place, so two implementations drifted side by side and
// edits to the unused one had no visible effect. It was deleted rather than
// re-wired; this file is the single source of truth for that panel.

/**
 * HRMS home — rebuilt in the reference card language (client-approved
 * screenshot, 2026-08): white rounded-2xl cards with hairline borders on the
 * light ground, title + status-chip headers, a greeting row with a live clock,
 * emerald-family chart series (legend dots + period labels), an approvals card
 * and a quick-action card.
 *
 * DATA: every tile on this page renders REAL tenant data. The four fabricated
 * chart series that used to live here (headcount trend, hires by department,
 * payroll cost, skills radar) were removed on 2026-08-18 — see the block below
 * for why. Headcount is now backed by GET /v1/reports/headcount; the rest were
 * deleted rather than faked because no endpoint exists to feed them.
 *
 * ROLE VISIBILITY (this file's second responsibility): every section is gated
 * by the *permission* the underlying endpoint requires, never by role-string
 * equality. A card whose endpoint the caller cannot read is REMOVED, not shown
 * as a permanent "No data" — an empty card for a role that can never fill it
 * reads as broken. The visibility matrix lives next to the render — see the
 * comment on each section.
 *
 * 2026-09-24 clean-up (Staff Dashboard brief, docs/design-briefs/01-dashboards.md):
 * removed the never-rendered kpiTiles / chartTiles / KpiTile / DonutGauge /
 * headcount-CSV code and the three queries only they read (monthly-stats,
 * audit feed, requisitions); removed the dead controls (Quick Actions gear,
 * row ⋮, single-option chip <select>s, "(N/A)" rows) and the permanently
 * "Data unavailable" Employee Type card; mounted the real Upcoming Milestones /
 * Probations components where a static placeholder stood.
 */

/* ── NO HARDCODED SERIES LIVE HERE ANY MORE ─────────────────────────────────
 *
 * This file used to define four fabricated datasets — headcountTrend (182→236
 * employees), hiresByDept (34 Sales hires), payrollOverview (₹6.8L–10.9L gross,
 * 216–442 employees paid) and skillsRadar — and render them as charts on every
 * tenant's dashboard. A brand-new workspace with three staff was shown a
 * quarter-million-rupee payroll and a 236-person headcount.
 *
 * They carried a "Sample data" chip, but a customer reads the chart, not the
 * chip, and inventing a rupee figure inside an HR/payroll product is not
 * defensible — it is the same fabricated-numbers problem we removed from the
 * marketing site, just hidden one login deeper.
 *
 * Rule: a tile either renders real tenant data or it does not ship. If a trend
 * chart is wanted, it needs a headcount-history source built properly.
 * ─────────────────────────────────────────────────────────────────────────── */

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.18)',
}

/* ── Reference-language building blocks ───────────────────────────────── */

/** White rounded-2xl card: title left, status chip / period label right. */
function Card({ title, chip, className = '', children }: {
  title?: string
  chip?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section className={`ut-card p-5 ${className}`}>
      {(title || chip) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">{title}</h2>}
          {chip}
        </div>
      )}
      {children}
    </section>
  )
}

/** Static period label for a card header. These used to be single-option
 *  <select>s — a control that offers no choice is a dead control. */
function PeriodLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-xs text-[var(--text-tertiary)]">{children}</span>
}

/** Per-card error line with a retry — a failed query used to fall through to
 *  the empty text, which told the user "nothing happened" when it had failed. */
function CardError({ what, onRetry, className = 'h-48' }: { what: string; onRetry: () => void; className?: string }) {
  return (
    <div role="alert" className={`flex flex-col items-center justify-center gap-2 text-center ${className}`}>
      <p className="text-sm text-[var(--text-secondary)]">Couldn't load {what}.</p>
      <button type="button" onClick={onRetry} className="text-xs font-semibold text-[#059669] underline-offset-2 hover:underline">
        Try again
      </button>
    </div>
  )
}

/** Live clock — updates only when the displayed minute actually changes. */
function useLiveClock() {
  const fmt = () => new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const [time, setTime] = React.useState(fmt)
  React.useEffect(() => {
    const id = window.setInterval(() => {
      setTime((prev) => {
        const next = fmt()
        return next === prev ? prev : next
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])
  return time
}

const RoleDashboard: React.FC = () => {
  const navigate = useNavigate()
  const { data: companies = [] } = useCompanies()
  const activeCompany = companies[0]
  // Same source the shell header uses for the workspace name (PlatformShell
  // `tenantName`), populated at login. The subtitle used to hard-code "Ionora".
  const tenantName = useLocalAuthStore((s) => s.tenant?.name)
  const orgName = tenantName || activeCompany?.name

  /* ── Permission gates (SDK usePermission — the retired
   *    @/core/permissions/PermissionGate stack is intentionally not imported). */
  const canApproveLeaves = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  // "My Attendance" in the greeting row. Punching is mobile-only (see the note
  // in Attendance.tsx / EssDashboard.tsx — the web app deliberately has no
  // check-in widget), so the web button opens the caller's own attendance tab,
  // which Attendance.tsx gates on exactly this permission.
  const canSelfCheckin = usePermission(P.ATTENDANCE_CHECKIN_SELF)
  // Quick-action "Run Payroll" — hide the affordance when the caller cannot
  // read the payroll runs page, otherwise the button 403s on click.
  //
  // 2026-09-10: also gate on module entitlement. /hrms/payroll-dashboard is
  // wrapped in ModuleGate moduleKey="payroll", which renders the "module not
  // activated" screen unless tenant.activeModules includes 'payroll'.
  // SUPER_ADMIN is seeded every permission (V017 fan-out), so on an HR-only
  // workspace — the standard sold configuration — the admin used to see this
  // tile and dead-end on that wall.
  const hasPayrollModule = useLocalAuthStore((s) => s.tenant?.activeModules?.includes('payroll') ?? false)
  const canRunPayroll    = usePermission(P.PAYROLL_RUNS_READ) && hasPayrollModule
  // Quick-action "View Reports" — any of the HRMS report perms is enough to
  // land on /hrms/reports without a 403 (the page picks whichever tab the
  // caller can open).
  // Each hook runs on every render (an `a() || b()` chain would skip the rest).
  const reportPerms      = [
    usePermission(P.HRMS_REPORT_HEADCOUNT), usePermission(P.HRMS_REPORT_ATTRITION), usePermission(P.HRMS_REPORT_ATTENDANCE),
    usePermission(P.HRMS_REPORT_LEAVE), usePermission(P.HRMS_REPORT_DIVERSITY),
  ]
  const canViewReports   = reportPerms.some(Boolean)
  // Org-wide attendance ("who is in today") is its own permission — the
  // endpoints are guarded by exactly this, so the tiles are gated on the same
  // code rather than on a role string.
  const canReadTeamAttendance = usePermission(P.ATTENDANCE_TEAM_READ)
  // Quick-action affordances follow the write authority the target action needs,
  // not role membership — HR_MANAGER holds both and sees both, exactly like the
  // backend allows.
  const canWriteEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg     = usePermission(P.ORG_COMPANY_WRITE)
  const canRequestLeave  = usePermission(P.LEAVE_REQUEST_SELF)

  /* ── Role bucket. Used only for the client rule on workforce-wide tiles
   *  below; every other gate is the permission check above. See useRoles.ts
   *  for the role-to-bucket map. */
  const { isAdmin, isHR, isFinance } = useRoles()

  // Workforce-shaped tiles (Department Headcount) — client matrix restricts
  // these to ADMIN + HR + FINANCE. Manager may hold HRMS_EMPLOYEE_READ for
  // their team but the client rule hides the workforce-wide surfaces from them,
  // and employees never see them either. FINANCE_LEAD holds hrms.employee.read
  // + 5 report perms per the backend seed and needs the workforce roll-ups.
  const canSeeWorkforceTiles = canReadEmployees && (isAdmin || isHR || isFinance)

  /* ── Data hooks. Employee-directory + recent-employees fire only when the
   *    user is allowed to read employees; without that the backend 403s and
   *    the tiles would show a red toast on every load. */
  const directoryQuery = useEmployeeDirectory(
    { companyId: activeCompany?.id, pageSize: 5 },
    { enabled: canReadEmployees && !!activeCompany?.id },
  )
  const leaveOverviewQuery = useLeaveOverview()
  // Pending across every request type (leave + WFH + correction + shift +
  // expense + advance). Each hook is gated by the same permission its API
  // needs so an employee never sees a 403 in the network log; enabled=false
  // returns undefined data.
  const canApproveCorrections = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canApproveWfh = usePermission(P.WFH_APPROVE)
  const canApproveExpense = usePermission('hrms.expense.claim.approve')
  const canApproveAdvance = usePermission('hrms.advance.approve')
  const canVerifyDocuments = usePermission('hrms.document.verify')
  const pendingDocsQuery = usePendingDocumentQueue(canVerifyDocuments)
  const wfhApprovalsQuery = usePendingWfhApprovals(0, 1)
  const correctionApprovalsQuery = useCorrectionApprovals('PENDING', { enabled: canApproveCorrections, page: 0, size: 1 })
  const shiftRequestsQuery = usePendingShiftRequests()
  const expenseApprovalsQuery = usePendingExpenseApprovals(0, canApproveExpense, 1)
  const advanceApprovalsQuery = usePendingAdvanceApprovals(0, canApproveAdvance)
  const now = new Date()

  /* ── Live Overview: today's org-wide attendance split, the trailing 7-day
   *    series behind the trend chart (server default: today − 6 … today) and
   *    today's check-in sources. All are disabled unless the principal
   *    actually holds attendance.team.read, so a bare employee never fires a
   *    request they'd get a 403 for. */
  const teamDashboardQuery = useTeamDashboard(undefined, undefined, canReadTeamAttendance)
  const trendQuery = useAttendanceTrend(undefined, undefined, undefined, canReadTeamAttendance)
  const sourcesQuery = useAttendanceSources(undefined, undefined, canReadTeamAttendance)

  // Real headcount-by-department. Passing null disables the query (the hook
  // gates on `enabled: !!companyId`), which is how we keep an employee session
  // from firing a report request the backend would 403 on.
  const headcountQuery = useHeadcountReport(
    canSeeWorkforceTiles ? (activeCompany?.id ?? null) : null,
  )
  const headcountRows = (headcountQuery.data ?? [])
    .map((r) => ({
      department: r.department ?? 'Unassigned',
      active: Number(r.active ?? 0),
    }))
    .filter((r) => r.active > 0)

  const directory        = directoryQuery.data
  const leaveOverview    = leaveOverviewQuery.data

  const totalEmployees   = directory?.totalElements ?? 0
  const recentEmployees  = directory?.content ?? []
  const leavePendingApprovals = leaveOverview?.pendingApprovals ?? 0
  // Own pending requests — derived from recentRequests, no extra hook.
  const myPendingRequests = (leaveOverview?.recentRequests ?? []).filter(
    (r) => r.status === 'PENDING',
  ).length
  // Sum across every queue this caller can approve. Each hook is only
  // enabled when its permission is held, so a manager without WFH approve
  // rights simply contributes 0 rather than a 403.
  const approverPendingCount =
    (canApproveLeaves ? leavePendingApprovals : 0) +
    (canApproveWfh ? (wfhApprovalsQuery.data?.totalElements ?? 0) : 0) +
    (canApproveCorrections ? (correctionApprovalsQuery.data?.totalElements ?? 0) : 0) +
    ((shiftRequestsQuery.data?.length ?? 0)) +
    (canApproveExpense ? (expenseApprovalsQuery.data?.totalElements ?? 0) : 0) +
    (canApproveAdvance ? (advanceApprovalsQuery.data?.totalElements ?? 0) : 0) +
    (canVerifyDocuments ? (pendingDocsQuery.data?.length ?? 0) : 0)
  const canApproveAny = canApproveLeaves || canApproveWfh || canApproveCorrections || canApproveExpense || canApproveAdvance || canVerifyDocuments
  const pendingCount = canApproveAny ? approverPendingCount : myPendingRequests
  const anyPendingError = leaveOverviewQuery.isError
    || (canApproveWfh && wfhApprovalsQuery.isError)
    || (canApproveCorrections && correctionApprovalsQuery.isError)
    || (canApproveExpense && expenseApprovalsQuery.isError)
    || (canApproveAdvance && advanceApprovalsQuery.isError)
  // Approvers go to their queue even when it is empty — routing on
  // `pendingApprovals > 0` dropped an approver with a clear queue onto "my".
  const leaveTarget = canApproveLeaves ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my'

  // The greeting's name: the first name, or the full name when it is just an initial.
  const firstName = useAuthStore((s) => greetingName(s.user?.firstName, s.user?.lastName))
  const clock = useLiveClock()

  const quickActions = [
    // 2026-09-10: ?add=1 opens the Add Employee drawer directly, so this quick
    // action is one click instead of two ("Add Employee" → then Add Employee
    // again). See Employees.tsx which reads the query param and strips it.
    ...(canWriteEmployee ? [{ label: 'Add Employee', icon: UserPlus, path: '/hrms/employees?add=1' }] : []),
    ...(canRunPayroll ? [{ label: 'Run Payroll', icon: Banknote, path: '/hrms/payroll-dashboard' }] : []),
    // Shown only to people who can open them (hidden, never a dead end).
    ...(canSelfCheckin || canReadTeamAttendance ? [{ label: 'Attendance', icon: Clock, path: '/hrms/attendance' }] : []),
    ...(canRequestLeave ? [{ label: 'Add Time-Off', icon: CalendarDays, path: '/hrms/leave' }] : []),
    ...(canManageOrg ? [{ label: 'Org Setup', icon: Building2, path: '/hrms/organization' }] : []),
    ...(canViewReports ? [{ label: 'View Reports', icon: FileText, path: '/hrms/reports' }] : []),
  ]

  const greeting = (() => {
    const h = now.getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now)

  /* ── KPI strip: the outermost data hooks. While any one is still pending
   *    we swap the whole strip for a SkeletonCardGrid so the header + row
   *    layout don't jump when the tiles fade in. Charts + tables below
   *    have their own local loading affordances. */
  const kpiPending =
    leaveOverviewQuery.isPending ||
    // The directory / roster queries are disabled for callers without the
    // permission, so only wait for them when they are actually running.
    (canReadEmployees && !!activeCompany?.id && directoryQuery.isPending) ||
    (canReadTeamAttendance && teamDashboardQuery.isPending)

  /* ── Attendance Overview donut + legend ───────────────────────────────────
   *
   * One definition drives the arc, the cells AND the legend, so a colour or a
   * count can never disagree between them. `status` is the drill-down target:
   * each legend row deep-links into the attendance roster filtered to that
   * status, which is what turns these numbers from a report into a tool.
   *
   * ON_LEAVE routes to the roster too (not to /hrms/leave): the question the
   * donut raises is "which of my people are out today", and the roster answers
   * it in the same table as every sibling status. */
  const oCounts = teamDashboardQuery.data?.counts
  const attendanceSlices = [
    { name: 'Present',        status: 'PRESENT',        value: oCounts?.present ?? 0,       fill: '#059669' },
    { name: 'Late',           status: 'LATE',           value: oCounts?.late ?? 0,          fill: '#D97706' },
    { name: 'Absent',         status: 'ABSENT',         value: oCounts?.absent ?? 0,        fill: '#DC2626' },
    { name: 'On Leave',       status: 'ON_LEAVE',       value: oCounts?.onLeave ?? 0,       fill: '#A7F3D0' },
    { name: 'Work From Home', status: 'WORK_FROM_HOME', value: oCounts?.workFromHome ?? 0,  fill: '#3B82F6' },
    { name: 'Not Marked',     status: 'NOT_MARKED',     value: oCounts?.notMarked ?? 0,     fill: '#D1D5DB' },
  ]
  /* Percentages — KPI strip, Present ring AND the legend — are taken against
   * the roster these counts describe, never against directory totalElements:
   * mixing the two produced "3780% present" in testing, and a manager without
   * hrms.employee.read (totalEmployees = 0) saw "9800% of total" once the
   * divisor collapsed to max(0, 1). No roster → "—", not a made-up 0%. */
  const rosterTotal = teamDashboardQuery.data?.staffStatuses?.length ?? 0
  const pctOfRoster = (n: number) => (rosterTotal > 0 ? `${Math.round((n / rosterTotal) * 100)}%` : '—')
  const presentShare = rosterTotal > 0 ? Math.min(1, (oCounts?.present ?? 0) / rosterTotal) : null
  const kpiCount = (n: number | undefined) => (teamDashboardQuery.isError ? '—' : n ?? 0)

  // Attendance trend — real per-day series from GET /v1/attendance/dashboard/trend
  // (added 2026-08-22): every point is a real count for a real date, and days
  // with no records render as genuine zeros rather than being dropped.
  const trendRows = (trendQuery.data ?? []).map((row) => ({
    label: new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    Present: row.present,
    Absent: row.absent,
  }))
  const overtimeMinutes = (trendQuery.data ?? []).reduce((sum, r) => sum + r.overtimeMinutes, 0)
  const sources = sourcesQuery.data?.sources ?? []

  // Bottom row: Recent Employees is the directory page (hrms.employee.read);
  // Needs Your Attention is always there (leave overview is open to everyone).
  const showRecentEmployees = canReadEmployees

  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      <div className="mx-auto max-w-[1400px] space-y-6 p-6 font-sans sm:p-8">

        {/* ── Greeting row */}
        <div className="relative flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-6 md:p-8 overflow-hidden mb-8 shadow-sm">
          {/* Restored the actual leaf image from assets */}
          <div className="absolute right-0 top-0 h-full w-1/3 opacity-50 pointer-events-none mix-blend-multiply">
            <img src="/assets/decorative_leaf.jpg" alt="" className="h-full w-full object-cover object-right" />
          </div>

          <div className="min-w-0 z-10">
            <h1 className="text-[28px] font-bold leading-tight tracking-tight text-[var(--text-primary)]">
              {greeting}, {firstName ?? 'there'}! 👋
            </h1>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              {orgName ? `Here's what's happening at ${orgName} today.` : "Here's what's happening today."}
            </p>
          </div>
          <div className="flex items-center gap-6 z-10">
            <div className="text-right">
              <p className="text-[12px] font-semibold text-brand-900/60 mb-0.5">{formattedDate}</p>
              <p className="text-[26px] font-bold leading-tight tabular-nums text-[var(--text-primary)]">{clock}</p>
            </div>
            {/* Was "Mark Attendance" with no onClick. Punching is mobile-only,
                so the honest web action is the caller's own attendance tab. */}
            {canSelfCheckin && (
              <button
                type="button"
                onClick={() => navigate('/hrms/attendance?tab=my')}
                className="flex items-center gap-2 rounded-xl bg-[#08402F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0a523d] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
              >
                <UserCheck size={16} className="text-[#4ADE80]" />
                My Attendance
                <ChevronRight size={16} className="ml-1 opacity-70" />
              </button>
            )}
          </div>
        </div>

        {/* ── KPI Strip (driven by real data) ──
            Every tile here is a BUTTON with a real destination. The three
            roster-wide tiles are gated on attendance.team.read: that is the
            authority guarding /v1/attendance/dashboard, so without it
            teamDashboardQuery never resolves and the tiles would have shown a
            confident "0" to someone simply not allowed to know. */}
        {kpiPending ? (
          <SkeletonCardGrid count={5} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {canReadEmployees && (
            <button
              type="button"
              onClick={() => navigate('/hrms/employees')}
              aria-label="Total employees. Opens the workforce directory."
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div className="absolute right-0 top-0 opacity-5 pointer-events-none text-9xl -translate-y-4 translate-x-4"><Users /></div>
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#059669]"><Users size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Total Employees</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{directoryQuery.isError ? '—' : totalEmployees}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  {directoryQuery.isError ? "Couldn't load the directory" : `Active in ${activeCompany?.name || 'organization'}`}
                </p>
              </div>
            </button>
            )}

            {canReadTeamAttendance && (
            <button
              type="button"
              onClick={() => navigate('/hrms/attendance?tab=team&status=PRESENT')}
              aria-label="Present today. Opens today's roster filtered to present employees."
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              {presentShare != null && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                 <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#F1F5F9" strokeWidth="6" />
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#059669" strokeWidth="6" strokeDasharray="125" strokeDashoffset={125 - 125 * presentShare} />
                 </svg>
              </div>
              )}
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#059669]"><UserCheck size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Present Today</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{kpiCount(oCounts?.present)}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#059669]">{pctOfRoster(oCounts?.present ?? 0)}</span> of roster
                </p>
              </div>
            </button>
            )}

            {canReadTeamAttendance && (
            <button
              type="button"
              onClick={() => navigate('/hrms/attendance?tab=team&status=ON_LEAVE')}
              aria-label="On leave today. Opens today's roster filtered to employees on approved leave."
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div className="absolute right-0 top-0 opacity-5 pointer-events-none text-9xl -translate-y-4 translate-x-4"><CalendarDays /></div>
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FFF7ED] text-[#EA580C]"><CalendarDays size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">On Leave</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{kpiCount(oCounts?.onLeave)}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#EA580C]">{pctOfRoster(oCounts?.onLeave ?? 0)}</span> of roster
                </p>
              </div>
            </button>
            )}

            {canReadTeamAttendance && (
            <button
              type="button"
              onClick={() => navigate('/hrms/attendance?tab=team&status=ABSENT')}
              aria-label="Absent today. Opens today's roster filtered to unexplained absences."
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div className="absolute right-0 top-0 opacity-5 pointer-events-none text-9xl -translate-y-4 translate-x-4"><UserX /></div>
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2] text-[#DC2626]"><UserX size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Absent Today</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{kpiCount(oCounts?.absent)}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#DC2626]">{pctOfRoster(oCounts?.absent ?? 0)}</span> of roster
                </p>
              </div>
            </button>
            )}

            <button
              type="button"
              onClick={() => navigate(leaveTarget)}
              aria-label="Pending requests. Opens the leave queue."
              className="relative flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <div className="absolute right-0 top-0 opacity-5 pointer-events-none text-9xl -translate-y-4 translate-x-4"><FileText /></div>
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#2563EB]"><FileText size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Pending Requests</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{anyPendingError ? '—' : pendingCount}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  {anyPendingError ? "Couldn't load requests" : canApproveAny ? 'awaiting your approval' : 'awaiting decision'}
                </p>
              </div>
            </button>
          </div>
        )}

        {/* ── Main Dashboard Grid ──
            Attendance Overview + Trend read attendance.team.read endpoints;
            without it they could only ever say "No data", so they are not
            rendered. Quick Actions is always there. */}
        <div className={`grid grid-cols-1 gap-6 ${canReadTeamAttendance ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>

          {/* Column 1: Attendance Overview */}
          {canReadTeamAttendance && (
          <div className="flex flex-col gap-6">
             <Card title="Attendance Overview" chip={<PeriodLabel>Today</PeriodLabel>} className="h-full">
               {teamDashboardQuery.isError ? (
                 <CardError what="today's attendance" onRetry={() => teamDashboardQuery.refetch()} className="min-h-[300px]" />
               ) : oCounts ? (
                 <div className="flex flex-col items-center gap-6 mt-4">
                   <div className="relative w-48 h-48">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         {/* One slice definition drives the arc, the cells and the
                             legend — they cannot drift apart, and the legend's
                             drill-down target is declared alongside its colour. */}
                         <Pie
                           data={attendanceSlices.filter(d => d.value > 0)}
                           dataKey="value" innerRadius={70} outerRadius={90} stroke="none"
                         >
                           {attendanceSlices.filter(d => d.value > 0).map(d => (
                             <Cell key={d.name} fill={d.fill} />
                           ))}
                         </Pie>
                         <Tooltip contentStyle={tooltipStyle} />
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                       <span className="text-3xl font-bold text-gray-800">{rosterTotal}</span>
                       <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider mt-1">Total</span>
                     </div>
                   </div>
                   {/* Legend rows are the drill-down. Each opens the attendance
                       roster filtered to that status — the question every one of
                       these numbers raises is "who?", and this answers it in one
                       click. */}
                   <div className="w-full space-y-1">
                     {attendanceSlices.map(stat => (
                       <button
                         key={stat.name}
                         type="button"
                         onClick={() => navigate(`/hrms/attendance?tab=team&status=${stat.status}`)}
                         title={`View the ${stat.value} ${stat.name.toLowerCase()} employees`}
                         className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px] transition-colors hover:bg-[var(--accent-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                       >
                         <span className="flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full" style={{ backgroundColor: stat.fill }} />
                           <span className="text-gray-600">{stat.name}</span>
                         </span>
                         <span className="flex items-center gap-1.5">
                           <span className="font-semibold tabular-nums">
                             {stat.value} ({pctOfRoster(stat.value)})
                           </span>
                           <ArrowRight size={13} className="text-gray-300" />
                         </span>
                       </button>
                     ))}
                   </div>
                 </div>
               ) : (
                 <div className="flex h-full min-h-[300px] items-center justify-center">
                   <p className="text-sm text-gray-400">No data available</p>
                 </div>
               )}
             </Card>
          </div>
          )}

          {/* Column 2: Attendance Trend */}
          {canReadTeamAttendance && (
          <div className="flex flex-col gap-6">
             <Card title="Attendance Trend" chip={<PeriodLabel>Last 7 days</PeriodLabel>} className="h-full">
               {trendQuery.isError ? (
                 <CardError what="the attendance trend" onRetry={() => trendQuery.refetch()} className="min-h-[300px]" />
               ) : trendRows.length > 0 ? (
                 <div className="h-[380px] w-full mt-4">
                   <ResponsiveContainer width="100%" height="100%">
                     <AreaChart data={trendRows} margin={{ top: 10, right: 0, bottom: 0, left: -20 }}>
                       <defs>
                         <linearGradient id="presentFill" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="0%" stopColor="#059669" stopOpacity={0.2} />
                           <stop offset="100%" stopColor="#059669" stopOpacity={0} />
                         </linearGradient>
                       </defs>
                       <CartesianGrid stroke="#f3f4f6" vertical={false} />
                       <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                       <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                       <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} cursor={{ stroke: '#059669', strokeWidth: 1, strokeDasharray: '4 4' }} />
                       <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: '20px' }} />
                       <Area type="monotone" dataKey="Present" stroke="#059669" strokeWidth={2.5} fill="url(#presentFill)" activeDot={{ r: 6, fill: '#059669', stroke: 'white', strokeWidth: 2 }} />
                       <Area type="monotone" dataKey="Absent" stroke="#DC2626" strokeWidth={2} fill="none" strokeDasharray="4 4" />
                     </AreaChart>
                   </ResponsiveContainer>
                 </div>
               ) : (
                 <div className="flex h-full min-h-[300px] items-center justify-center">
                   <p className="text-sm text-gray-400">No trend data available</p>
                 </div>
               )}
             </Card>
          </div>
          )}

          {/* Column 3: Promo Banner + Quick Actions. Without the two attendance
              columns the wrapper dissolves (display: contents) so the banner and
              Quick Actions share the row instead of leaving half of it empty. */}
          <div className={canReadTeamAttendance ? 'flex flex-col gap-6' : 'contents'}>
             <div className="relative overflow-hidden rounded-2xl bg-[#E8F5E9] p-6 shadow-sm border border-[#C8E6C9] flex flex-col justify-center min-h-[160px]">
               {/* Restored the actual promotional plant image */}
               <div className="absolute right-0 bottom-0 h-full w-1/2 pointer-events-none mix-blend-multiply opacity-90">
                 <img src="/assets/promo_plant.jpg" alt="" className="h-full w-full object-cover object-left-bottom" />
               </div>
               <div className="relative z-10 w-2/3">
                 <h3 className="text-[16px] font-bold text-[#1b5e20] leading-tight mb-2">Everything in one place for a better tomorrow</h3>
                 <p className="text-[12px] text-[#2e7d32] leading-relaxed">Manage your people, processes and growth with ease.</p>
               </div>
             </div>

             <Card title="Quick Actions" className="flex-1">
               <div className="grid grid-cols-2 gap-3 mt-2">
                 {quickActions.map((a) => (
                   <button key={a.label} type="button" onClick={() => navigate(a.path)} className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-4 transition-colors hover:bg-gray-100">
                     <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm text-[#059669]">
                       <a.icon size={18} />
                     </span>
                     <span className="text-[12px] font-medium text-gray-700">{a.label}</span>
                   </button>
                 ))}
               </div>
             </Card>
          </div>
        </div>

        {/* ── Secondary Dashboard Row ──
            Department Headcount needs the workforce gate (reports/headcount);
            Attendance Source + Overtime read attendance.team.read endpoints.
            "Employee Type" was removed: it had no data source and could only
            ever say "Data unavailable". */}
        {(canSeeWorkforceTiles || canReadTeamAttendance) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {/* Department Headcount */}
           {canSeeWorkforceTiles && (
           <Card title="Department Headcount" chip={<PeriodLabel>Active employees</PeriodLabel>}>
              {headcountQuery.isError ? (
                <CardError what="the headcount report" onRetry={() => headcountQuery.refetch()} />
              ) : headcountRows.length > 0 ? (
                <>
                  <div className="relative h-48 mt-4 flex items-center justify-center">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie data={headcountRows} dataKey="active" nameKey="department" innerRadius={60} outerRadius={80} fill="#3B82F6" stroke="none">
                           {headcountRows.map((entry, index) => (
                             <Cell key={`cell-${index}`} fill={['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'][index % 5]} />
                           ))}
                         </Pie>
                         <Tooltip contentStyle={tooltipStyle} />
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                       <span className="text-2xl font-bold text-gray-800">{headcountRows.reduce((sum, r) => sum + r.active, 0)}</span>
                       <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">Total</span>
                     </div>
                  </div>
                  <div className="mt-2 space-y-1">
                     {headcountRows.slice(0, 3).map((r, idx) => (
                       <div key={r.department} className="flex justify-between text-[12px] items-center">
                         <div className="flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'][idx % 5] }}></span>
                           <span className="text-gray-600 truncate max-w-[120px]">{r.department}</span>
                         </div>
                         <span className="font-semibold">{r.active}</span>
                       </div>
                     ))}
                  </div>
                </>
              ) : (
                <div className="flex h-48 items-center justify-center">
                  <p className="text-sm text-gray-400">{headcountQuery.isPending ? 'Loading…' : 'No data'}</p>
                </div>
              )}
           </Card>
           )}

           {/* Attendance Source */}
           {canReadTeamAttendance && (
           <Card title="Attendance Source" chip={<PeriodLabel>Today</PeriodLabel>}>
              {sourcesQuery.isError ? (
                <CardError what="attendance sources" onRetry={() => sourcesQuery.refetch()} />
              ) : sources.length > 0 ? (
                <>
                  <div className="relative h-48 mt-4 flex items-center justify-center">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie data={sources} dataKey="count" nameKey="method" innerRadius={60} outerRadius={80} stroke="none">
                           {sources.map((entry, index) => (
                             <Cell key={`cell-${index}`} fill={['#8B5CF6', '#10B981', '#3B82F6', '#F59E0B'][index % 4]} />
                           ))}
                         </Pie>
                         <Tooltip contentStyle={tooltipStyle} />
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                       <span className="text-2xl font-bold text-gray-800">{sources.reduce((sum, s) => sum + s.count, 0)}</span>
                       <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">Total</span>
                     </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                     {sources.slice(0, 3).map((s, idx) => (
                       <div key={s.method} className="flex justify-between text-[12px] items-center">
                         <div className="flex items-center gap-2">
                           <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ['#8B5CF6', '#10B981', '#3B82F6', '#F59E0B'][idx % 4] }}></span>
                           <span className="text-gray-600 truncate max-w-[120px]">{s.method}</span>
                         </div>
                         <span className="font-semibold">{s.count}</span>
                       </div>
                     ))}
                  </div>
                </>
              ) : (
                <div className="flex h-48 items-center justify-center">
                  <p className="text-sm text-gray-400">No data</p>
                </div>
              )}
           </Card>
           )}

           {/* Overtime — summed from the same 7-day trend series (the label
               used to say "This month"; the static three-bar mini chart that
               sat behind the number was decoration, not data, and is gone). */}
           {canReadTeamAttendance && (
           <Card title="Overtime" chip={<PeriodLabel>Last 7 days</PeriodLabel>}>
              {trendQuery.isError ? (
                <CardError what="overtime" onRetry={() => trendQuery.refetch()} />
              ) : overtimeMinutes > 0 ? (
                <div className="h-48 mt-4 flex items-center">
                  <div className="flex flex-col gap-2">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-500 mb-2">
                      <Clock size={24} />
                    </span>
                    <span className="text-4xl font-bold text-gray-800">
                      {Math.floor(overtimeMinutes / 60)}h
                    </span>
                    <span className="text-[12px] text-gray-500 flex items-center gap-1 mt-1">
                      Logged in the last 7 days
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex h-48 mt-4 items-center justify-center flex-col gap-2">
                  <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-50 text-gray-300">
                    <Clock size={24} />
                  </span>
                  <p className="text-sm text-gray-400">No overtime recorded</p>
                </div>
              )}
           </Card>
           )}
        </div>
        )}

        {/* ── Bottom Sections (real data only) ── */}
        <div className={`grid grid-cols-1 gap-6 ${showRecentEmployees ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
           {/* Recent Employees Table — rows open the employee; the old ⋮
               column had no handler (its click just bubbled to the row). */}
           {showRecentEmployees && (
           <div className="lg:col-span-2">
             <Card title="Recent Employees" className="h-full">
               {directoryQuery.isError ? (
                 <CardError what="employees" onRetry={() => directoryQuery.refetch()} />
               ) : (
               <div className="overflow-x-auto mt-4">
                 <table className="w-full text-[13px]">
                   <thead>
                     <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                       <th className="pb-3 text-left font-semibold">Employee</th>
                       <th className="pb-3 text-left font-semibold">Email</th>
                       <th className="pb-3 text-left font-semibold">Status</th>
                     </tr>
                   </thead>
                   <tbody>
                     {recentEmployees.length === 0 ? (
                       <tr>
                         <td colSpan={3} className="px-5 py-12 text-center text-sm text-[var(--text-tertiary)]">
                           {directoryQuery.isPending && !!activeCompany?.id ? 'Loading…' : 'No employees yet.'}
                         </td>
                       </tr>
                     ) : recentEmployees.map((emp, i) => {
                       const status = emp.employmentStatus
                       return (
                         <tr
                           key={emp.id}
                           onClick={() => navigate(`/hrms/employees/${emp.id}`)}
                           className="cursor-pointer border-b border-[var(--border-subtle)] transition-colors last:border-b-0 hover:bg-[var(--bg-subtle)]"
                         >
                           <td className="py-3">
                             <div className="flex items-center gap-3">
                               <HrAvatar name={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} seed={i} />
                               <span className="font-medium text-gray-800">{emp.firstName} {emp.lastName}</span>
                             </div>
                           </td>
                           <td className="py-3 text-gray-600">{emp.email}</td>
                           <td className="py-3">
                             <HrStatusPill tone={status === 'ACTIVE' ? 'ok' : status === 'PROBATION' ? 'warn' : 'gray'}>
                               {status ?? '—'}
                             </HrStatusPill>
                           </td>
                         </tr>
                       )
                     })}
                   </tbody>
                 </table>
               </div>
               )}
             </Card>
           </div>
           )}

           {/* Needs Your Attention — only rows with a real source and a real
               destination. "Corrections (N/A)" / "Overtime (N/A)" had neither. */}
           <Card title="Needs Your Attention" className="flex flex-col h-full">
             <div className="flex-1 mt-4 space-y-2">
               <button
                 type="button"
                 onClick={() => navigate(leaveTarget)}
                 className="flex w-full items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-[#C8E6C9] hover:bg-[#F2FBF4] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
               >
                 <span className="text-[13px] font-medium text-gray-700 group-hover:text-[#059669]">
                   {canApproveAny ? 'Requests to approve' : 'My pending requests'}
                 </span>
                 <span className="flex items-center gap-2">
                   <span className="flex h-5 min-w-[1.25rem] px-1 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600 group-hover:bg-[#059669] group-hover:text-white transition-colors">
                     {anyPendingError ? '—' : pendingCount}
                   </span>
                   <ChevronRight size={14} className="text-gray-400 group-hover:text-[#059669]" />
                 </span>
               </button>
             </div>
           </Card>
        </div>

        {/* ── Upcoming key dates — the real components, replacing the static
            "Check milestones" placeholder. Milestones is open to every
            authenticated user (GET /v1/hrms/milestones isAuthenticated);
            probations call GET /v1/probation/upcoming, which the backend
            guards with hrms.employee.read, so the card follows that gate. */}
        <section aria-label="Upcoming key dates" className="space-y-6">
          <UpcomingMilestones />
          {canReadEmployees && <UpcomingProbations />}
        </section>

        {/* ── Footer Strip (decorative — no hover affordance, no links) ── */}
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between border-t border-gray-200 pt-6 pb-2 text-[12px] text-gray-500">
           <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#059669] text-white">
                <CheckCircle size={12} />
              </span>
              <span className="font-medium text-gray-600">A people-first workplace creates limitless possibilities.</span>
           </div>
           <div className="flex gap-4 mt-4 md:mt-0" aria-hidden>
             <span>People</span>
             <span>•</span>
             <span>Process</span>
             <span>•</span>
             <span>Progress</span>
           </div>
        </div>
      </div>
    </div>
  )
}

// Company-admin recovery leaves the existing staff dashboard behavior intact.
export const HrmsDashboard: React.FC = () => {
  const { isEmployee } = useRoles()
  return !isEmployee ? <AdminDashboardContainer /> : <RoleDashboard />
}
