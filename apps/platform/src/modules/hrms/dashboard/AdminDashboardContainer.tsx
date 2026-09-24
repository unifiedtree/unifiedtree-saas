// Real-data container for the redesigned Company Admin Dashboard
// (design/dc/AdminDashboard). Every number comes from an existing endpoint;
// each dashboard section gets its own loading / empty / error state.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePermission, P, useAuthStore } from '@unifiedtree/sdk'
import { apiJson, apiBlob } from '@/core/api/client'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { HrDrawer } from '@/shared/components/hr'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { AdminDashboard, type SectionKey, type SectionStatus } from '@/design/dc/AdminDashboard'
import { DesignFrame, useIsMobile } from '@/design/dc/DesignFrame'
import { istToday, istHour, addDays, dt, fmtShort, fmtLong, MON } from '@/design/dc/dates'
import { useCompanies } from '../api/useOrg'
import { useTeamDashboard, useAttendanceTrend, useCorrectionApprovals } from '../api/useAttendance'
import { useLeaveOverview } from '../api/useLeave'
import { useHeadcountReport } from '../api/useReports'
import { useActivityFeed, activityActor } from '../api/useActivity'
import { useSeatsUsage } from '../api/useSeats'
import { useHolidays } from '../api/useSettings'
import { useMilestones, type Milestone } from '../api/useMilestones'
import { useUpcomingProbations } from '../api/useProbation'
import { useRuns } from '../api/usePayrollRuns'
import { useEmployeeDirectory } from '../api/useWorkforce'
import { ProjectProductivity } from './ProjectProductivity'

interface Stats { activeEmployees?: number; openRoles?: number; complianceScore?: number | null; complianceDue?: number; complianceCompleted?: number; monthlyPayroll?: number | null; month: string }
interface Alert { type: string; count: number; label: string; path: string }
interface Notice { id: string; title: string; body: string; expiresOn?: string; createdAt: string }
interface Project { id: string; name: string; status: string; total: number; completed: number }

const STAGE_LABEL: Record<string, string> = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected' }

type Q = { isLoading: boolean; isError: boolean; refetch: () => unknown; isFetched?: boolean }
const status = (q: Q | null, allowed: boolean, empty: boolean): SectionStatus =>
  !allowed || !q ? 'empty' : q.isLoading ? 'loading' : q.isError ? 'error' : empty ? 'empty' : 'live'


/** "12 min ago" style relative time for the activity feed. */
function relTime(iso: string | null): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`
  return `${Math.round(s / 86400)} d ago`
}
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).toLowerCase() : '')
const humanise = (t: string) => { const w = t.replace(/[._-]+/g, ' ').trim().toLowerCase(); return w }

export function AdminDashboardContainer() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirmDialog()
  const mobile = useIsMobile()
  const today = istToday()
  const [date, setDate] = useState<string | null>(null)
  const sel = date || today
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  // ── permissions ────────────────────────────────────────────────────────────
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const canReadCompany = usePermission('org.company.read' as any)
  const canWriteCompany = usePermission('org.company.write' as any)
  const canReadHiring = usePermission(P.HRMS_HIRING_READ)
  const canReadPerformance = usePermission('hrms.performance.read' as any)
  const canReadOnboarding = usePermission('hrms.onboarding.instance.write' as any)
  const canReadProjects = usePermission('hrms.project.read' as any)
  const canAudit = usePermission(P.AUDIT_READ)
  const canSeeProbation = usePermission(P.HRMS_PROBATION_REMINDERS_READ)
  const canApproveCorrections = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const canExport = usePermission(P.HRMS_REPORT_HEADCOUNT)
  const canAddEmployee = usePermission(P.HRMS_EMPLOYEE_WRITE)
  const canManageOrg = usePermission(P.ORG_COMPANY_WRITE)
  const canReportAttrition = usePermission(P.HRMS_REPORT_ATTRITION)
  const canReportAttendance = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const canReportLeave = usePermission(P.HRMS_REPORT_LEAVE)
  const canReportDiversity = usePermission(P.HRMS_REPORT_DIVERSITY)
  const canViewReports = canExport || canReportAttrition || canReportAttendance || canReportLeave || canReportDiversity
  const hasPayrollModule = useLocalAuthStore((s) => s.tenant?.activeModules?.includes('payroll') ?? false)
  const canRunsRead = usePermission(P.PAYROLL_RUNS_READ)
  const hasPayroll = hasPayrollModule && canRunsRead
  const roles: string[] = useAuthStore((s) => s.user?.roles) ?? []
  const canBilling = roles.some((r) => ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN'].includes(r))
  const firstName = useAuthStore((s) => s.user?.firstName)

  // ── data ───────────────────────────────────────────────────────────────────
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id as string | undefined
  const team = useTeamDashboard(sel, undefined, canReadTeam)
  const trend = useAttendanceTrend(addDays(today, -30), today, undefined, canReadTeam)
  const directory = useEmployeeDirectory({ companyId, pageSize: 1 }, { enabled: canReadEmployees && !!companyId && !canReadTeam })
  const stats = useQuery({ queryKey: ['dashboard', 'summary', companyId], queryFn: () => apiJson<Stats>(`/v1/admin/dashboard/stats?companyId=${companyId}`), enabled: canReadCompany && !!companyId })
  const alerts = useQuery({ queryKey: ['dashboard', 'alerts', companyId], queryFn: () => apiJson<Alert[]>('/v1/admin/dashboard/alerts'), enabled: canReadCompany && !!companyId })
  const seats = useSeatsUsage({ enabled: canBilling })
  const holidays = useHolidays(companyId ?? '', Number(today.slice(0, 4)))
  const headcount = useHeadcountReport(canReadEmployees && canExport ? (companyId ?? null) : null)
  const performers = useQuery({ queryKey: ['admin-dashboard', 'performers', companyId], queryFn: () => apiJson<{ id: string; name: string; rating: number; reviews: number }[]>(`/v1/admin/dashboard/performers?companyId=${companyId}`), enabled: canReadPerformance && !!companyId })
  const onboarding = useQuery({ queryKey: ['admin-dashboard', 'onboarding', companyId], queryFn: () => apiJson<{ id: string; name: string; status: string; completed: number; total: number }[]>(`/v1/admin/dashboard/onboarding?companyId=${companyId}`), enabled: canReadOnboarding && !!companyId })
  const hiring = useQuery({ queryKey: ['admin-dashboard', 'hiring', companyId], queryFn: () => apiJson<{ openJobs: number; stages: { stage: string; count: number }[] }>(`/v1/admin/dashboard/hiring?companyId=${companyId}`), enabled: canReadHiring && !!companyId })
  const projects = useQuery({ queryKey: ['hrms', 'projects', companyId], queryFn: () => apiJson<Project[]>(`/v1/hrms/projects?companyId=${companyId}`), enabled: canReadProjects && !!companyId })
  const runs = useRuns({ companyId }, { enabled: hasPayroll && !!companyId })
  const activity = useActivityFeed(5, canAudit)
  const notices = useQuery({ queryKey: ['dashboard', 'notices', companyId, 0], queryFn: () => apiJson<{ content: Notice[]; totalElements: number }>(`/v1/admin/dashboard/notices?companyId=${companyId}&page=0&size=5`), enabled: canReadCompany && !!companyId })
  const milestones = useMilestones({ birthdayDays: 14, anniversaryDays: 31, retirementMonths: 6 })
  const probations = useUpcomingProbations(30)
  const corrections = useCorrectionApprovals('PENDING', { enabled: canApproveCorrections, size: 1 })
  const leaveOverview = useLeaveOverview()

  // ── notices: save / archive through the API ────────────────────────────────
  const noticeMutation = useMutation({
    mutationFn: ({ id, archive, title, body, expiry }: { id?: string | null; archive?: boolean; title?: string; body?: string; expiry?: string | null }) =>
      apiJson(`/v1/admin/dashboard/notices${id ? '/' + id : ''}`, { method: archive ? 'DELETE' : id ? 'PUT' : 'POST', ...(!archive ? { body: JSON.stringify({ companyId, title, body, expiresOn: expiry || null }) } : {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'notices'] }),
  })

  const exportHeadcount = async () => {
    if (!companyId || exporting) return
    setExporting(true)
    try {
      const blob = await apiBlob(`/v1/reports/headcount/export.csv?companyId=${encodeURIComponent(companyId)}`)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `headcount-${today}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      const code = (err as Error & { status?: number }).status
      toast.error('Could not generate the report', { description: code === 403 ? "Your role doesn't include the headcount report." : (err as Error)?.message || 'Please try again.' })
    } finally {
      setExporting(false)
    }
  }

  // ── view data (shapes follow the design's sample data) ──────────────────────
  const data = useMemo(() => {
    const counts = team.data?.counts
    const staff = team.data?.staffStatuses ?? []
    const checkedIn = staff.filter((s) => !!s.checkInAt).length
    const total = team.data ? staff.length : directory.data?.totalElements ?? 0
    const c = counts
      ? {
          total, present: checkedIn, regular: counts.present, late: counts.late, halfDay: counts.halfDay, wfh: counts.workFromHome,
          onLeave: counts.onLeave, notMarked: counts.notMarked, absent: counts.absent, earlyOut: counts.earlyCheckout,
          other: Math.max(0, total - checkedIn - counts.onLeave - counts.absent),
        }
      : { total, present: 0, regular: 0, late: 0, halfDay: 0, wfh: 0, onLeave: 0, notMarked: 0, absent: 0, earlyOut: 0, other: 0 }
    const daily: Record<string, any> = {}
    for (const r of trend.data ?? []) {
      const present = r.present + r.late + r.halfDay + r.workFromHome
      const t = present + r.notMarked
      daily[r.date] = { total: t, present, regular: r.present, late: r.late, absent: r.absent, wfh: r.workFromHome, halfDay: r.halfDay, onLeave: r.onLeave, notMarked: r.notMarked, earlyOut: 0, other: Math.max(0, t - present - r.onLeave - r.absent) }
    }
    if (counts) daily[sel] = c

    const st = stats.data
    const payrollMonths = new Map<string, number>()
    for (const run of runs.data ?? []) {
      if (run.status !== 'LOCKED' && run.status !== 'PAID') continue
      const m = `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`
      payrollMonths.set(m, (payrollMonths.get(m) || 0) + Number(run.totalGross || 0))
    }
    const payroll = [...payrollMonths].sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, gross]) => ({
      month, gross, label: MON[Number(month.slice(5, 7)) - 1], title: `${MON[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`,
    }))
    const pj = projects.data ?? []
    const done = pj.reduce((n, x) => n + (x.completed || 0), 0), all = pj.reduce((n, x) => n + (x.total || 0), 0)
    const milestone = (m: Milestone, kind: 'b' | 'a' | 'r') => {
      const days = Math.round((dt(m.date).getTime() - dt(today).getTime()) / 86400000)
      const when = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : kind === 'r' ? fmtShort(m.date) : `in ${days} days`
      const date = kind === 'a' ? `${m.years ?? 1} ${(m.years ?? 1) === 1 ? 'year' : 'years'}` : kind === 'r' ? (days > 45 ? `in ${Math.round(days / 30)} months` : `in ${days} days`) : fmtShort(m.date).slice(0, -5)
      return { id: m.employeeId, name: m.name, dept: m.department || '', when, date }
    }
    return {
      today, todayLabel: fmtLong(today), firstName,
      greetingWord: (() => { const h = istHour(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening' })(),
      counts: c, daily,
      summary: st ? {
        active: st.activeEmployees, openRoles: st.openRoles, complianceDue: st.complianceDue, complianceDone: st.complianceCompleted,
        payrollMonth: st.month, payrollGross: st.monthlyPayroll ?? null, hasPayrollFigure: 'monthlyPayroll' in st,
        pipeline: hiring.data ? hiring.data.stages.reduce((n, x) => n + x.count, 0) : undefined,
      } : {},
      alerts: alerts.data ?? [],
      seats: seats.data ? { used: seats.data.current, purchased: seats.data.purchased } : { used: 0, purchased: 0 },
      holidays: (holidays.data ?? []).filter((h) => h.active !== false).map((h) => ({ date: h.holidayDate, name: h.holidayName })),
      departments: (headcount.data ?? []).map((r) => ({ name: r.department ?? 'Unassigned', active: Number(r.active ?? 0) })).filter((d) => d.active > 0),
      performers: (performers.data ?? []).map((x) => ({ id: x.id, name: x.name, dept: '', reviews: x.reviews, rating: x.rating })),
      onboarding: (onboarding.data ?? []).map((o) => ({ ...o, statusLabel: o.status === 'IN_PROGRESS' ? 'In progress' : o.status.charAt(0) + o.status.slice(1).toLowerCase().replace(/_/g, ' ') })),
      hiring: hiring.data ? { openJobs: hiring.data.openJobs, stages: hiring.data.stages.map((x) => ({ ...x, label: STAGE_LABEL[x.stage] || x.stage })) } : { openJobs: 0, stages: [] },
      projects: { active: pj.filter((x) => x.status === 'ACTIVE').length, completedTasks: done, openTasks: Math.max(0, all - done), completion: all ? Math.round((done / all) * 100) : 0 },
      payroll,
      activity: (activity.data?.data ?? []).map((e) => {
        const act = (e.action || '').toLowerCase()
        const type = /approv/.test(act) ? 'approve' : /regulari|correct/.test(act) ? 'regularize' : /payroll|lock|process/.test(act) || (e.module || '').includes('payroll') ? 'payroll' : /onboard/.test(act) ? 'onboard' : 'update'
        const words = e.summary?.trim() || `${humanise(e.action || 'updated')}${e.resourceType ? ' ' + humanise(e.resourceType) : ''}`
        return { id: e.id, type, actor: activityActor(e), action: words, record: '', path: '/audit-logs', rel: relTime(e.occurredAt), time: clock(e.occurredAt) }
      }),
      notices: (notices.data?.content ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, published: fmtShort(n.createdAt.slice(0, 10)), until: n.expiresOn ? fmtShort(n.expiresOn) : null, expiryIso: n.expiresOn || '' })),
      noticeTotal: notices.data?.totalElements,
      milestones: {
        birthdays: (milestones.data?.birthdays ?? []).map((m) => milestone(m, 'b')),
        anniversaries: (milestones.data?.anniversaries ?? []).map((m) => milestone(m, 'a')),
        retirements: (milestones.data?.retirements ?? []).map((m) => milestone(m, 'r')),
      },
      probations: (probations.data ?? []).map((p) => ({ id: p.employeeId, code: p.employeeCode, name: p.employeeName, title: p.jobTitle || '', manager: p.managerName || '—', end: fmtShort(p.probationEndDate), days: p.daysRemaining })),
      ops: { corrections: corrections.data?.totalElements ?? 0, leave: leaveOverview.data?.pendingApprovals ?? 0 },
    }
  }, [team.data, trend.data, directory.data, stats.data, alerts.data, seats.data, holidays.data, headcount.data, performers.data, onboarding.data, hiring.data, projects.data, runs.data, activity.data, notices.data, milestones.data, probations.data, corrections.data, leaveOverview.data, sel, today, firstName])

  const d = data
  const sec: Record<SectionKey, { state: SectionStatus; retry: () => void }> = {
    live: { state: status(canReadTeam ? team : directory, canReadTeam || canReadEmployees, false), retry: () => { team.refetch(); trend.refetch() } },
    summary: { state: status(stats, canReadCompany, false), retry: () => stats.refetch() },
    alerts: { state: status(alerts, canReadCompany, !(alerts.data ?? []).some((a) => a.count > 0)), retry: () => alerts.refetch() },
    trend: { state: status(trend, canReadTeam, !(trend.data ?? []).length), retry: () => trend.refetch() },
    today: { state: status(team, canReadTeam, !d.counts.total), retry: () => team.refetch() },
    dept: { state: status(headcount, canReadEmployees && canExport, !d.departments.length), retry: () => headcount.refetch() },
    performers: { state: status(performers, canReadPerformance, !d.performers.length), retry: () => performers.refetch() },
    onboarding: { state: status(onboarding, canReadOnboarding, !d.onboarding.length), retry: () => onboarding.refetch() },
    hiring: { state: status(hiring, canReadHiring, !d.hiring.stages.some((x) => x.count > 0) && !d.hiring.openJobs), retry: () => hiring.refetch() },
    projects: { state: status(projects, canReadProjects, !(projects.data ?? []).length), retry: () => projects.refetch() },
    payroll: { state: status(runs, hasPayroll, !d.payroll.length), retry: () => runs.refetch() },
    activity: { state: status(activity, canAudit, !d.activity.length), retry: () => activity.refetch() },
    notices: { state: status(notices, canReadCompany, !d.notices.length), retry: () => notices.refetch() },
    milestones: { state: status(milestones, true, !(d.milestones.birthdays.length + d.milestones.anniversaries.length + d.milestones.retirements.length)), retry: () => milestones.refetch() },
    probations: { state: status(probations, canSeeProbation, !d.probations.length), retry: () => probations.refetch() },
  }

  const quickActions = [
    canReadTeam && { label: 'Attendance', icon: 'clock', path: '/hrms/attendance' },
    { label: 'Change shifts', icon: 'swap', path: '/hrms/shifts?tab=roster' },
    { label: 'Add time-off', icon: 'calendarPlus', path: '/hrms/leave?tab=apply' },
    hasPayroll && { label: 'Run payroll', icon: 'rupee', path: '/hrms/payroll-dashboard' },
    canViewReports && { label: 'View reports', icon: 'fileText', path: '/hrms/reports' },
    canManageOrg && { label: 'Org setup', icon: 'building', path: '/hrms/organization' },
  ].filter(Boolean)

  const onNavigate = (path: string) => {
    if (path === '/projects') { setProjectsOpen(true); return }
    navigate(path)
  }

  return (
    <DesignFrame>
      <AdminDashboard
        data={d}
        sec={sec}
        date={date}
        onDate={setDate}
        mobile={mobile}
        hasPayroll={hasPayroll}
        canHiring={canReadHiring}
        canBilling={canBilling && !!seats.data}
        canReadEmployees={canReadEmployees}
        canReadTeam={canReadTeam}
        canExport={canExport}
        canAddEmployee={canAddEmployee}
        canManageNotices={canWriteCompany}
        exporting={exporting}
        quickActions={quickActions}
        payRange={(() => {
          if (!d.payroll.length) return ''
          const first = d.payroll[0], last = d.payroll[d.payroll.length - 1]
          return `${first.month.slice(0, 4) === last.month.slice(0, 4) ? first.label : first.title} – ${last.title}`
        })()}
        onNavigate={onNavigate}
        onExportHeadcount={exportHeadcount}
        onSaveNotice={async (n: { id?: string | null; title: string; body: string; expiry: string | null }) => {
          try {
            await noticeMutation.mutateAsync(n)
            toast.success(n.id ? 'Notice updated' : 'Notice published')
            return true
          } catch (e) {
            toast.error('Could not save the notice', { description: (e as Error)?.message })
            return false
          }
        }}
        onArchiveNotice={async (id: string) => {
          if (!(await confirm({ title: 'Archive notice?', body: 'This notice will no longer appear on the dashboard.', confirmLabel: 'Archive', tone: 'danger' }))) return
          try {
            await noticeMutation.mutateAsync({ id, archive: true })
            toast.success('Notice archived')
          } catch (e) {
            toast.error('Could not archive the notice', { description: (e as Error)?.message })
          }
        }}
      />
      {projectsOpen && companyId && (
        <HrDrawer title="Projects & Productivity" onClose={() => setProjectsOpen(false)} width="max-w-2xl">
          <ProjectProductivity companyId={companyId} />
        </HrDrawer>
      )}
    </DesignFrame>
  )
}
