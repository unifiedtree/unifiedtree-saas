import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, Clock, CalendarDays, Building2, ArrowRight,
  Banknote, Rocket, UserPlus, FileText, BellRing, PartyPopper,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import { HrStatusPill, HrButton, HrAvatar } from '@/shared/components/hr'
import { SkeletonCardGrid } from '@/shared/components/SkeletonCard'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats } from './api/useAttendance'
import { useHeadcountReport } from './api/useReports'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
import { useRoles } from '@/shared/hooks/useRoles'
import { UpcomingProbations } from './probation/UpcomingProbations'
import { SeatsUsageTile } from './SeatsUsageTile'

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
    <section className={`rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm ${className}`}>
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

export const HrmsDashboard: React.FC = () => {
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
  const canRunPayroll    = usePermission(P.PAYROLL_RUNS_READ)
  // Quick-action "View Reports" — any of the HRMS report perms is enough to
  // land on /hrms/reports without a 403 (the page picks whichever tab the
  // caller can open).
  const canViewReports   =
    usePermission(P.HRMS_REPORT_HEADCOUNT) ||
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
  const { isAdmin, isHR, isManager, isEmployee } = useRoles()

  // Attendance widgets. Client rule verbatim: "for admin no need attendance
  // history or his attendance summary in the dashboard." The dashboard's
  // /monthly-stats endpoint returns the *caller's* own record, so for an
  // ADMIN the tile would show their own zero (or a misleading aggregate);
  // hide it for admin only. HR_MANAGER is a working principal too and needs
  // their own attendance card — there is no other path for HR to see it.
  const canSeeOwnAttendance = !isAdmin

  // Attendance card label bucket → wording. Manager shows their direct
  // reports ("Team"), admin/HR would show "Company" but the card is hidden
  // for them anyway, employees and mixed roles fall back to "My".
  const attendanceCardTitle = isManager && !isAdmin && !isHR
    ? 'Team Attendance'
    : isEmployee
      ? 'My Attendance'
      : 'Your Attendance'

  // Workforce-shaped tiles (Total Employees, Recent Employees, Headcount,
  // Skills radar) — client matrix restricts these to ADMIN + HR. Manager
  // may hold HRMS_EMPLOYEE_READ for their team but the client rule hides
  // the workforce-wide surfaces from them ("HIDE: Total Employees … Skills,
  // Recent Employees"), and employees never see them either.
  const canSeeWorkforceTiles = canReadEmployees && (isAdmin || isHR)
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
    ...(canWriteEmployee ? [{ label: 'Add Employee', icon: UserPlus, path: '/hrms/employees' }] : []),
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

  // Recent-employees filter — client-side, presentational only.
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
  // Hiring Summary — hidden entirely until a real analytics endpoint lands
  // and feeds `hiringSummary` a value. The previous "value='—' sub='coming
  // soon'" placeholder shipped a permanently-empty tile on every login; a
  // truthful dashboard is one that omits tiles it cannot populate.
  const hiringSummary = null as { openPositions: number; inFinalRound: number } | null
  if (canSeeHiringTiles && hiringSummary != null) {
    kpiTiles.push(
      <KpiTile
        key="hiring"
        icon={<Rocket size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
        label="Hiring Summary"
        value={hiringSummary.openPositions}
        sub={`${hiringSummary.inFinalRound} in final round`}
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
  // "Positions Hired" removed 2026-08-18 — it charted a hardcoded
  // Sales-34/Engineering-12/Design-8/Support-21 series while the Hiring KPI
  // tile beside it correctly said "coming soon". Restore it when the hiring
  // module ships a real endpoint.

  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      <div className="mx-auto max-w-7xl space-y-6 p-6 font-sans sm:p-8">

        {/* ── Greeting row: name + (approvers only) live pending count, live
              clock right. Non-approvers never see the "leave approvals
              pending" subtitle — it's noise for them and the wording implies
              an action they can't take. */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text-primary)]">
              {greeting}, {firstName ?? 'there'}!
            </h1>
            {canApproveLeaves && (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                {pendingApprovals > 0
                  ? <>You have <span className="font-semibold text-[var(--accent-fg-strong)]">{pendingApprovals}</span> leave approval{pendingApprovals === 1 ? '' : 's'} pending.</>
                  : 'You have no leave approvals pending.'}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Current time</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums text-[var(--text-primary)]">{clock}</p>
          </div>
        </div>

        {/* ── KPI strip (real data). SkeletonCardGrid stands in while the
              outermost hooks are pending so the header doesn't jump when the
              first tile paints. */}
        {kpiPending ? (
          <SkeletonCardGrid count={Math.max(kpiTiles.length, 1)} />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-4">
            {kpiTiles}
          </div>
        )}

        {/* ── Plan status: Seats-Usage tile. Admin + billing-manager only per
              client rule "only admin will see this who has access for manage
              your plan for workspace". Rendered as its own row so the
              "N of M seats used" is unambiguous — nesting it in the KPI grid
              would compress the progress bar + CTA. Grid caps at 2 columns so
              the tile stays readable on wide screens (paired with room for a
              second billing tile like Subscription Status when that ships). */}
        {canSeeSeatsTile && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SeatsUsageTile />
          </div>
        )}

        {/* ── Row: attendance gauge + trend + comparison ────────────────── */}
        {chartTiles.length > 0 && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {chartTiles}
          </div>
        )}

        {/* ── "Payroll Cost Overview" and "Skills" removed 2026-08-18.
              Both rendered hardcoded arrays defined in this file:
                Payroll — ₹6.8L–10.9L gross across five invented pay periods,
                          with 216–442 "employees paid". Shown to every tenant,
                          including a three-person workspace. Inventing rupee
                          figures inside a payroll product is indefensible, and
                          admins already have the real payroll run pages.
                Skills  — a six-axis radar with no data source in the product
                          at all, present or planned.
              Neither has a backend endpoint, so they are gone rather than
              faked. Reinstate only when a real source exists. ─────────────── */}

        {/* ── Row: recent employees table card + alert / quick actions rail.
              The table is gated on HRMS_EMPLOYEE_READ; the right rail is
              always shown so bare-EMPLOYEE principals still get the
              approvals / quick-action affordance. When the table is hidden,
              the rail spans the full width. */}
        <div className={`grid grid-cols-1 gap-6 ${canSeeWorkforceTiles ? 'lg:grid-cols-3' : ''}`}>
          {canSeeWorkforceTiles && (
            <section className="overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 pt-4">
                <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Recent Employees</h2>
                <HrButton variant="ghost" size="sm" onClick={() => navigate('/hrms/employees')}>
                  View all <ArrowRight size={13} />
                </HrButton>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border-subtle)] px-5 pb-3">
                <label className="flex items-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
                  Status
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-8 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-2 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                  >
                    <option value="ALL">All</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PROBATION">Probation</option>
                  </select>
                </label>
                <span className="ml-auto text-xs tabular-nums text-[var(--text-tertiary)]">
                  {filteredEmployees.length} of {recentEmployees.length} shown
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="bg-[var(--bg-subtle)]">
                      {['Employee', 'Email', 'Status', ''].map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
                          {h}
                        </th>
                      ))}
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
                          <td className="px-5 py-3">
                            <HrAvatar name={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} seed={i} />
                          </td>
                          <td className="px-5 py-3 text-[var(--text-secondary)]">{emp.email}</td>
                          <td className="px-5 py-3">
                            <HrStatusPill tone={status === 'ACTIVE' ? 'ok' : status === 'PROBATION' ? 'warn' : 'gray'}>
                              {status ?? '—'}
                            </HrStatusPill>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <HrButton
                              variant="ghost" size="sm"
                              onClick={(e) => { e.stopPropagation(); navigate(`/hrms/employees/${emp.id}`) }}
                            >
                              View
                            </HrButton>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Right rail: approvals alert + quick actions promo card. Wording
              of the alert card follows the same approver / requester split
              as the KPI tile. */}
          <div className="space-y-6">
            <Card>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#D97706]">
                  {(canApproveLeaves ? pendingApprovals : myPendingRequests) > 0
                    ? <BellRing size={17} />
                    : <PartyPopper size={17} />}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-bg)] text-[var(--accent-fg)]">
                  <CalendarDays size={17} />
                </span>
              </div>
              {canApproveLeaves ? (
                <>
                  <h3 className="mt-3 text-[17px] font-bold tracking-tight text-[var(--text-primary)]">
                    {pendingApprovals > 0
                      ? `${pendingApprovals} approval${pendingApprovals === 1 ? '' : 's'} waiting!`
                      : 'All caught up!'}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                    {pendingApprovals > 0
                      ? `${pendingApprovals === 1 ? 'A leave request is' : 'Leave requests are'} queued for your decision.`
                      : 'No leave approvals pending right now.'}
                  </p>
                  <HrButton
                    className="mt-4 w-full"
                    onClick={() =>
                      navigate(pendingApprovals > 0 ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my')
                    }
                  >
                    {pendingApprovals > 0 ? 'Review leave requests' : 'Open leave overview'}
                  </HrButton>
                </>
              ) : (
                <>
                  <h3 className="mt-3 text-[17px] font-bold tracking-tight text-[var(--text-primary)]">
                    {myPendingRequests > 0
                      ? `${myPendingRequests} request${myPendingRequests === 1 ? '' : 's'} pending`
                      : 'No pending requests'}
                  </h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                    {myPendingRequests > 0
                      ? 'Your leave requests are awaiting approval.'
                      : 'You have no leave requests waiting for a decision.'}
                  </p>
                  <HrButton
                    className="mt-4 w-full"
                    onClick={() => navigate('/hrms/leave?tab=my')}
                  >
                    Open my requests
                  </HrButton>
                </>
              )}
            </Card>

            <Card title="Quick Actions">
              <div className="grid grid-cols-3 gap-2">
                {quickActions.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => navigate(a.path)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-[var(--border-default)] px-1.5 py-3 transition-colors hover:border-[var(--accent-solid)] hover:bg-[var(--accent-bg)]"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-fg)]">
                      <a.icon size={15} />
                    </span>
                    <span className="text-center text-[11px] font-semibold leading-tight text-[var(--text-primary)]">{a.label}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        </div>

        {/* Upcoming probations — gated on the dedicated reminders permission
            so a bare HRMS_EMPLOYEE_READ principal (who can list employees but
            not read the reminders feed) doesn't get a red 403 toast. */}
        {canSeeProbation && <UpcomingProbations />}
      </div>
    </div>
  )
}
