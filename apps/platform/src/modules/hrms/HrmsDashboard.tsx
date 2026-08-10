import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users, UserCheck, Clock, CalendarDays, Building2, Plus, ArrowRight,
  Banknote, Rocket, UserPlus, FileText,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, ComposedChart, Line,
  XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from 'recharts'
import { HrStatusPill, HrButton, TableCard, HrAvatar } from '@/shared/components/hr'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats } from './api/useAttendance'
import { usePermission, P } from '@unifiedtree/sdk'
import { UpcomingProbations } from './probation/UpcomingProbations'

/**
 * HRMS home — the Keka-style analytics board.
 *
 * Layout: fixed header → KPI summary strip → charts grid (trend + comparison +
 * quick actions) → payroll composed chart + skills radar → recent employees +
 * probations. Charts use a deliberately multi-colour palette (violet, indigo,
 * amber, sky, emerald) so the board reads lively against the emerald chrome —
 * the client's rule: brand emerald for the frame, colour for the data.
 *
 * DATA: KPI cards, recent employees, probations and pending leaves are REAL
 * (same hooks as before). The chart SERIES are dummy until the analytics
 * endpoints exist — approved by the client on 2026-08-11 ("dummy data, real
 * screens").
 */

/* ── Chart palette (data viz only — the chrome stays emerald) ─────────── */
const VIZ = {
  violet:  '#7C6FF0',
  violetSoft: '#C7C2F9',
  indigo:  '#6366F1',
  sky:     '#38BDF8',
  amber:   '#F59E0B',
  emerald: '#10B981',
  rose:    '#F472B6',
  grid:    '#EEF0F4',
  tick:    '#9CA3AF',
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
  { skill: 'Market Research',   score: 68 }, { skill: 'Deal Structuring', score: 54 },
  { skill: 'Product Knowledge', score: 82 }, { skill: 'Negotiation',      score: 61 },
  { skill: 'Communication',     score: 75 }, { skill: 'Pipeline Mgmt',    score: 58 },
]

const tooltipStyle: React.CSSProperties = {
  fontSize: 12, borderRadius: 10, border: '1px solid #E5E7EB',
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.18)',
}

/* ── KPI summary card (Keka's top strip) ──────────────────────────────── */
function SummaryCard({ icon, iconBg, iconFg, label, value, sub, onClick }: {
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
      className="flex items-center gap-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3.5 text-left shadow-sm transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
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

/* ── Chart card frame ─────────────────────────────────────────────────── */
function ChartCard({ title, action, children, className = '' }: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-tight text-[var(--text-primary)]">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  )
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

  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      {/* ── Fixed header — stays put while the board scrolls ────────────── */}
      <div className="sticky top-0 z-20 border-b border-[var(--border-default)] bg-[var(--bg-surface-overlay,rgba(255,255,255,0.85))] px-6 py-4 backdrop-blur-xl sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-[var(--accent-fg)]">{greeting}</p>
            <h1 className="truncate text-xl font-bold tracking-tight text-[var(--text-primary)]">
              HRMS Overview
              {activeCompany && <span className="ml-2 text-sm font-medium text-[var(--text-tertiary)]">· {activeCompany.name}</span>}
            </h1>
          </div>
          <HrButton onClick={() => navigate('/hrms/employees')}>
            <Plus size={15} /> Add employee
          </HrButton>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 p-6 font-sans sm:p-8">
        {/* ── KPI summary strip (real data) ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard
            icon={<Users size={19} />} iconBg="#ECFDF5" iconFg="#059669"
            label="Total Employees" value={totalEmployees}
            sub={activeCompany?.name}
            onClick={() => navigate('/hrms/employees')}
          />
          <SummaryCard
            icon={<UserCheck size={19} />} iconBg="#EEF2FF" iconFg={VIZ.indigo}
            label="Attendance Summary"
            value={attendanceStats ? `${attendanceStats.attendanceScore}%` : '—'}
            sub={attendanceStats ? `${attendanceStats.presentDays} present days this month` : undefined}
            onClick={() => navigate('/hrms/attendance')}
          />
          <SummaryCard
            icon={<CalendarDays size={19} />} iconBg="#FFFBEB" iconFg={VIZ.amber}
            label="Pending Leaves" value={pendingLeaves}
            sub="awaiting approval"
            onClick={() => navigate('/hrms/leave')}
          />
          <SummaryCard
            icon={<Rocket size={19} />} iconBg="#F5F3FF" iconFg={VIZ.violet}
            label="Hiring Summary" value="9 open positions"
            sub="3 in final round"
            onClick={() => navigate('/hrms/hiring')}
          />
        </div>

        {/* ── Row: trend + comparison + quick actions ───────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ChartCard
            title="Headcount Growth"
            action={<HrButton variant="ghost" size="sm" onClick={() => navigate('/hrms/reports')}>View all</HrButton>}
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={headcountTrend} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="hcFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={VIZ.violet} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={VIZ.violet} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="m" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="count" name="Employees" stroke={VIZ.violet} strokeWidth={2.5} fill="url(#hcFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard
            title="Positions Hired"
            action={<HrButton variant="ghost" size="sm" onClick={() => navigate('/hrms/hiring')}>View all</HrButton>}
          >
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hiresByDept} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="dept" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(124,111,240,0.06)' }} />
                  <Bar dataKey="hires" name="Hires" fill={VIZ.violet} radius={[6, 6, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          {/* Quick actions — Keka's right-rail list, permissions preserved */}
          <ChartCard title="Quick Actions">
            <div className="space-y-1">
              {quickActions.map((a) => (
                <button
                  key={a.label}
                  onClick={() => navigate(a.path)}
                  className="group flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--bg-subtle)]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-fg)] transition-colors group-hover:bg-[var(--accent-solid)] group-hover:text-white">
                    <a.icon size={15} />
                  </span>
                  <span className="flex-1 text-[13.5px] font-semibold text-[var(--text-primary)]">{a.label}</span>
                  <ArrowRight size={14} className="text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              ))}
            </div>
          </ChartCard>
        </div>

        {/* ── Row: payroll composed chart + skills radar ────────────────── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ChartCard title="Payroll Cost Overview" className="lg:col-span-2">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={payrollOverview} margin={{ top: 6, right: 6, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke={VIZ.grid} vertical={false} />
                  <XAxis dataKey="period" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="cost" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} unit="L" />
                  <YAxis yAxisId="emp" orientation="right" tick={{ fontSize: 11, fill: VIZ.tick }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="cost" stackId="pay" dataKey="gross"    name="Gross pay"         fill={VIZ.violet}     radius={[0, 0, 0, 0]} maxBarSize={42} />
                  <Bar yAxisId="cost" stackId="pay" dataKey="reimb"    name="Reimbursements"    fill={VIZ.indigo} />
                  <Bar yAxisId="cost" stackId="pay" dataKey="benefits" name="Employee benefits" fill={VIZ.violetSoft} />
                  <Bar yAxisId="cost" stackId="pay" dataKey="taxes"    name="Employee taxes"    fill={VIZ.sky}        radius={[6, 6, 0, 0]} />
                  <Line yAxisId="emp" type="monotone" dataKey="employees" name="Employee count" stroke={VIZ.amber} strokeWidth={2.5} dot={{ r: 3.5, fill: VIZ.amber }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Skills">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={skillsRadar} outerRadius="72%">
                  <PolarGrid stroke={VIZ.grid} />
                  <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: VIZ.tick }} />
                  <Radar dataKey="score" name="Team avg" stroke={VIZ.violet} fill={VIZ.violet} fillOpacity={0.28} />
                  <Tooltip contentStyle={tooltipStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        </div>

        {/* ── Recent employees (real) ───────────────────────────────────── */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-md font-semibold tracking-tight text-[var(--text-primary)]">Recent Employees</h2>
            <HrButton variant="ghost" size="sm" onClick={() => navigate('/hrms/employees')}>
              View all <ArrowRight size={13} />
            </HrButton>
          </div>
          <TableCard>
            <table className="hr-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Email</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-12 text-center text-sm text-[var(--text-tertiary)]">
                      No employees yet.
                    </td>
                  </tr>
                ) : recentEmployees.map((emp, i) => {
                  const status = emp.employmentStatus
                  return (
                    <tr
                      key={emp.id}
                      onClick={() => navigate(`/hrms/employees/${emp.id}`)}
                      className="cursor-pointer"
                    >
                      <td>
                        <HrAvatar name={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} seed={i} />
                      </td>
                      <td className="text-[var(--text-secondary)]">{emp.email}</td>
                      <td>
                        <HrStatusPill
                          tone={status === 'ACTIVE' ? 'ok' : status === 'PROBATION' ? 'warn' : 'gray'}
                        >
                          {status ?? '—'}
                        </HrStatusPill>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableCard>
        </div>

        {/* Upcoming probations */}
        {canSeeProbation && <UpcomingProbations />}
      </div>
    </div>
  )
}
