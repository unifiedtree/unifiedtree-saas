import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, Clock, CalendarDays, Building2, ArrowRight,
  Banknote, Rocket, UserPlus, FileText, BellRing, PartyPopper,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import { HrStatusPill, HrButton, HrAvatar } from '@/shared/components/hr'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats } from './api/useAttendance'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
import { UpcomingProbations } from './probation/UpcomingProbations'

/**
 * HRMS home — rebuilt in the reference card language (client-approved
 * screenshot, 2026-08): white rounded-2xl cards with hairline borders on the
 * light ground, title + status-chip headers, a greeting row with a live clock,
 * a radial attendance gauge, emerald-family chart series (legend dots +
 * period chips), an approvals alert card and a quick-action card.
 *
 * DATA: KPI cards, attendance gauge, pending approvals, recent employees and
 * probations are REAL (same hooks as before). The chart SERIES are dummy
 * until the analytics endpoints exist — approved by the client ("dummy data,
 * real screens"). Routes, permissions, hooks and action targets unchanged.
 */

/* ── Chart palette — emerald family only (client rule), validated with the
 *    dataviz six-checks script: monotonic lightness ramp, CVD ΔE pass; the
 *    stacked segments get 2px white spacers + legend dots as secondary
 *    encoding. ─────────────────────────────────────────────────────────── */
const VIZ = {
  e800: '#065F46',
  e600: '#059669',
  e400: '#34D399',
  e200: '#A7F3D0',
  grid: '#F0F0F0',
  tick: '#A3A3A3',
}

/* ── Dummy series (replace with analytics endpoints when they ship) ───── */
const headcountTrend = [
  { m: 'Mar', count: 182 }, { m: 'Apr', count: 189 }, { m: 'May', count: 197 },
  { m: 'Jun', count: 210 }, { m: 'Jul', count: 224 }, { m: 'Aug', count: 236 },
]
const hiresByDept = [
  { dept: 'Sales', hires: 34 }, { dept: 'Engineering', hires: 12 },
  { dept: 'Design', hires: 8 }, { dept: 'Support', hires: 21 },
]
const payrollOverview = [
  { period: 'May 3–16',   gross: 6.8,  reimb: 1.1, benefits: 1.9, taxes: 1.4, employees: 216 },
  { period: 'May 17–30',  gross: 9.6,  reimb: 1.4, benefits: 2.2, taxes: 1.8, employees: 442 },
  { period: 'May 31–13',  gross: 10.9, reimb: 1.7, benefits: 2.4, taxes: 2.0, employees: 305 },
  { period: 'Jun 14–27',  gross: 7.4,  reimb: 1.2, benefits: 2.0, taxes: 1.5, employees: 188 },
  { period: 'Jun 28–11',  gross: 9.1,  reimb: 1.5, benefits: 2.3, taxes: 1.8, employees: 391 },
]
const skillsRadar = [
  { skill: 'Research',    score: 68 }, { skill: 'Deals',    score: 54 },
  { skill: 'Product',     score: 82 }, { skill: 'Negotiation', score: 61 },
  { skill: 'Outreach',    score: 75 }, { skill: 'Pipeline', score: 58 },
]

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

/** Small grey period chip (reference: the "Today" dropdown chip slot). */
function PeriodChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-[var(--bg-subtle)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
      {children}
    </span>
  )
}

/** Legend dot (reference: coloured-dot legends beside the chip). */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-secondary)]">
      <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
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

/** Payroll tooltip — also surfaces the employee count (no second axis). */
function PayrollTip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ dataKey?: string | number; name?: string; value?: number | string; color?: string; payload?: { employees: number } }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div style={tooltipStyle} className="bg-white px-3 py-2.5">
      <p className="mb-1.5 font-semibold text-[var(--text-primary)]">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-6 py-0.5 text-[var(--text-secondary)]">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums font-medium text-[var(--text-primary)]">₹{p.value}L</span>
        </p>
      ))}
      <p className="mt-1.5 flex items-center justify-between gap-6 border-t border-[var(--border-subtle)] pt-1.5 text-[var(--text-secondary)]">
        <span>Employees paid</span>
        <span className="tabular-nums font-medium text-[var(--text-primary)]">{payload[0]?.payload?.employees ?? '—'}</span>
      </p>
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

  const { data: directory } = useEmployeeDirectory({ companyId: activeCompany?.id, pageSize: 5 })
  const { data: leaveOverview } = useLeaveOverview()
  const now = new Date()
  const { data: attendanceStats } = useMonthlyStats(now.getFullYear(), now.getMonth() + 1)

  const totalEmployees = directory?.totalElements ?? 0
  const recentEmployees = directory?.content ?? []
  const pendingLeaves = leaveOverview?.pendingApprovals ?? 0

  const firstName = useAuthStore((s) => s.user?.firstName)
  const clock = useLiveClock()

  // Visibility follows the backend authority the action actually needs, not role
  // membership: createEmployee requires hrms.employee.write; org setup requires
  // org.company.write. So HR_MANAGER (who holds both) sees them, like the backend allows.
  const canWriteEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg = usePermission(P.ORG_COMPANY_WRITE)
  const canSeeProbation = usePermission(P.HRMS_EMPLOYEE_READ)

  const quickActions = [
    ...(canWriteEmployee ? [{ label: 'Add Employee', icon: UserPlus, path: '/hrms/employees' }] : []),
    { label: 'Run Payroll', icon: Banknote, path: '/hrms/payroll-dashboard' },
    { label: 'Attendance', icon: Clock, path: '/hrms/attendance' },
    { label: 'Add Time-Off', icon: CalendarDays, path: '/hrms/leave' },
    ...(canManageOrg ? [{ label: 'Org Setup', icon: Building2, path: '/hrms/organization' }] : []),
    { label: 'View Reports', icon: FileText, path: '/hrms/reports' },
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

  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      <div className="mx-auto max-w-7xl space-y-6 p-6 font-sans sm:p-8">

        {/* ── Greeting row: name + real pending count, live clock right ── */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-[var(--text-primary)]">
              {greeting}, {firstName ?? 'there'}!
            </h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              {pendingLeaves > 0
                ? <>You have <span className="font-semibold text-[var(--accent-fg-strong)]">{pendingLeaves}</span> leave approval{pendingLeaves === 1 ? '' : 's'} pending.</>
                : 'You have no leave approvals pending.'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--text-tertiary)]">Current time</p>
            <p className="text-[26px] font-bold leading-tight tabular-nums text-[var(--text-primary)]">{clock}</p>
          </div>
        </div>

        {/* ── KPI strip (real data) ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            icon={<Users size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
            label="Total Employees" value={totalEmployees}
            sub={activeCompany?.name}
            onClick={() => navigate('/hrms/employees')}
          />
          <KpiTile
            icon={<UserCheck size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
            label="Attendance Summary"
            value={attendanceStats ? `${attendanceStats.attendanceScore}%` : '—'}
            sub={attendanceStats ? `${attendanceStats.presentDays} present days this month` : undefined}
            onClick={() => navigate('/hrms/attendance')}
          />
          <KpiTile
            icon={<CalendarDays size={19} />} iconBg="#FFFBEB" iconFg="#D97706"
            label="Pending Leaves" value={pendingLeaves}
            sub="awaiting approval"
            onClick={() => navigate('/hrms/leave')}
          />
          <KpiTile
            icon={<Rocket size={19} />} iconBg="var(--accent-bg)" iconFg="var(--accent-fg)"
            label="Hiring Summary" value="9 open positions"
            sub="3 in final round"
            onClick={() => navigate('/hrms/hiring')}
          />
        </div>

        {/* ── Row: attendance gauge + trend + comparison ────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Radial gauge card: stat list beside the donut (real data) */}
          <Card
            title="Attendance"
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
          </Card>

          <Card title="Headcount Growth" chip={<PeriodChip>Last 6 months</PeriodChip>}>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={headcountTrend} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="hcFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={VIZ.e600} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={VIZ.e600} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="count" name="Employees" stroke={VIZ.e600} strokeWidth={2} fill="url(#hcFill)" activeDot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Positions Hired" chip={<PeriodChip>This year</PeriodChip>}>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hiresByDept} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="dept" interval={0} tick={{ fontSize: 10, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(5,150,105,0.06)' }} />
                  <Bar dataKey="hires" name="Hires" fill={VIZ.e600} radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── Row: payroll stacked bars + skills radar ──────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card
            title="Payroll Cost Overview"
            className="lg:col-span-2"
            chip={
              <div className="flex flex-wrap items-center gap-3">
                <LegendDot color={VIZ.e800} label="Gross pay" />
                <LegendDot color={VIZ.e600} label="Reimbursements" />
                <LegendDot color={VIZ.e400} label="Benefits" />
                <LegendDot color={VIZ.e200} label="Taxes" />
                <PeriodChip>May – Jun</PeriodChip>
              </div>
            }
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={payrollOverview} margin={{ top: 6, right: 6, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} unit="L" />
                  <Tooltip content={<PayrollTip />} cursor={{ fill: 'rgba(5,150,105,0.05)' }} />
                  <Bar stackId="pay" dataKey="gross"    name="Gross pay"      fill={VIZ.e800} stroke="#fff" strokeWidth={1} maxBarSize={40} />
                  <Bar stackId="pay" dataKey="reimb"    name="Reimbursements" fill={VIZ.e600} stroke="#fff" strokeWidth={1} maxBarSize={40} />
                  <Bar stackId="pay" dataKey="benefits" name="Benefits"       fill={VIZ.e400} stroke="#fff" strokeWidth={1} maxBarSize={40} />
                  <Bar stackId="pay" dataKey="taxes"    name="Taxes"          fill={VIZ.e200} stroke="#fff" strokeWidth={1} maxBarSize={40} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Skills" chip={<PeriodChip>Team average</PeriodChip>}>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={skillsRadar} outerRadius="62%">
                  <PolarGrid stroke={VIZ.grid} />
                  <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: VIZ.tick }} />
                  <Radar dataKey="score" name="Team avg" stroke={VIZ.e600} fill={VIZ.e600} fillOpacity={0.22} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── Row: recent employees table card + alert / quick actions ─── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Reference table card: filter row inside, grey header, outline row buttons */}
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

          {/* Right rail: approvals alert + quick actions promo card */}
          <div className="space-y-6">
            <Card>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFFBEB] text-[#D97706]">
                  {pendingLeaves > 0 ? <BellRing size={17} /> : <PartyPopper size={17} />}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--accent-bg)] text-[var(--accent-fg)]">
                  <CalendarDays size={17} />
                </span>
              </div>
              <h3 className="mt-3 text-[17px] font-bold tracking-tight text-[var(--text-primary)]">
                {pendingLeaves > 0
                  ? `${pendingLeaves} approval${pendingLeaves === 1 ? '' : 's'} waiting!`
                  : 'All caught up!'}
              </h3>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
                {pendingLeaves > 0
                  ? `${pendingLeaves === 1 ? 'A leave request is' : 'Leave requests are'} queued for your decision.`
                  : 'No leave approvals pending right now.'}
              </p>
              <HrButton className="mt-4 w-full" onClick={() => navigate('/hrms/leave')}>
                {pendingLeaves > 0 ? 'Review leave requests' : 'Open leave overview'}
              </HrButton>
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

        {/* Upcoming probations */}
        {canSeeProbation && <UpcomingProbations />}
      </div>
    </div>
  )
}
