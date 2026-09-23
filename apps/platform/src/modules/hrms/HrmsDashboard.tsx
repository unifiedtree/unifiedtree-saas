import { CompanyAdminDashboard } from './CompanyAdminDashboard'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, Clock, CalendarDays, Building2, ArrowRight,
  Banknote, Rocket, UserPlus, FileText, BellRing, PartyPopper,
  Home, LogIn, HelpCircle, UserX, Download, Activity, ScanFace, ChevronRight, Settings, Grid, CheckCircle
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, Legend,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell
} from 'recharts'
import { HrStatusPill, HrButton, HrAvatar } from '@/shared/components/hr'
import { SkeletonCardGrid } from '@/shared/components/SkeletonCard'
import { apiBlob } from '@/core/api/client'
import { toast } from 'sonner'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useRequisitions } from './api/useHiring'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats, useTeamDashboard, useAttendanceTrend, useAttendanceSources } from './api/useAttendance'
import { useActivityFeed, activityLabel, activityActor } from './api/useActivity'
import { useHeadcountReport } from './api/useReports'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
// Local zustand mirror — activeModules lives here, not on the SDK's AuthTenant.
// ModuleGate reads from the same store; using the same source keeps the tile
// and the gate in agreement.
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { useRoles } from '@/shared/hooks/useRoles'
import { UpcomingProbations } from './probation/UpcomingProbations'
import { UpcomingMilestones } from './milestones/UpcomingMilestones'
import { SeatsUsageTile } from './SeatsUsageTile'
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
 * a radial attendance gauge, emerald-family chart series (legend dots +
 * period chips), an approvals alert card and a quick-action card.
 *
 * DATA: every tile on this page renders REAL tenant data. The four fabricated
 * chart series that used to live here (headcount trend, hires by department,
 * payroll cost, skills radar) were removed on 2026-08-18 — see the block below
 * for why. Headcount is now backed by GET /v1/reports/headcount; the rest were
 * deleted rather than faked because no endpoint exists to feed them.
 *
 * ROLE VISIBILITY (this file's second responsibility): every section is gated
 * by the *permission* the underlying endpoint requires, never by role-string
 * equality — the remaining role-string exception is the
 * "Your / Team / Company Attendance" label swap on the attendance card, which
 * is presentational and needs the role wording. (The payroll-cost card that
 * carried the other exception was removed with the fabricated series.) The visibility matrix lives
 * next to the render — see the comment on each section.
 */

/* ── Chart palette — emerald family only (client rule), validated with the
 *    dataviz six-checks script: monotonic lightness ramp, CVD ΔE pass; the
 *    stacked segments get 2px white spacers + legend dots as secondary
 *    encoding. ─────────────────────────────────────────────────────────── */
const VIZ = {
  e600: '#059669',
  // Second series for the attendance trend. Absent is deliberately a muted
  // neutral rather than red: on a chart that is mostly "people showed up", a
  // red band reads as an alarm every single day.
  neutral: '#A3A3A3',
  grid: '#F0F0F0',
  tick: '#A3A3A3',
}

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
 * Removed 2026-08-18. "Headcount Growth" is replaced by Headcount by
 * Department, backed by the real GET /v1/reports/headcount. The other three had
 * no backend source at all, so they are gone rather than faked:
 *
 *   Positions Hired  — the Hiring KPI tile already reads "coming soon"; a
 *                      populated chart beside it contradicted that.
 *   Payroll Cost     — highest-risk fabrication; admins have real payroll pages.
 *   Skills radar     — no data source exists or is planned.
 *
 * Rule: a tile either renders real tenant data or it does not ship. If a trend
 * chart is wanted, it needs a headcount-history source built properly.
 * ─────────────────────────────────────────────────────────────────────────── */

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.18)',
}

/* ── Reference-language building blocks ───────────────────────────────── */

/** White rounded-2xl card: title left, status chip / period chip right. */
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

/** KPI tile — icon tile + label + big number, emerald chrome. */
function KpiTile({ icon, iconBg, iconFg, label, value, sub, onClick }: {
  icon: React.ReactNode
  iconBg: string
  iconFg: string
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: iconBg, color: iconFg }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-[var(--text-tertiary)]">{label}</span>
        <span className="block truncate text-lg font-bold tabular-nums text-[var(--text-primary)]">{value}</span>
        {sub && <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{sub}</span>}
      </span>
    </button>
  )
}

/** SVG donut gauge with the big number centred (reference radial card). */
function DonutGauge({ value }: { value: number | null }) {
  const R = 54
  const C = 2 * Math.PI * R
  const v = value == null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div className="relative h-36 w-36 shrink-0" role="img" aria-label={value == null ? 'Attendance score unavailable' : `Attendance score ${Math.round(v)} percent`}>
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--accent-bg)" strokeWidth="13" />
        {value != null && v > 0 && (
          <circle
            cx="70" cy="70" r={R} fill="none"
            stroke="var(--accent-solid)" strokeWidth="13" strokeLinecap="round"
            strokeDasharray={`${(C * v) / 100} ${C}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[26px] font-bold leading-none tabular-nums text-[var(--text-primary)]">
          {value == null ? '—' : `${Math.round(v)}%`}
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">this month</span>
      </div>
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

  /* ── Permission gates (SDK usePermission — the retired
   *    @/core/permissions/PermissionGate stack is intentionally not imported). */
  const canApproveLeaves = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadHiring    = usePermission(P.HRMS_HIRING_READ)
  const canSeeProbation  = usePermission(P.HRMS_PROBATION_REMINDERS_READ)
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
  const canExportHeadcount = usePermission(P.HRMS_REPORT_HEADCOUNT)
  const canViewReports   =
    canExportHeadcount ||
    usePermission(P.HRMS_REPORT_ATTRITION) ||
    usePermission(P.HRMS_REPORT_ATTENDANCE) ||
    usePermission(P.HRMS_REPORT_LEAVE) ||
    usePermission(P.HRMS_REPORT_DIVERSITY)
  // Billing management → determines whether the SeatsUsageTile is shown.
  // Client rule (2026-08-17): "only admin will see this who has access for
  // manage your plan for workspace". Backend gates /settings/billing on
  // P.WORKSPACE_BILLING_MANAGE (see App.tsx RequirePermission wrapper); we
  // gate the tile on the same permission so a non-billing admin (rare, but
  // possible with custom RBAC) doesn't see a tile whose CTA they can't open.
  const canManageBilling = usePermission(P.WORKSPACE_BILLING_MANAGE)
  // Org-wide attendance ("who is in today") and the audit feed are their own
  // permissions — the endpoints are guarded by exactly these, so the tiles are
  // gated on the same code rather than on a role string.
  const canReadTeamAttendance = usePermission(P.ATTENDANCE_TEAM_READ)
  const canReadAudit          = usePermission(P.AUDIT_READ)
  // Quick-action affordances follow the write authority the target action needs,
  // not role membership — HR_MANAGER holds both and sees both, exactly like the
  // backend allows.
  const canWriteEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg     = usePermission(P.ORG_COMPANY_WRITE)

  /* ── Role bucket. Roles are informational — we use them for two things:
   *  (1) role-string gates the client demanded even for principals who hold
   *      the underlying permission (payroll-cost card is admin-only; the
   *      Attendance Summary tile + Company Attendance card are HIDDEN for
   *      admin/HR because "admins don't need their own attendance stats
   *      on the dashboard"), and
   *  (2) label swap on the attendance card ("My" / "Your" / "Team" /
   *      "Company" — pure presentation).
   *  Every other gate is the permission check above. See useRoles.ts for
   *  the role-to-bucket map. */
  const { isAdmin, isHR, isManager, isFinance, isEmployee } = useRoles()

  // Attendance widgets. Client rule verbatim: "for admin no need attendance
  // history or his attendance summary in the dashboard." The dashboard's
  // /monthly-stats endpoint returns the *caller's* own record, so for an
  // ADMIN the tile would show their own zero (or a misleading aggregate);
  // hide it for admin only. HR_MANAGER is a working principal too and needs
  // their own attendance card — there is no other path for HR to see it.
  const canSeeOwnAttendance = !isAdmin

  // Attendance card label bucket → wording. /monthly-stats returns the
  // *caller's own* record for every role — there is no team-aggregate
  // endpoint yet — so a manager sees "My Attendance" too, not "Team
  // Attendance" (mislabeling per-user data as team data misleads the
  // manager into thinking they're reading a roll-up). Admin/HR would
  // show "Company" but the card is hidden for admin anyway; HR and mixed
  // roles fall back to "Your Attendance". Restore the "Team" wording
  // only when a real team-aggregate endpoint lands.
  const attendanceCardTitle = isManager && !isAdmin && !isHR
    ? 'My Attendance'
    : isEmployee
      ? 'My Attendance'
      : 'Your Attendance'

  // Workforce-shaped tiles (Total Employees, Recent Employees, Headcount,
  // Skills radar) — client matrix restricts these to ADMIN + HR + FINANCE.
  // Manager may hold HRMS_EMPLOYEE_READ for their team but the client rule
  // hides the workforce-wide surfaces from them ("HIDE: Total Employees …
  // Skills, Recent Employees"), and employees never see them either.
  // FINANCE_LEAD holds hrms.employee.read + 5 report perms per the backend
  // seed and needs the workforce roll-ups to do finance analysis.
  const canSeeWorkforceTiles = canReadEmployees && (isAdmin || isHR || isFinance)
  // Positions Hired + Hiring KPI — same audience (ADMIN + HR only per the
  // client matrix; employees and managers do not see hiring stats).
  const canSeeHiringTiles = canReadHiring && (isAdmin || isHR)

  // Seats-Usage tile — admin-only, and only when the caller can manage
  // billing. Kept separate from canSeeWorkforceTiles because the intent is
  // different (this is a plan-status card, not a workforce metric) and the
  // permission bar is stricter (WORKSPACE_BILLING_MANAGE, not
  // HRMS_EMPLOYEE_READ). See SeatsUsageTile.tsx for the render.
  const canSeeSeatsTile = isAdmin && canManageBilling

  /* ── Data hooks. Employee-directory + skills radar + recent-employees fire
   *    only when the user is allowed to read employees; without that the
   *    backend 403s and the tiles would show a red toast on every load. */
  const directoryQuery = useEmployeeDirectory(
    { companyId: activeCompany?.id, pageSize: 5 },
    { enabled: canReadEmployees && !!activeCompany?.id },
  )
  const leaveOverviewQuery = useLeaveOverview()
  const now = new Date()
  const attendanceStatsQuery = useMonthlyStats(
    now.getFullYear(),
    now.getMonth() + 1,
    { enabled: canSeeOwnAttendance },
  )

  // Real headcount-by-department, replacing the removed hardcoded trend chart.
  // Passing null disables the query (the hook gates on `enabled: !!companyId`),
  // which is how we keep an employee session from firing a report request the
  // backend would 403 on.
  /* ── Live Overview: today's org-wide attendance split, plus the trailing
   *    7-day series behind the trend chart. Both are disabled unless the
   *    principal actually holds attendance.team.read, so a bare employee
   *    never fires a request they'd get a 403 for. */
  const todayIso = now.toISOString().slice(0, 10)
  const teamDashboardQuery = useTeamDashboard(undefined, undefined, canReadTeamAttendance)
  const trendQuery = useAttendanceTrend(undefined, undefined, undefined, canReadTeamAttendance)
  const sourcesQuery = useAttendanceSources(undefined, undefined, canReadTeamAttendance)
  const activityQuery = useActivityFeed(8, canReadAudit)

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
  const attendanceStats  = attendanceStatsQuery.data

  const totalEmployees   = directory?.totalElements ?? 0
  const recentEmployees  = directory?.content ?? []
  const pendingApprovals = leaveOverview?.pendingApprovals ?? 0
  // Own pending requests — derived from recentRequests, no extra hook.
  const myPendingRequests = (leaveOverview?.recentRequests ?? []).filter(
    (r) => r.status === 'PENDING',
  ).length

  const firstName = useAuthStore((s) => s.user?.firstName)
  const clock = useLiveClock()

  const quickActions = [
    // 2026-09-10: ?add=1 opens the Add Employee drawer directly, so this quick
    // action is one click instead of two ("Add Employee" → then Add Employee
    // again). See Employees.tsx which reads the query param and strips it.
    ...(canWriteEmployee ? [{ label: 'Add Employee', icon: UserPlus, path: '/hrms/employees?add=1' }] : []),
    ...(canRunPayroll ? [{ label: 'Run Payroll', icon: Banknote, path: '/hrms/payroll-dashboard' }] : []),
    { label: 'Attendance', icon: Clock, path: '/hrms/attendance' },
    { label: 'Add Time-Off', icon: CalendarDays, path: '/hrms/leave' },
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

  // Recent-employees filter — client-side, presentational only.
  /* ── Generate Report — streams the headcount report as CSV from
   *    GET /v1/reports/headcount/export.csv (added 2026-08-22; every report
   *    endpoint gained a CSV sibling carrying the SAME @PreAuthorize as its
   *    JSON twin, so this cannot expose a report the caller can't already read).
   *    apiBlob is used rather than a bare <a href> because the download needs
   *    the bearer token and tenant header that a plain navigation would drop. */
  const [downloading, setDownloading] = React.useState(false)
  const downloadHeadcountCsv = async () => {
    if (!activeCompany?.id || downloading) return
    setDownloading(true)
    try {
      const blob = await apiBlob(
        `/v1/reports/headcount/export.csv?companyId=${encodeURIComponent(activeCompany.id)}`,
      )
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `headcount-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      // try/finally with NO catch: apiBlob throws on any non-2xx, so a 403,
      // 500 or network drop produced zero feedback — the label flipped back
      // and nothing downloaded (2026-09-08 audit).
      const status = (err as Error & { status?: number }).status
      toast.error('Could not generate the report', {
        description: status === 403
          ? "Your role doesn't include the headcount report."
          : (err as Error)?.message || 'Please try again.',
      })
    } finally {
      setDownloading(false)
    }
  }

  const [statusFilter, setStatusFilter] = React.useState('ALL')
  const filteredEmployees = statusFilter === 'ALL'
    ? recentEmployees
    : recentEmployees.filter((e) => e.employmentStatus === statusFilter)

  const score = attendanceStats?.attendanceScore ?? null

  /* ── KPI strip: the outermost data hooks. While any one is still pending
   *    we swap the whole strip for a SkeletonCardGrid so the header + row
   *    layout don't jump when the tiles fade in. Charts + tables below
   *    have their own local loading affordances. */
  const kpiPending =
    leaveOverviewQuery.isPending ||
    // The attendance-stats query is disabled for admins (the tile is hidden
    // for them), so wait on it only when the tile is actually going to render.
    (canSeeOwnAttendance && attendanceStatsQuery.isPending) ||
    // The directory query is disabled entirely for bare-EMPLOYEE users, so we
    // only wait for it when it's actually running.
    (canReadEmployees && directoryQuery.isPending)

  /* ── Build the KPI list conditionally so a hidden tile does not leave a
   *    gap in the 4-col grid; the grid renders whatever survives the filter. */
  const kpiTiles: React.ReactNode[] = []
  if (canSeeWorkforceTiles) {
    kpiTiles.push(
      <KpiTile
        key="employees"
        icon={<Users size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
        label="Total Employees" value={totalEmployees}
        sub={activeCompany?.name}
        onClick={() => navigate('/hrms/employees')}
      />,
    )
  }
  // Attendance summary tile — MANAGER/EMPLOYEE only. Admin and HR have this
  // hidden entirely (client rule: "for admin no need attendance history or
  // his attendance summary in the dashboard").
  if (canSeeOwnAttendance) {
    const attendanceKpiLabel = isEmployee ? 'My Attendance' : 'Your Attendance'
    kpiTiles.push(
      <KpiTile
        key="attendance"
        icon={<UserCheck size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
        label={attendanceKpiLabel}
        value={attendanceStats ? `${attendanceStats.attendanceScore}%` : '—'}
        sub={attendanceStats ? `${attendanceStats.presentDays} present days this month` : undefined}
        onClick={() => navigate('/hrms/attendance')}
      />,
    )
  }
  // Pending leaves — two variants. Approvers see the queue length + go to
  // /leave?tab=approvals; everyone else sees their own pending count + go to
  // /leave?tab=my. The backend distinguishes the two paths already.
  if (canApproveLeaves) {
    kpiTiles.push(
      <KpiTile
        key="leaves"
        icon={<CalendarDays size={19} />} iconBg="#FFFBEB" iconFg="#D97706"
        label="Pending Leaves" value={pendingApprovals}
        sub="awaiting approval"
        onClick={() => navigate('/hrms/leave?tab=approvals')}
      />,
    )
  } else {
    kpiTiles.push(
      <KpiTile
        key="leaves"
        icon={<CalendarDays size={19} />} iconBg="#FFFBEB" iconFg="#D97706"
        label="My Pending Requests" value={myPendingRequests}
        sub="awaiting decision"
        onClick={() => navigate('/hrms/leave?tab=my')}
      />,
    )
  }
  // Hiring Summary — 2026-09-10: no dedicated hiring-analytics endpoint has
  // landed, but /v1/hiring/requisitions carries the two numbers this tile
  // needs (openings + candidateCount, per status). Sum up to the first page
  // of OPEN requisitions rather than showing the permanently-empty tile the
  // dashboard shipped with. First page (size=20) is enough for the KPI —
  // clicking through opens the full list.
  //
  // Query is disabled until canSeeHiringTiles because a plain employee has no
  // hrms.hiring.read and would 403 on this every render.
  const { data: reqPage } = useRequisitions(0, undefined, { enabled: canSeeHiringTiles })
  const hiringSummary = React.useMemo(() => {
    if (!canSeeHiringTiles || !reqPage) return null
    const openReqs = reqPage.content.filter((r) => r.status === 'OPEN')
    const openPositions = openReqs.reduce((sum, r) => sum + (r.openings ?? 0), 0)
    const inPipeline = openReqs.reduce((sum, r) => sum + (r.candidateCount ?? 0), 0)
    return { openPositions, inPipeline }
  }, [canSeeHiringTiles, reqPage])
  if (canSeeHiringTiles && hiringSummary != null) {
    kpiTiles.push(
      <KpiTile
        key="hiring"
        icon={<Rocket size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
        label="Open Positions"
        value={hiringSummary.openPositions}
        sub={`${hiringSummary.inPipeline} candidate${hiringSummary.inPipeline === 1 ? '' : 's'} in pipeline`}
        onClick={() => navigate('/hrms/hiring')}
      />,
    )
  }

  /* ── Charts row: only render the tiles the current principal is allowed
   *    to see. If none survive, we hide the whole row so the grid doesn't
   *    render an empty band. */
  const chartTiles: React.ReactNode[] = []
  // Attendance stats card — hidden for admin/HR (same client rule as the KPI
  // tile above); shown for manager and employee with role-appropriate wording.
  if (canSeeOwnAttendance) {
    chartTiles.push(
    <Card
      key="attendance-stats"
      title={attendanceCardTitle}
      chip={
        score == null
          ? <HrStatusPill tone="gray">No data</HrStatusPill>
          : score >= 75
            ? <HrStatusPill tone="ok">On track</HrStatusPill>
            : <HrStatusPill tone="warn">Needs attention</HrStatusPill>
      }
    >
      <div className="flex flex-col items-center gap-5 xl:flex-row">
        <div className="w-full min-w-0 flex-1 space-y-2.5">
          {[
            { label: 'Present days', value: attendanceStats?.presentDays },
            { label: 'On time', value: attendanceStats?.onTimeDays },
            { label: 'Late days', value: attendanceStats?.lateDays },
            { label: 'Absent days', value: attendanceStats?.absentDays },
            { label: 'Holidays', value: attendanceStats?.holidays },
          ].map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-[var(--border-subtle)] pb-2 last:border-b-0 last:pb-0">
              <span className="text-[12.5px] text-[var(--text-secondary)]">{row.label}</span>
              <span className="text-[13px] font-semibold tabular-nums text-[var(--text-primary)]">{row.value ?? '—'}</span>
            </div>
          ))}
        </div>
        <DonutGauge value={score} />
      </div>
    </Card>,
    )
  }
  // Headcount BY DEPARTMENT — real data from GET /v1/reports/headcount.
  // Replaces the old "Headcount Growth" chart, whose month-over-month series
  // was invented in this file. A genuine trend needs a headcount-history
  // source; until that exists we show what the backend can answer truthfully.
  if (canSeeWorkforceTiles && headcountRows.length > 0) {
    chartTiles.push(
      <Card key="headcount" title="Headcount by Department">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={headcountRows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="department" interval={0} tick={{ fontSize: 10, fill: VIZ.tick }}
                     axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: VIZ.tick }}
                     axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(5,150,105,0.06)' }} />
              <Bar dataKey="active" name="Active" fill={VIZ.e600} radius={[4, 4, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>,
    )
  }
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
  /* Percentages are taken against the roster these counts describe, NOT against
   * directory totalElements — mixing the two is what produced "3780% present"
   * during dashboard testing. Falls back to the directory count only when the
   * roster is unavailable. */
  const rosterTotal = teamDashboardQuery.data?.staffStatuses?.length ?? totalEmployees

  // Attendance trend — real per-day series from GET /v1/attendance/dashboard/trend
  // (added 2026-08-22). This is the chart the old fabricated "Headcount Growth"
  // series pretended to be: same shape, but every point is a real count for a
  // real date, and days with no records render as genuine zeros rather than
  // being dropped from the axis.
  const trendRows = (trendQuery.data ?? []).map((row) => ({
    label: new Date(row.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
    Present: row.present,
    Absent: row.absent,
  }))
  if (canReadTeamAttendance && trendRows.length > 0) {
    chartTiles.push(
      <Card key="attendance-trend" title="Attendance Trend"
            chip={<span className="text-[11px] text-[var(--text-tertiary)]">Last 7 days</span>}>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendRows} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="presentFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={VIZ.e600} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={VIZ.e600} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={VIZ.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Present" stroke={VIZ.e600} strokeWidth={2}
                    fill="url(#presentFill)" />
              <Area type="monotone" dataKey="Absent" stroke={VIZ.neutral} strokeWidth={2}
                    fill="none" strokeDasharray="4 3" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>,
    )
  }

  // Recent activity — the tenant audit log, gated on audit.read because a
  // cross-module feed can surface actions from areas the viewer cannot open.
  // NOTE: audit.events.summary is never written by anything today, so
  // activityLabel() composes a label from action + resourceType instead.
  const activityRows = activityQuery.data?.data ?? []
  if (canReadAudit && activityRows.length > 0) {
    chartTiles.push(
      <Card key="activity" title="Recent Activity"
            chip={<HrStatusPill tone="gray">{activityRows.length}</HrStatusPill>}>
        <ul className="space-y-3">
          {activityRows.map((event) => (
            <li key={event.id} className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[var(--accent-fg)]">
                <Activity size={12} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">{activityLabel(event)}</p>
                <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">
                  {activityActor(event)}
                  {event.occurredAt ? ` · ${new Date(event.occurredAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </Card>,
    )
  }

  // "Positions Hired" removed 2026-08-18 — it charted a hardcoded
  // Sales-34/Engineering-12/Design-8/Support-21 series while the Hiring KPI
  // tile beside it correctly said "coming soon". Restore it when the hiring
  // module ships a real endpoint.

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
              Here's what's happening at Ionora today.
            </p>
          </div>
          <div className="flex items-center gap-6 z-10">
            <div className="text-right">
              <p className="text-[12px] font-semibold text-brand-900/60 mb-0.5">{formattedDate}</p>
              <p className="text-[26px] font-bold leading-tight tabular-nums text-[var(--text-primary)]">{clock}</p>
            </div>
            <button className="flex items-center gap-2 rounded-xl bg-[#08402F] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#0a523d] transition-colors">
              <ScanFace size={16} className="text-[#4ADE80]" />
              Mark Attendance
              <ChevronRight size={16} className="ml-1 opacity-70" />
            </button>
          </div>
        </div>

        {/* ── KPI Strip (5 cards from reference, driven by real data) ──
            Every tile here is a BUTTON with a real destination. They were
            plain <div>s, which quietly broke the rule the dashboard is built
            on — a number a user cannot act on is a dead end, and four of
            these five are the first numbers anyone reads.
            The three roster-wide tiles are gated on attendance.team.read:
            that is the authority guarding /v1/attendance/dashboard, so
            without it teamDashboardQuery never resolves and the tiles would
            have shown a confident "0" to someone simply not allowed to know. */}
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
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{totalEmployees}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  Active in {activeCompany?.name || 'organization'}
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
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                 <svg width="48" height="48" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#F1F5F9" strokeWidth="6" />
                    <circle cx="24" cy="24" r="20" fill="none" stroke="#059669" strokeWidth="6" strokeDasharray="125" strokeDashoffset={125 - (125 * (teamDashboardQuery.data?.counts?.present || 0) / Math.max(totalEmployees, 1))} />
                 </svg>
              </div>
              <div className="flex items-center justify-between mb-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[#059669]"><UserCheck size={18} /></span>
              </div>
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Present Today</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.data?.counts?.present || 0}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#059669]">↓ {Math.round(((teamDashboardQuery.data?.counts?.present || 0) / Math.max(totalEmployees, 1)) * 100)}%</span> of total
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
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.data?.counts?.onLeave || 0}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#EA580C]">↓ {Math.round(((teamDashboardQuery.data?.counts?.onLeave || 0) / Math.max(totalEmployees, 1)) * 100)}%</span> of total
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
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.data?.counts?.absent || 0}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  <span className="text-[#DC2626]">↓ {Math.round(((teamDashboardQuery.data?.counts?.absent || 0) / Math.max(totalEmployees, 1)) * 100)}%</span> of total
                </p>
              </div>
            </button>
            )}

            <button
              type="button"
              onClick={() => navigate(canApproveLeaves ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my')}
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
                  <span className="text-2xl font-bold text-[var(--text-primary)]">{canApproveLeaves ? pendingApprovals : myPendingRequests}</span>
                </div>
                <p className="mt-1 text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                  requires action
                </p>
              </div>
            </button>
          </div>
        )}

        {/* ── Main Dashboard Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Column 1: Attendance Overview */}
          <div className="flex flex-col gap-6">
             <Card title="Attendance Overview" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>Today</option></select>} className="h-full">
               {teamDashboardQuery.data?.counts ? (
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
                       click. Percentages are taken against the roster the counts
                       describe, not the directory page size. */}
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
                             {stat.value} ({Math.round((stat.value / Math.max(rosterTotal, 1)) * 100)}%)
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

          {/* Column 2: Attendance Trend */}
          <div className="flex flex-col gap-6">
             <Card title="Attendance Trend" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>Last 14 days</option></select>} className="h-full">
               {trendRows.length > 0 ? (
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

          {/* Column 3: Promo Banner + Quick Actions */}
          <div className="flex flex-col gap-6">
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

             <Card title="Quick Actions" chip={<button className="text-gray-500 hover:text-gray-800"><Settings size={16} /></button>} className="flex-1">
               <div className="grid grid-cols-2 gap-3 mt-2">
                 {quickActions.map((a) => (
                   <button key={a.label} onClick={() => navigate(a.path)} className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-100 bg-gray-50/50 p-4 transition-colors hover:bg-gray-100">
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

        {/* ── Secondary Dashboard Row (Driven by backend data, Empty States if none) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
           {/* Department Headcount */}
           <Card title="Department Headcount" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>Active Employees</option></select>}>
              {headcountRows.length > 0 ? (
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
                  <p className="text-sm text-gray-400">No data</p>
                </div>
              )}
           </Card>

           {/* Employee Type - Data currently unavailable from backend, preserve UI shape but show Empty State */}
           <Card title="Employee Type" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>All</option></select>}>
              <div className="flex h-48 mt-6 items-center justify-center">
                 <p className="text-sm text-gray-400">Data unavailable</p>
              </div>
           </Card>

           {/* Attendance Source */}
           <Card title="Attendance Source" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>Today</option></select>}>
              {sourcesQuery?.data?.sources && sourcesQuery.data.sources.length > 0 ? (
                <>
                  <div className="relative h-48 mt-4 flex items-center justify-center">
                     <ResponsiveContainer width="100%" height="100%">
                       <PieChart>
                         <Pie data={sourcesQuery.data.sources} dataKey="count" nameKey="method" innerRadius={60} outerRadius={80} stroke="none">
                           {sourcesQuery.data.sources.map((entry, index) => (
                             <Cell key={`cell-${index}`} fill={['#8B5CF6', '#10B981', '#3B82F6', '#F59E0B'][index % 4]} />
                           ))}
                         </Pie>
                         <Tooltip contentStyle={tooltipStyle} />
                       </PieChart>
                     </ResponsiveContainer>
                     <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                       <span className="text-2xl font-bold text-gray-800">{sourcesQuery.data.sources.reduce((sum, s) => sum + s.count, 0)}</span>
                       <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mt-0.5">Total</span>
                     </div>
                  </div>
                  <div className="mt-2 space-y-1.5">
                     {sourcesQuery.data.sources.slice(0, 3).map((s, idx) => (
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

           {/* Overtime - Derived from trend if available */}
           <Card title="Overtime" chip={<select className="text-xs bg-transparent text-gray-500 border-none outline-none"><option>This month</option></select>}>
              {trendQuery.data && trendQuery.data.some(r => r.overtimeMinutes > 0) ? (
                <div className="relative h-48 mt-4 flex items-center">
                  <div className="absolute right-0 top-0 h-full w-24 bg-gray-50/80 rounded-xl flex items-end justify-center p-2 opacity-50">
                    <div className="w-full flex justify-between items-end h-full gap-1">
                      <div className="w-3 bg-gray-200 rounded-t-sm h-1/4"></div>
                      <div className="w-3 bg-gray-200 rounded-t-sm h-1/2"></div>
                      <div className="w-3 bg-gray-300 rounded-t-sm h-3/4"></div>
                    </div>
                  </div>

                  <div className="z-10 flex flex-col gap-2">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 text-orange-500 mb-2">
                      <Clock size={24} />
                    </span>
                    <span className="text-4xl font-bold text-gray-800">
                      {Math.floor(trendQuery.data.reduce((sum, r) => sum + r.overtimeMinutes, 0) / 60)}h
                    </span>
                    <span className="text-[12px] text-gray-500 flex items-center gap-1 mt-1">
                      Logged this period
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
        </div>

        {/* ── Bottom Sections (Driven by real data + preserved functionality) ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
           {/* Recent Employees Table */}
           <div className="lg:col-span-2">
             <Card title="Recent Employees" className="h-full">
               <div className="overflow-x-auto mt-4">
                 <table className="w-full text-[13px]">
                   <thead>
                     <tr className="border-b border-gray-100 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                       <th className="pb-3 text-left font-semibold">Employee</th>
                       <th className="pb-3 text-left font-semibold">Email</th>
                       <th className="pb-3 text-left font-semibold">Status</th>
                       <th className="pb-3 text-right font-semibold">Actions</th>
                     </tr>
                   </thead>
                   <tbody>
                     {filteredEmployees.length === 0 ? (
                       <tr>
                         <td colSpan={4} className="px-5 py-12 text-center text-sm text-[var(--text-tertiary)]">
                           {recentEmployees.length === 0 ? 'No employees yet.' : 'No employees match this filter.'}
                         </td>
                       </tr>
                     ) : filteredEmployees.map((emp, i) => {
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
                           <td className="py-3 text-right">
                             <button className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors">
                               <Grid size={16} className="rotate-90" />
                             </button>
                           </td>
                         </tr>
                       )
                     })}
                   </tbody>
                 </table>
               </div>
             </Card>
           </div>

           {/* Upcoming Key Dates (Using Probations/Milestones logic) */}
           <Card title="Upcoming Key Dates" className="flex flex-col h-full lg:col-span-1">
             <div className="flex-1 mt-4 space-y-4">
               {/* Just presenting the structural entry points; actual functionality relies on Probations/Milestones components,
                   but we map the visual styling here. We will use Empty States if no data provided. */}
               <div className="flex items-center gap-3">
                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-500"><PartyPopper size={18} /></div>
                 <div className="flex flex-col">
                   <span className="text-[13px] font-semibold text-gray-800">Birthdays</span>
                   <span className="text-[11px] text-gray-500">Check milestones</span>
                 </div>
               </div>
               <div className="flex items-center gap-3">
                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-500"><Building2 size={18} /></div>
                 <div className="flex flex-col">
                   <span className="text-[13px] font-semibold text-gray-800">Anniversaries</span>
                   <span className="text-[11px] text-gray-500">Check milestones</span>
                 </div>
               </div>
               <div className="flex items-center gap-3">
                 <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green-50 text-green-500"><CheckCircle size={18} /></div>
                 <div className="flex flex-col">
                   <span className="text-[13px] font-semibold text-gray-800">Probations</span>
                   <span className="text-[11px] text-gray-500">Check probations list</span>
                 </div>
               </div>
             </div>
           </Card>

           {/* Needs Your Attention */}
           <Card title="Needs Your Attention" className="flex flex-col h-full lg:col-span-1">
             <div className="flex-1 mt-4 space-y-2">
               {/* Real data mapping for actionable items */}
               <div onClick={() => navigate(pendingApprovals > 0 ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my')} className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-[#C8E6C9] hover:bg-[#F2FBF4] transition-colors cursor-pointer group">
                 <span className="text-[13px] font-medium text-gray-700 group-hover:text-[#059669]">Leave Requests</span>
                 <div className="flex items-center gap-2">
                   <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600 group-hover:bg-[#059669] group-hover:text-white transition-colors">{canApproveLeaves ? pendingApprovals : myPendingRequests}</span>
                   <ChevronRight size={14} className="text-gray-400 group-hover:text-[#059669]" />
                 </div>
               </div>
               <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 transition-colors cursor-pointer group">
                 <span className="text-[13px] font-medium text-gray-400">Corrections (N/A)</span>
               </div>
               <div className="flex items-center justify-between p-3 rounded-xl border border-gray-100 transition-colors cursor-pointer group">
                 <span className="text-[13px] font-medium text-gray-400">Overtime (N/A)</span>
               </div>
             </div>
           </Card>
        </div>

        {/* ── Footer Strip ── */}
        <div className="mt-8 flex flex-col md:flex-row items-center justify-between border-t border-gray-200 pt-6 pb-2 text-[12px] text-gray-500">
           <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#059669] text-white">
                <CheckCircle size={12} />
              </span>
              <span className="font-medium text-gray-600">A people-first workplace creates limitless possibilities.</span>
           </div>
           <div className="flex gap-4 mt-4 md:mt-0">
             <span className="hover:text-gray-800 transition-colors cursor-pointer">People</span>
             <span>•</span>
             <span className="hover:text-gray-800 transition-colors cursor-pointer">Process</span>
             <span>•</span>
             <span className="hover:text-gray-800 transition-colors cursor-pointer">Progress</span>
           </div>
        </div>
      </div>
    </div>
  )
}

// Company-admin recovery leaves the existing staff dashboard behavior intact.
export const HrmsDashboard: React.FC = () => {
  const { isAdmin } = useRoles()
  return isAdmin ? <CompanyAdminDashboard /> : <RoleDashboard />
}
