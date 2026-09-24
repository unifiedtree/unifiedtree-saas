import { ProjectProductivity } from './dashboard/ProjectProductivity'
import { CompanyNotices } from './dashboard/CompanyNotices'
import { CompanySummary } from './dashboard/CompanySummary'
import { Performers, OnboardingTracker, HiringProgress, PayrollTrend } from './dashboard/OperationalWidgets'
import { attendanceDate } from './attendance/date'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Clock, CalendarDays, Building2, ArrowRight, Banknote, UserPlus, FileText, Download, Activity,
  Users, UserCheck, UserMinus, AlertCircle, Home, HelpCircle, UserX,
  Briefcase, ClipboardCheck, Receipt, Brain, Bot, Flame, Lightbulb
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, Legend,
  XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell
} from 'recharts'
import { HrStatusPill, HrButton, HrAvatar } from '@/shared/components/hr'
import { apiBlob } from '@/core/api/client'
import { toast } from 'sonner'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useRequisitions } from './api/useHiring'
import { useLeaveOverview } from './api/useLeave'
import { useTeamDashboard, useAttendanceTrend, useCorrectionApprovals } from './api/useAttendance'
import { usePendingDocumentQueue } from './api/useDocument'
import { useActivityFeed, activityLabel, activityActor } from './api/useActivity'
import { useHeadcountReport } from './api/useReports'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'

import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { UpcomingProbations } from './probation/UpcomingProbations'
import { UpcomingMilestones } from './milestones/UpcomingMilestones'

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

export const CompanyAdminDashboard: React.FC = () => {
  const navigate = useNavigate()
  const canReadPerformance = usePermission('hrms.performance.read')
  // The tracker lists every new joiner's progress: HR/admin only (instance.read
  // is held by every employee for their own onboarding).
  const canReadOnboarding = usePermission('hrms.onboarding.instance.write')
  const { data: companies = [] } = useCompanies()
  const activeCompany = companies[0]

  const canApproveLeaves = usePermission(P.HRMS_LEAVE_APPROVE_L1)
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadHiring    = usePermission(P.HRMS_HIRING_READ)
  const canSeeProbation  = usePermission(P.HRMS_PROBATION_REMINDERS_READ)

  const hasPayrollModule = useLocalAuthStore((s) => s.tenant?.activeModules?.includes('payroll') ?? false)
  const canRunPayroll    = usePermission(P.PAYROLL_RUNS_READ) && hasPayrollModule

  const canExportHeadcount = usePermission(P.HRMS_REPORT_HEADCOUNT)
  const canReportAttrition = usePermission(P.HRMS_REPORT_ATTRITION)
  const canReportAttendance = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const canReportLeave = usePermission(P.HRMS_REPORT_LEAVE)
  const canReportDiversity = usePermission(P.HRMS_REPORT_DIVERSITY)
  const canViewReports = canExportHeadcount || canReportAttrition || canReportAttendance || canReportLeave || canReportDiversity

  const canReadTeamAttendance = usePermission(P.ATTENDANCE_TEAM_READ)
  const canReadAudit          = usePermission(P.AUDIT_READ)
  const canApproveCorrections = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canVerifyDocuments = usePermission('hrms.document.verify' as unknown as Parameters<typeof usePermission>[0])
  const corrections = useCorrectionApprovals('PENDING', { enabled: canApproveCorrections, size: 1 })
  const pendingDocsQuery = usePendingDocumentQueue(canVerifyDocuments)
  const pendingDocsCount = pendingDocsQuery.data?.length ?? 0

  const canWriteEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg     = usePermission(P.ORG_COMPANY_WRITE)

  const canSeeWorkforceTiles = canReadEmployees
  const canSeeHiringTiles = canReadHiring
  const attendanceCardTitle = 'Attendance workspace'

  const directoryQuery = useEmployeeDirectory(
    { companyId: activeCompany?.id, pageSize: 5 },
    { enabled: canReadEmployees && !!activeCompany?.id },
  )
  const leaveOverviewQuery = useLeaveOverview()
  const now = new Date()
  const todayIso = attendanceDate(now)
  const teamDashboardQuery = useTeamDashboard(todayIso, undefined, canReadTeamAttendance)
  const trendQuery = useAttendanceTrend(undefined, todayIso, undefined, canReadTeamAttendance)
  const activityQuery = useActivityFeed(8, canReadAudit)

  const headcountQuery = useHeadcountReport(
    canSeeWorkforceTiles && canExportHeadcount ? (activeCompany?.id ?? null) : null,
  )
  const headcountRows = (headcountQuery.data ?? [])
    .map((r) => ({
      department: r.department ?? 'Unassigned',
      active: Number(r.active ?? 0),
    }))
    .filter((r) => r.active > 0)

  const directory        = directoryQuery.data
  const leaveOverview    = leaveOverviewQuery.data

  const totalEmployees = directoryQuery.isError ? 'Unavailable' : directory?.totalElements ?? 'Loading...'
  const recentEmployees  = directory?.content ?? []
  const pendingApprovals = leaveOverview?.pendingApprovals ?? 0

  const firstName = useAuthStore((s) => s.user?.firstName)

  const quickActions = [
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

  const { data: reqPage, isError: hiringError } = useRequisitions(0, undefined, { enabled: canSeeHiringTiles })
  const oCounts = teamDashboardQuery.data?.counts
  const rosterTotal = teamDashboardQuery.data?.staffStatuses.length ?? 0
  const attendanceSlices = [
    { name: 'Regular check-ins', status: 'PRESENT', value: oCounts?.present, fill: '#0F6E56' },
    { name: 'Late arrivals', status: 'LATE', value: oCounts?.late, fill: '#D97706' },
    { name: 'Absent', status: 'ABSENT', value: oCounts?.absent, fill: '#DC2626' },
    { name: 'On leave', status: 'ON_LEAVE', value: oCounts?.onLeave, fill: '#6366F1' },
    { name: 'Work from home', status: 'WORK_FROM_HOME', value: oCounts?.workFromHome, fill: '#0284C7' },
    { name: 'Not marked', status: 'NOT_MARKED', value: oCounts?.notMarked, fill: '#64748B' },
    { name: 'Half day', status: 'HALF_DAY', value: oCounts?.halfDay, fill: '#A16207' },
    { name: 'Early departures', status: 'EARLY_OUT', value: oCounts?.earlyCheckout, fill: '#9333EA' },
  ]
  const trendRows = (trendQuery.data ?? []).map(row => ({
    date: row.date.slice(5), 'Regular check-ins': row.present, Late: row.late, Absent: row.absent,
  }))
  const activityRows = activityQuery.data?.data ?? []
  const openAttendance = (status: string) => navigate(`/hrms/attendance?tab=team&status=${status}&date=${todayIso}`)
  const queryState = (loading: boolean, error: boolean, retry: () => unknown, empty: boolean, children: React.ReactNode) =>
    loading ? <div className="dashboard-state" role="status">Loading...</div>
      : error ? <div className="dashboard-state" role="alert"><p>Unable to load this section.</p><HrButton variant="ghost" onClick={() => retry()}>Try again</HrButton></div>
      : empty ? <div className="dashboard-state">No records for this period.</div> : children

  return <div className="company-dashboard mx-auto max-w-[1680px] space-y-7 p-4 sm:p-6 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">Dashboard Overview</p>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{greeting}, {firstName || 'there'} 👋</h1>
        <p className="mt-2 text-sm text-text-secondary">Your people, priorities and progress, in one place.</p></div>
      <div className="flex flex-wrap items-center gap-3"><span className="rounded-md border border-border-default bg-white px-3 py-2 text-xs text-text-secondary">{formattedDate}</span>
        {canExportHeadcount && <HrButton variant="ghost" disabled={downloading || !activeCompany?.id} onClick={downloadHeadcountCsv}><Download size={15} /> Export headcount</HrButton>}
        {canWriteEmployee && <HrButton onClick={() => navigate('/hrms/employees?add=1')}><UserPlus size={15} /> Add employee</HrButton>}
      </div>
    </div>

    {/* SECTION 1: OVERVIEW KPI WIDGETS */}
    <section aria-label="Live overview" aria-busy={directoryQuery.isLoading || teamDashboardQuery.isLoading}>
      <h2 className="dashboard-section-title flex items-center gap-2 text-[var(--primary)]"><Clock size={18} /> Live Overview</h2>
      
      {/* Top 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4">
        {canReadEmployees && (
          <button className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => navigate('/hrms/employees')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Total Employees</p>
                <div className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{totalEmployees}</div>
                <p className="mt-2 text-[11px] font-medium text-[#059669] flex items-center gap-1"><Activity size={12} /> Employee directory</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]"><Users size={20} /></div>
            </div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('PRESENT')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Present</p>
                <div className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.present ?? 'Loading...'}</div>
                <p className="mt-2 text-[11px] font-medium text-[#059669] flex items-center gap-1"><ArrowRight size={12} className="-rotate-45" /> Checked in today</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#ECFDF5] text-[#059669]"><UserCheck size={20} /></div>
            </div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('ON_LEAVE')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">On Leave</p>
                <div className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.onLeave ?? 'Loading...'}</div>
                <p className="mt-2 text-[11px] font-medium text-[#D97706] flex items-center gap-1"><ArrowRight size={12} className="rotate-45" /> Approved leave today</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#D97706]"><UserMinus size={20} /></div>
            </div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('LATE')}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--text-secondary)]">Late Arrivals</p>
                <div className="mt-1 text-3xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.late ?? 'Loading...'}</div>
                <p className="mt-2 text-[11px] font-medium text-[#DC2626] flex items-center gap-1">Needs attention</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEF2F2] text-[#DC2626]"><AlertCircle size={20} /></div>
            </div>
          </button>
        )}
      </div>

      {/* Bottom 4 KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {canReadTeamAttendance && (
          <button className="flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('HALF_DAY')}>
            <div>
              <p className="text-[13px] font-medium text-[var(--text-secondary)]">Half Day</p>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.halfDay ?? 'Loading...'}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F3E8FF] text-[#9333EA]"><Lightbulb size={20} /></div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('WORK_FROM_HOME')}>
            <div>
              <p className="text-[13px] font-medium text-[var(--text-secondary)]">Work From Home</p>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.workFromHome ?? 'Loading...'}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#EFF6FF] text-[#2563EB]"><Home size={20} /></div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('NOT_MARKED')}>
            <div>
              <p className="text-[13px] font-medium text-[var(--text-secondary)]">Not Marked</p>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.notMarked ?? 'Loading...'}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFF7ED] text-[#EA580C]"><HelpCircle size={20} /></div>
          </button>
        )}
        {canReadTeamAttendance && (
          <button className="flex items-center justify-between rounded-2xl border border-[var(--border-default)] bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md" onClick={() => openAttendance('ABSENT')}>
            <div>
              <p className="text-[13px] font-medium text-[var(--text-secondary)]">Absence</p>
              <div className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{teamDashboardQuery.isError ? 'Unavailable' : oCounts?.absent ?? 'Loading...'}</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FEF2F2] text-[#DC2626]"><UserX size={20} /></div>
          </button>
        )}
      </div>
    </section>

    {/* SECTION 2: ATTENDANCE ANALYTICS */}
    <CompanySummary companyId={activeCompany?.id || ''} />
    {canReadTeamAttendance && <section aria-label="Attendance analytics"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="dashboard-section-title !mb-0 flex items-center gap-2 text-[#059669]"><Clock size={18} /> Attendance Analytics</h2><button onClick={() => navigate(`/hrms/attendance?tab=team&date=${todayIso}`)} className="text-xs font-semibold text-primary">View attendance &rarr;</button></div>
      <div className="grid items-start gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Weekly Attendance Trend" chip={<span className="text-xs text-text-secondary">Last 7 days - IST</span>}>
          {queryState(trendQuery.isPending, trendQuery.isError, trendQuery.refetch, !trendRows.length,
            <div className="h-64" role="img" aria-label="Daily regular, late and absent employee counts"><ResponsiveContainer width="100%" height="100%"><AreaChart data={trendRows} margin={{ top: 15, right: 12, bottom: 0, left: -20 }}>
              <CartesianGrid stroke="#E2E8F0" vertical={false} /><XAxis dataKey="date" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} /><Tooltip /><Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 12 }} />
              <Area dataKey="Regular check-ins" stroke="#0F6E56" fill="#E6F4F1" strokeWidth={2} /><Area dataKey="Late" stroke="#D97706" fill="transparent" strokeWidth={2} /><Area dataKey="Absent" stroke="#DC2626" fill="transparent" strokeWidth={2} />
            </AreaChart></ResponsiveContainer></div>)}
        </Card>
        <Card title="Today's Attendance" chip={<span className="text-xs text-text-secondary">{rosterTotal} employees - IST</span>}>
          {queryState(teamDashboardQuery.isPending, teamDashboardQuery.isError, teamDashboardQuery.refetch, !rosterTotal,
            <><div className="grid grid-cols-2 gap-2">{attendanceSlices.map(stat => <button key={stat.status} onClick={() => openAttendance(stat.status)} className="flex items-center justify-between gap-2 rounded-md border border-border-default p-3 text-left hover:bg-bg-base">
              <span className="flex items-center gap-2 text-xs text-text-secondary"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stat.fill }} />{stat.name}</span><strong className="text-base tabular-nums">{stat.value}</strong>
            </button>)}</div><p className="mt-3 text-[11px] text-text-secondary">Regular check-ins exclude late, WFH and half-day records. Other categories can overlap. Click a count to see who.</p></>)}
        </Card>
      </div>
    </section>}

    {/* SECTION 3: EMPLOYEE ANALYTICS */}
    {canSeeWorkforceTiles && <section aria-label="Employee analytics"><h2 className="dashboard-section-title flex items-center gap-2 text-[#9333EA]"><Users size={18} /> Employee Analytics</h2><div className="grid gap-5 xl:grid-cols-3">
      {canExportHeadcount && <Card title="Dept Distribution">{queryState(headcountQuery.isPending, headcountQuery.isError, headcountQuery.refetch, !headcountRows.length,
        <div className="h-64"><ResponsiveContainer width="100%" height="100%"><BarChart data={headcountRows} layout="vertical" margin={{ left: 0, right: 16 }}><CartesianGrid stroke="#E2E8F0" horizontal={false} /><XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="department" width={100} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="active" name="Active employees" fill="#0F6E56" radius={[0, 3, 3, 0]} maxBarSize={22} /></BarChart></ResponsiveContainer></div>)}</Card>}
      
      {canReadPerformance && <Card title="Top performers"><Performers companyId={activeCompany?.id || ''} /></Card>}
      
      {canReadOnboarding && <Card title="Onboarding tracker"><OnboardingTracker companyId={activeCompany?.id || ''} /></Card>}
    </div></section>}

    {/* SECTION 4 & 5: RECRUITMENT & PROJECTS */}
    <div className="grid gap-5 xl:grid-cols-2">
      {canReadHiring && <section aria-label="Recruitment & Pipeline"><h2 className="dashboard-section-title">Recruitment & Pipeline</h2><Card><HiringProgress companyId={activeCompany?.id || ''} /></Card></section>}

      <section aria-label="Projects & Productivity"><h2 className="dashboard-section-title">Projects & Productivity</h2><Card>{activeCompany ? <ProjectProductivity key={activeCompany.id} companyId={activeCompany.id} /> : <p role="status">Loading company...</p>}</Card></section>
    </div>

    {/* SECTION 6 & 7: PAYROLL & ACTIVITY FEED */}
    <div className="grid gap-5 xl:grid-cols-[2fr_1fr]">
      <section aria-label="Payroll & Finance">
        <h2 className="dashboard-section-title flex items-center gap-2 text-[#DC2626]"><Receipt size={18} /> Payroll & Finance</h2>
        {canRunPayroll && <Card title="Monthly payroll expense"><PayrollTrend companyId={activeCompany?.id || ''} /></Card>}
      </section>

      {canReadAudit && <section aria-label="Live activity feed">
        <h2 className="dashboard-section-title flex items-center gap-2 text-[var(--primary)]"><Activity size={18} /> Live Activity Feed</h2>
        <Card chip={<button className="text-xs font-semibold text-primary" onClick={() => navigate('/audit-logs')}>View all &rarr;</button>} className="h-[calc(100%-36px)] overflow-y-auto">
        {queryState(activityQuery.isPending, activityQuery.isError, activityQuery.refetch, !activityRows.length,
          <ul className="flex flex-col gap-4">
            {activityRows.slice(0, 5).map((event, idx) => (
              <li key={event.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`h-3 w-3 rounded-full ${['bg-[#10B981]', 'bg-[#3B82F6]', 'bg-[#F59E0B]', 'bg-[#8B5CF6]', 'bg-[#059669]'][idx % 5]}`} />
                  {idx !== Math.min(5, activityRows.length) - 1 && <div className="h-full w-px bg-gray-200 mt-1" />}
                </div>
                <div className="pb-4">
                  <p className="text-[13px] text-gray-800"><b>{activityActor(event)}</b> {activityLabel(event).toLowerCase()}.</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">{event.occurredAt ? new Date(event.occurredAt).toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card></section>}
    </div>

    {/* SECTION 7.5: UPCOMING MILESTONES */}
    {activeCompany && <CompanyNotices key={activeCompany.id} companyId={activeCompany.id} />}
    <section aria-label="Upcoming milestones"><h2 className="dashboard-section-title">Upcoming milestones</h2><UpcomingMilestones />{canSeeProbation && <UpcomingProbations />}</section>

    <section aria-label="Operational insights"><h2 className="dashboard-section-title">Operational insights</h2><div className="grid gap-5 xl:grid-cols-3">
      {canReadTeamAttendance && <Card title="Attendance follow-up"><p className="text-sm">Review today's attendance exceptions and open the employee list behind each count.</p><HrButton className="mt-3" onClick={() => navigate(`/hrms/attendance?tab=team&date=${todayIso}`)}>Review attendance</HrButton></Card>}
      {canApproveCorrections && <Card title="Correction requests">{queryState(corrections.isPending, corrections.isError, corrections.refetch, false, <p className="text-lg font-semibold">{corrections.data?.totalElements ?? 0} awaiting review</p>)}<HrButton className="mt-3" onClick={() => navigate('/hrms/attendance?tab=corrections')}>Review requests</HrButton></Card>}
      {canApproveLeaves && <Card title="Leave approvals"><p className="text-lg font-semibold">{leaveOverviewQuery.isLoading ? 'Loading...' : leaveOverviewQuery.isError ? 'Unable to load approvals' : `${pendingApprovals} awaiting review`}</p><HrButton className="mt-3" onClick={() => navigate('/hrms/leave')}>Open leave approvals</HrButton></Card>}
      {canVerifyDocuments && <Card title="Documents to review">
        <p className="text-lg font-semibold">
          {pendingDocsQuery.isLoading ? 'Loading…' : pendingDocsQuery.isError ? 'Unable to load' : `${pendingDocsCount} document${pendingDocsCount === 1 ? '' : 's'} pending`}
        </p>
        <p className="text-xs text-text-secondary mt-1">Employees uploaded these — verify or reject each with a reason.</p>
        <HrButton className="mt-3" onClick={() => navigate('/hrms/documents/pending')}>Review documents</HrButton>
      </Card>}
    </div></section>
  </div>
}
