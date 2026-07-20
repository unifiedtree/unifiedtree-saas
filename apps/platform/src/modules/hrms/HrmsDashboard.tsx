import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Users, UserCheck, Clock, CalendarDays, Building2, Plus, ArrowRight } from 'lucide-react'
import { HrPageHeader, HrStatCard, HrStatusPill, HrButton, TableCard, HrAvatar } from '@/shared/components/hr'
import { useEmployeeDirectory } from './api/useWorkforce'
import { useCompanies } from './api/useOrg'
import { useLeaveOverview } from './api/useLeave'
import { useMonthlyStats } from './api/useAttendance'
import { usePermission, P } from '@unifiedtree/sdk'
import { UpcomingProbations } from './probation/UpcomingProbations'

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
    ...(canWriteEmployee ? [
      { label: 'Add Employee', icon: Plus, path: '/hrms/employees' },
    ] : []),
    ...(canManageOrg ? [
      { label: 'Org Setup', icon: Building2, path: '/hrms/organization' },
    ] : []),
    { label: 'Attendance', icon: Clock, path: '/hrms/attendance' },
    { label: 'Leave', icon: CalendarDays, path: '/hrms/leave' },
  ]

  const greeting = (() => {
    const h = now.getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 font-sans sm:p-8">
      <HrPageHeader
        crumb={greeting}
        title="HRMS Overview"
        subtitle={activeCompany ? activeCompany.name : 'Human Resources Management System'}
        actions={
          <HrButton onClick={() => navigate('/hrms/employees')}>
            <Plus size={15} /> Add employee
          </HrButton>
        }
      />

      {/* Stat grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div onClick={() => navigate('/hrms/employees')} className="cursor-pointer">
          <HrStatCard icon={<Users size={18} />} color="green" value={totalEmployees} label="Total Employees" />
        </div>
        <div onClick={() => navigate('/hrms/attendance')} className="cursor-pointer">
          <HrStatCard
            icon={<UserCheck size={18} />}
            color="blue"
            value={attendanceStats?.presentDays ?? '—'}
            label="Present Today"
            sub={attendanceStats ? `Attendance score ${attendanceStats.attendanceScore}%` : undefined}
          />
        </div>
        <div onClick={() => navigate('/hrms/leave')} className="cursor-pointer">
          <HrStatCard icon={<CalendarDays size={18} />} color="orange" value={pendingLeaves} label="Pending Leaves" />
        </div>
        <div onClick={() => navigate('/hrms/organization')} className="cursor-pointer">
          <HrStatCard icon={<Building2 size={18} />} color="purple" value={companies.length} label="Companies" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent employees */}
        <div className="lg:col-span-2">
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

        {/* Quick actions */}
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-5 shadow-sm">
          <h2 className="mb-4 text-md font-semibold tracking-tight text-[var(--text-primary)]">Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((a) => (
              <button
                key={a.label}
                onClick={() => navigate(a.path)}
                className="group flex flex-col items-start gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:shadow-md"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-fg)] transition-colors group-hover:bg-[var(--accent-solid)] group-hover:text-white">
                  <a.icon size={17} />
                </span>
                <span className="text-[13px] font-semibold text-[var(--text-primary)]">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Upcoming probations */}
      {canSeeProbation && <UpcomingProbations />}
    </div>
  )
}
